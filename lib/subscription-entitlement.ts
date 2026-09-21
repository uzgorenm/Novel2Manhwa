export const CHAPTER_CREDITS_PER_PERIOD = 6;

export const ENTITLED_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
] as const;

export const TERMINAL_SUBSCRIPTION_STATUSES = [
  "canceled",
  "incomplete_expired",
] as const;

export type SubscriptionSnapshot = {
  status: string;
  stripePriceId: string | null;
  chapterCreditsRemaining: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

export type StarterEntitlement = {
  plan: "starter" | "none";
  status: string | null;
  creditsRemaining: number;
  canGenerate: boolean;
  canSubscribe: boolean;
  hasBillingAccount: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

const entitledStatuses = new Set<string>(ENTITLED_SUBSCRIPTION_STATUSES);
const terminalStatuses = new Set<string>(TERMINAL_SUBSCRIPTION_STATUSES);

export function isEntitledSubscriptionStatus(status: string) {
  return entitledStatuses.has(status);
}

export function hasNonTerminalSubscription(statuses: readonly string[]) {
  return statuses.some((status) => !terminalStatuses.has(status));
}

export function resolveStarterEntitlement(
  subscriptions: readonly SubscriptionSnapshot[],
  starterPriceId: string,
  options: {
    hasBillingAccount?: boolean;
    now?: Date;
  } = {},
): StarterEntitlement {
  const now = options.now ?? new Date();
  const starterSubscriptions = subscriptions.filter(
    (subscription) => subscription.stripePriceId === starterPriceId,
  );
  const entitledSubscription = starterSubscriptions.find(
    (subscription) =>
      isEntitledSubscriptionStatus(subscription.status) &&
      (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now),
  );
  const currentStarterSubscription =
    entitledSubscription ??
    starterSubscriptions.find((subscription) =>
      hasNonTerminalSubscription([subscription.status]),
    ) ??
    starterSubscriptions[0];
  const creditsRemaining = entitledSubscription
    ? Math.max(0, Math.floor(entitledSubscription.chapterCreditsRemaining))
    : 0;

  return {
    plan:
      currentStarterSubscription &&
      hasNonTerminalSubscription([currentStarterSubscription.status])
        ? "starter"
        : "none",
    status: currentStarterSubscription?.status ?? null,
    creditsRemaining,
    canGenerate: creditsRemaining > 0,
    canSubscribe: !hasNonTerminalSubscription(
      subscriptions.map((subscription) => subscription.status),
    ),
    hasBillingAccount:
      options.hasBillingAccount === true || subscriptions.length > 0,
    cancelAtPeriodEnd:
      currentStarterSubscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: currentStarterSubscription?.currentPeriodEnd ?? null,
  };
}
