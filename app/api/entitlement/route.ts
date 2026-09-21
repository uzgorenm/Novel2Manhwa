import { desc, eq } from "drizzle-orm";

import { subscriptions, users } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { resolveStarterEntitlement } from "@/lib/subscription-entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let session;

  try {
    session = await auth0.getSession();
  } catch {
    return json({ error: "Authentication is temporarily unavailable." }, 503);
  }

  const auth0UserId =
    typeof session?.user.sub === "string" ? session.user.sub.trim() : "";

  if (!auth0UserId) {
    return json({ error: "Authentication required." }, 401);
  }

  const starterPriceId = process.env.STRIPE_STARTER_PRICE_ID?.trim();
  if (!starterPriceId) {
    return json({ error: "Billing is not configured." }, 503);
  }

  try {
    const db = getDb();
    const [owner] = await db
      .select({
        id: users.id,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.auth0Sub, auth0UserId))
      .limit(1);

    if (!owner) {
      return json({
        entitlement: serializeEntitlement(
          resolveStarterEntitlement([], starterPriceId),
        ),
      });
    }

    const subscriptionRows = await db
      .select({
        status: subscriptions.status,
        stripePriceId: subscriptions.stripePriceId,
        chapterCreditsRemaining: subscriptions.chapterCreditsRemaining,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, owner.id))
      .orderBy(
        desc(subscriptions.currentPeriodEnd),
        desc(subscriptions.updatedAt),
      );

    return json({
      entitlement: serializeEntitlement(
        resolveStarterEntitlement(subscriptionRows, starterPriceId, {
          hasBillingAccount: Boolean(owner.stripeCustomerId),
        }),
      ),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "DATABASE_CONNECTION_STRING is not configured."
    ) {
      return json({ error: "Database service is not configured." }, 503);
    }
    return json({ error: "The credit balance could not be loaded." }, 500);
  }
}

function serializeEntitlement(
  entitlement: ReturnType<typeof resolveStarterEntitlement>,
) {
  return {
    ...entitlement,
    currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
