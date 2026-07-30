import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { users } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getStripe, StripeConfigurationError } from "@/lib/stripe";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

  if (!auth0UserId) {
    return json({ error: "The authenticated profile is incomplete." }, 409);
  }

  const configurationId =
    process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();

  if (!configurationId) {
    return json({ error: "The billing portal is not configured." }, 503);
  }

  const origin = appOrigin(request);

  if (!origin) {
    return json({ error: "The application URL is not configured." }, 503);
  }

  try {
    const [user] = await getDb()
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.auth0Sub, auth0UserId))
      .limit(1);

    if (!user?.stripeCustomerId) {
      return json({ error: "No billing account was found." }, 404);
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      configuration: configurationId,
      return_url: origin,
    });

    return json({ url: portalSession.url });
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      return json({ error: "Billing is not configured." }, 503);
    }

    console.error("Unable to create the Stripe Billing Portal session.");
    return json(
      { error: "The billing portal is temporarily unavailable." },
      502,
    );
  }
}
