import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  stripeWebhookEvents,
  subscriptions,
  users,
} from "@/db/schema";
import { getDb } from "@/lib/db";
import { getStripe, StripeConfigurationError } from "@/lib/stripe";

const CHAPTER_CREDITS_PER_PERIOD = 6;
const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function stripeObjectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }

  return value?.id ?? null;
}

function stripeTimestamp(value: number) {
  return new Date(value * 1_000);
}

async function bindCustomerToUser(
  user: {
    id: string;
    auth0Sub: string;
    stripeCustomerId: string | null;
  },
  customerId: string,
) {
  if (user.stripeCustomerId && user.stripeCustomerId !== customerId) {
    throw new Error("The Stripe customer does not match the stored user.");
  }

  if (!user.stripeCustomerId) {
    await getDb()
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }
}

async function persistSubscription(
  subscription: Stripe.Subscription,
  userId: string,
  eventCreatedAt: Date,
) {
  const customerId = stripeObjectId(subscription.customer);
  const firstItem = subscription.items.data[0];

  if (!customerId || !firstItem) {
    throw new Error("The Stripe subscription is missing required ownership.");
  }

  const currentPeriodStart = stripeTimestamp(
    firstItem.current_period_start,
  );
  const currentPeriodEnd = stripeTimestamp(firstItem.current_period_end);
  const credits = ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status)
    ? CHAPTER_CREDITS_PER_PERIOD
    : 0;
  const now = new Date();

  await getDb()
    .insert(subscriptions)
    .values({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: firstItem.price.id,
      status: subscription.status,
      chapterCreditsRemaining: credits,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart,
      currentPeriodEnd,
      lastStripeEventCreatedAt: eventCreatedAt,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        userId,
        stripeCustomerId: customerId,
        stripePriceId: firstItem.price.id,
        status: subscription.status,
        chapterCreditsRemaining: sql<number>`
          case
            when ${subscription.status} in ('active', 'trialing') then
              case
                when ${subscriptions.currentPeriodStart}
                  is distinct from ${currentPeriodStart}
                then ${CHAPTER_CREDITS_PER_PERIOD}
                else ${subscriptions.chapterCreditsRemaining}
              end
            else 0
          end
        `,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodStart,
        currentPeriodEnd,
        lastStripeEventCreatedAt: eventCreatedAt,
        updatedAt: now,
      },
      setWhere: or(
        isNull(subscriptions.lastStripeEventCreatedAt),
        lte(subscriptions.lastStripeEventCreatedAt, eventCreatedAt),
      ),
    });
}

async function subscriptionOwner(
  subscription: Stripe.Subscription,
  customerId: string,
) {
  const db = getDb();
  const auth0UserId = subscription.metadata.auth0_user_id?.trim();
  const [existingSubscription] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);

  let owner:
    | {
        id: string;
        auth0Sub: string;
        stripeCustomerId: string | null;
      }
    | undefined;

  if (existingSubscription) {
    [owner] = await db
      .select({
        id: users.id,
        auth0Sub: users.auth0Sub,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, existingSubscription.userId))
      .limit(1);
  }

  if (auth0UserId) {
    const [metadataOwner] = await db
      .select({
        id: users.id,
        auth0Sub: users.auth0Sub,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.auth0Sub, auth0UserId))
      .limit(1);

    if (owner && metadataOwner && owner.id !== metadataOwner.id) {
      throw new Error("The Stripe subscription has conflicting ownership.");
    }

    owner ??= metadataOwner;
  }

  if (!owner) {
    [owner] = await db
      .select({
        id: users.id,
        auth0Sub: users.auth0Sub,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1);
  }

  if (!owner) {
    throw new Error("No application user owns the Stripe subscription.");
  }

  if (auth0UserId && owner.auth0Sub !== auth0UserId) {
    throw new Error("The Stripe subscription metadata does not match its user.");
  }

  await bindCustomerToUser(owner, customerId);
  return owner;
}

