const REQUIRED_CONFIGURATION = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_STARTER_PRICE_ID",
  "STRIPE_PORTAL_CONFIGURATION_ID",
  "DATABASE_CONNECTION_STRING",
  "OPENROUTER_API_KEY",
  "OPENROUTER_TEXT_MODEL",
] as const;

export function GET() {
  const configured = REQUIRED_CONFIGURATION.every((name) =>
    Boolean(process.env[name]?.trim()),
  );

  return Response.json(
    { ok: configured },
    {
      status: configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
