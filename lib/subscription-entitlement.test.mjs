import assert from "node:assert/strict";
import test from "node:test";

import {
  hasNonTerminalSubscription,
  resolveStarterEntitlement,
} from "./subscription-entitlement.ts";

const starterPriceId = "price_starter";
const now = new Date("2026-09-14T12:00:00.000Z");

function subscription(overrides = {}) {
  return {
    status: "active",
    stripePriceId: starterPriceId,
    chapterCreditsRemaining: 6,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-10-14T12:00:00.000Z"),
    ...overrides,
  };
}

test("an active Starter subscription exposes its usable balance", () => {
  assert.deepEqual(
    resolveStarterEntitlement(
      [subscription({ chapterCreditsRemaining: 3 })],
      starterPriceId,
      { now },
    ),
    {
      plan: "starter",
      status: "active",
      creditsRemaining: 3,
      canGenerate: true,
      canSubscribe: false,
      hasBillingAccount: true,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date("2026-10-14T12:00:00.000Z"),
    },
  );
});

test("a zero balance blocks generation without reopening checkout", () => {
  const entitlement = resolveStarterEntitlement(
    [subscription({ chapterCreditsRemaining: 0 })],
    starterPriceId,
    { now },
  );

  assert.equal(entitlement.canGenerate, false);
  assert.equal(entitlement.canSubscribe, false);
  assert.equal(entitlement.creditsRemaining, 0);
});

test("an expired local period cannot authorize generation", () => {
  const entitlement = resolveStarterEntitlement(
    [
      subscription({
        chapterCreditsRemaining: 4,
        currentPeriodEnd: new Date("2026-09-14T11:59:59.000Z"),
      }),
    ],
    starterPriceId,
    { now },
  );

  assert.equal(entitlement.plan, "starter");
  assert.equal(entitlement.canGenerate, false);
  assert.equal(entitlement.creditsRemaining, 0);
});

test("terminal subscriptions allow a new checkout", () => {
  const entitlement = resolveStarterEntitlement(
    [subscription({ status: "canceled", chapterCreditsRemaining: 6 })],
    starterPriceId,
    { now, hasBillingAccount: true },
  );

  assert.equal(entitlement.plan, "none");
  assert.equal(entitlement.canGenerate, false);
  assert.equal(entitlement.canSubscribe, true);
  assert.equal(entitlement.hasBillingAccount, true);
});

test("another nonterminal plan prevents duplicate checkout", () => {
  const entitlement = resolveStarterEntitlement(
    [subscription({ stripePriceId: "price_other", status: "past_due" })],
    starterPriceId,
    { now },
  );

  assert.equal(entitlement.plan, "none");
  assert.equal(entitlement.canGenerate, false);
  assert.equal(entitlement.canSubscribe, false);
});

test("only terminal Stripe statuses are eligible for a new checkout", () => {
  assert.equal(hasNonTerminalSubscription(["canceled"]), false);
  assert.equal(hasNonTerminalSubscription(["incomplete_expired"]), false);
  assert.equal(hasNonTerminalSubscription(["past_due"]), true);
  assert.equal(hasNonTerminalSubscription(["paused"]), true);
});
