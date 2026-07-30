import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export class StripeConfigurationError extends Error {
  constructor() {
    super("Stripe is not configured.");
    this.name = "StripeConfigurationError";
  }
}

let stripeClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!apiKey) {
    throw new StripeConfigurationError();
  }

  stripeClient = new Stripe(apiKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    typescript: true,
  });

  return stripeClient;
}