async function processCheckoutCompleted(
  checkoutSession: Stripe.Checkout.Session,
  eventCreatedAt: Date,
  stripe: Stripe,
) {
  const customerId = stripeObjectId(checkoutSession.customer);
  const auth0UserId =
    checkoutSession.client_reference_id?.trim() ||
    checkoutSession.metadata?.auth0_user_id?.trim();

  if (!customerId || !auth0UserId) {
    throw new Error("The Checkout Session is missing its account binding.");
  }

  const [user] = await getDb()
    .select({
      id: users.id,
      auth0Sub: users.auth0Sub,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.auth0Sub, auth0UserId))
    .limit(1);

  if (!user) {
    throw new Error("The Checkout Session user does not exist.");
  }

  await bindCustomerToUser(user, customerId);

  const subscriptionId = stripeObjectId(checkoutSession.subscription);

  if (!subscriptionId) {
    throw new Error("The Checkout Session has no subscription.");
  }

  const subscription =
    typeof checkoutSession.subscription === "object" &&
    checkoutSession.subscription?.object === "subscription"
      ? checkoutSession.subscription
      : await stripe.subscriptions.retrieve(subscriptionId);

  if (stripeObjectId(subscription.customer) !== customerId) {
    throw new Error("The Checkout Session subscription has another customer.");
  }

  await persistSubscription(subscription, user.id, eventCreatedAt);
}

async function processSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventCreatedAt: Date,
) {
  const customerId = stripeObjectId(subscription.customer);

  if (!customerId) {
    throw new Error("The Stripe subscription has no customer.");
  }

  const owner = await subscriptionOwner(subscription, customerId);
  await persistSubscription(subscription, owner.id, eventCreatedAt);
}

async function processEvent(event: Stripe.Event, stripe: Stripe) {
  const eventCreatedAt = stripeTimestamp(event.created);

  if (event.type === "checkout.session.completed") {
    await processCheckoutCompleted(
      event.data.object as Stripe.Checkout.Session,
      eventCreatedAt,
      stripe,
    );
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    await processSubscriptionEvent(
      event.data.object as Stripe.Subscription,
      eventCreatedAt,
    );
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return json({ error: "Missing Stripe signature." }, 400);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    return json({ error: "Stripe webhooks are not configured." }, 503);
  }

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return json({ error: "Unable to read the webhook body." }, 400);
  }

  let event: Stripe.Event;
  let stripe: Stripe;

  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      return json({ error: "Stripe webhooks are not configured." }, 503);
    }

    console.warn("Stripe webhook signature verification failed.");
    return json({ error: "Invalid Stripe signature." }, 400);
  }

  const handled = HANDLED_EVENT_TYPES.has(event.type);

  // Do not log event payloads: Stripe objects can contain customer data.
  console.info(`[stripe-webhook] id=${event.id} type=${event.type}`);

  if (!handled) {
    return json({ received: true, handled: false });
  }

  const eventCreatedAt = stripeTimestamp(event.created);
  let claimed = false;

  try {
    const [claim] = await getDb()
      .insert(stripeWebhookEvents)
      .values({
        eventId: event.id,
        eventType: event.type,
        stripeCreatedAt: eventCreatedAt,
      })
      .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
      .returning({ eventId: stripeWebhookEvents.eventId });

    claimed = Boolean(claim);

    if (!claimed) {
      return json({ received: true, handled: true, duplicate: true });
    }

    await processEvent(event, stripe);
    await getDb()
      .update(stripeWebhookEvents)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(stripeWebhookEvents.eventId, event.id),
          isNull(stripeWebhookEvents.processedAt),
        ),
      );

    return json({ received: true, handled: true });
  } catch {
    console.error(
      `[stripe-webhook] processing failed id=${event.id} type=${event.type}`,
    );

    if (claimed) {
      try {
        await getDb()
          .delete(stripeWebhookEvents)
          .where(
            and(
              eq(stripeWebhookEvents.eventId, event.id),
              isNull(stripeWebhookEvents.processedAt),
            ),
          );
      } catch {
        console.error(
          `[stripe-webhook] failed to release claim id=${event.id}`,
        );
      }
    }

    return json({ error: "Webhook processing failed." }, 500);
  }
}
