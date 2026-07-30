import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscriptions, users } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getStripe, StripeConfigurationError } from "@/lib/stripe";

const CHECKOUT_INTEGRATION_IDENTIFIER = "panelforge_checkout_qmztrvka";
const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1_000;
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "incomplete_expired",
]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hasNonTerminalSubscription(statuses: readonly string[]) {
  return statuses.some(
    (status) => !TERMINAL_SUBSCRIPTION_STATUSES.has(status),
  );
}

function appOrigin(request: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const candidate = configuredBaseUrl || request.url;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let session;

  try {
    session = await auth0.getSession();
  } catch {
    console.error("Unable to read the authenticated session.");
    return json({ error: "Authentication is temporarily unavailable." }, 503);
  }

  if (!session) {
    return json({ error: "Authentication required." }, 401);
  }

  const auth0UserId =
    typeof session.user.sub === "string" ? session.user.sub.trim() : "";
  const email =
    typeof session.user.email === "string" ? session.user.email.trim() : "";

  if (!auth0UserId) {
    return json({ error: "The authenticated profile is incomplete." }, 409);
  }

  if (!email || session.user.email_verified !== true) {
    return json(
      { error: "A verified email address is required to subscribe." },
      409,
    );
  }

  const priceId = process.env.STRIPE_STARTER_PRICE_ID?.trim();

  if (!priceId) {
    return json({ error: "Billing is not configured." }, 503);
  }

  const origin = appOrigin(request);

  if (!origin) {
    return json({ error: "The application URL is not configured." }, 503);
  }

  try {
    const stripe = getStripe();
    const db = getDb();
    const displayName =
      typeof session.user.name === "string" && session.user.name.trim()
        ? session.user.name.trim()
        : null;
    const now = new Date();

    const [user] = await db
      .insert(users)
      .values({
        auth0Sub: auth0UserId,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.auth0Sub,
        set: {
          email,
          displayName,
          updatedAt: now,
        },
      })
      .returning();

    if (!user) {
      throw new Error("The billing user could not be persisted.");
    }

    const localSubscriptions = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));

    if (
      hasNonTerminalSubscription(
        localSubscriptions.map((subscription) => subscription.status),
      )
    ) {
      return json(
        {
          error:
            "An existing subscription is already attached to this account.",
        },
        409,
      );
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email,
          ...(displayName ? { name: displayName } : {}),
          metadata: { auth0_user_id: auth0UserId },
        },
        {
          idempotencyKey: `panelforge-customer-${digest(auth0UserId)}`,
        },
      );

      const [boundUser] = await db
        .update(users)
        .set({
          stripeCustomerId: customer.id,
          updatedAt: new Date(),
        })
        .where(
          and(eq(users.id, user.id), isNull(users.stripeCustomerId)),
        )
        .returning({ stripeCustomerId: users.stripeCustomerId });

      if (boundUser?.stripeCustomerId) {
        customerId = boundUser.stripeCustomerId;
      } else {
        const [concurrentUser] = await db
          .select({ stripeCustomerId: users.stripeCustomerId })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);

        customerId = concurrentUser?.stripeCustomerId ?? null;
      }
    }

    if (!customerId) {
      throw new Error("The Stripe customer could not be persisted.");
    }

    const stripeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    if (
      hasNonTerminalSubscription(
        stripeSubscriptions.data.map((subscription) => subscription.status),
      )
    ) {
      return json(
        {
          error:
            "An existing subscription is already attached to this account.",
        },
        409,
      );
    }

    const metadata = { auth0_user_id: auth0UserId };
    const idempotencyWindow = Math.floor(
      Date.now() / CHECKOUT_IDEMPOTENCY_WINDOW_MS,
    );
    const idempotencyKey = `panelforge-checkout-${digest(
      `${auth0UserId}\u0000${customerId}\u0000${priceId}\u0000${idempotencyWindow}`,
    )}`;

    const checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=cancelled`,
        allow_promotion_codes: true,
        integration_identifier: CHECKOUT_INTEGRATION_IDENTIFIER,
        client_reference_id: auth0UserId,
        metadata,
        subscription_data: { metadata },
      },
      { idempotencyKey },
    );

    if (!checkoutSession.url) {
      console.error("Stripe returned a Checkout Session without a URL.");
      return json({ error: "Checkout is temporarily unavailable." }, 502);
    }

    return json({ url: checkoutSession.url });
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      return json({ error: "Billing is not configured." }, 503);
    }

    console.error("Unable to create the Stripe Checkout Session.");
    return json({ error: "Checkout is temporarily unavailable." }, 502);
  }
}
