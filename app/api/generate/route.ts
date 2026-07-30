import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { auth0 } from "@/lib/auth0";
import {
  generationJobs,
  panels,
  projects,
  subscriptions,
  users,
} from "@/db/schema";
import { getDb } from "@/lib/db";
import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
  generatePanelImages,
  generateStoryboard,
  parseProjectInput,
  prepareReferencePanel,
} from "@/lib/storyboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthenticatedUser = {
  sub: string;
  email: string | null;
  displayName: string | null;
};

const ENTITLED_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
const GENERATION_CONCURRENCY_WINDOW_MS = 5 * 60 * 1_000;
const MAX_CHAPTER_CREDITS = 6;

export async function POST(request: Request) {
  const identity = await getAuthenticatedUser();
  if (!identity) {
    return json({ error: "Authentication required." }, 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (
    !idempotencyKey ||
    !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)
  ) {
    return json(
      { error: "A valid Idempotency-Key header is required." },
      400,
    );
  }

  const payload = await readJsonBody(request);
  if (!payload.ok) {
    return json({ error: payload.error }, 400);
  }

  const parsed = parseProjectInput(payload.value);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  const textModel =
    process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
  const imageModel =
    process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
  const liveImageGenerationEnabled =
    process.env.ENABLE_LIVE_IMAGE_GENERATION === "true";
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const starterPriceId = process.env.STRIPE_STARTER_PRICE_ID?.trim();

  if (!liveImageGenerationEnabled || !geminiApiKey) {
    return json(
      { error: "Chapter generation is temporarily unavailable." },
      503,
    );
  }
  if (!starterPriceId) {
    return json({ error: "Billing is temporarily unavailable." }, 503);
  }

  let referencePanel = parsed.value.referencePanel;

  let db: ReturnType<typeof getDb> | undefined;
  let projectId: string | undefined;
  let jobId: string | undefined;
  let reservedSubscriptionId: string | undefined;
  let creditsRemaining: number | undefined;

  try {
    db = getDb();
    const ownerId = await upsertOwner(db, identity);

    const [existingJob] = await db
      .select({
        id: generationJobs.id,
        status: generationJobs.status,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.userId, ownerId),
          eq(generationJobs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existingJob) {
      return json(
        { error: "This generation request was already submitted." },
        409,
      );
    }

    const [inFlightJob] = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.userId, ownerId),
          eq(generationJobs.status, "processing"),
          gt(
            generationJobs.startedAt,
            new Date(Date.now() - GENERATION_CONCURRENCY_WINDOW_MS),
          ),
        ),
      )
      .orderBy(desc(generationJobs.startedAt))
      .limit(1);

    if (inFlightJob) {
      return json(
        {
          error:
            "Another chapter is already generating. Wait for it to finish before starting the next one.",
        },
        429,
        { "Retry-After": "15" },
      );
    }

    const now = new Date();
    const [eligibleSubscription] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, ownerId),
          eq(subscriptions.stripePriceId, starterPriceId),
          inArray(
            subscriptions.status,
            ENTITLED_SUBSCRIPTION_STATUSES,
          ),
          gt(subscriptions.chapterCreditsRemaining, 0),
          or(
            isNull(subscriptions.currentPeriodEnd),
            gt(subscriptions.currentPeriodEnd, now),
          ),
        ),
      )
      .orderBy(
        desc(subscriptions.currentPeriodEnd),
        desc(subscriptions.updatedAt),
      )
      .limit(1);

    if (!eligibleSubscription) {
      return json(
        {
          error:
            "An active Starter subscription with a chapter credit is required.",
          code: "SUBSCRIPTION_OR_CREDIT_REQUIRED",
        },
        402,
      );
    }

    if (referencePanel) {
      try {
        referencePanel = await prepareReferencePanel(referencePanel);
      } catch {
        return json(
          {
            error:
              "The reference panel could not be decoded. Choose a valid JPEG, PNG, or WebP image.",
          },
          400,
        );
      }
    }

    const [reservation] = await db
      .update(subscriptions)
      .set({
        chapterCreditsRemaining: sql`${subscriptions.chapterCreditsRemaining} - 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(subscriptions.id, eligibleSubscription.id),
          eq(subscriptions.stripePriceId, starterPriceId),
          inArray(
            subscriptions.status,
            ENTITLED_SUBSCRIPTION_STATUSES,
          ),
          gt(subscriptions.chapterCreditsRemaining, 0),
          or(
            isNull(subscriptions.currentPeriodEnd),
            gt(subscriptions.currentPeriodEnd, now),
          ),
        ),
      )
      .returning({
        id: subscriptions.id,
        creditsRemaining: subscriptions.chapterCreditsRemaining,
      });

    if (!reservation) {
      return json(
        { error: "The chapter credit could not be reserved. Try again." },
        409,
        { "Retry-After": "1" },
      );
    }

    reservedSubscriptionId = reservation.id;
    creditsRemaining = reservation.creditsRemaining;

    const [project] = await db
      .insert(projects)
      .values({
        userId: ownerId,
        title: parsed.value.title,
        chapterTitle: parsed.value.chapterTitle,
        manuscript: parsed.value.manuscript,
        stylePreset: parsed.value.stylePreset,
        status: "generating",
      })
      .returning({ id: projects.id });

    const activeProjectId = project.id;
    projectId = activeProjectId;

    const startedAt = new Date();
    const [job] = await db
      .insert(generationJobs)
      .values({
        projectId: activeProjectId,
        userId: ownerId,
        status: "processing",
        textModel,
        imageModel: liveImageGenerationEnabled ? imageModel : null,
        idempotencyKey,
        startedAt,
      })
      .returning({ id: generationJobs.id });

    const activeJobId = job.id;
    jobId = activeJobId;

    const storyboard = await generateStoryboard(parsed.value);
    const previews = await generatePanelImages(
      storyboard.panels,
      referencePanel,
    );
    if (
      previews.length !== storyboard.panels.length ||
      previews.some((preview) => preview.source !== "gemini")
    ) {
      throw new Error("One or more panel image requests did not complete.");
    }

    const persistedPanels = await db
      .insert(panels)
      .values(
        storyboard.panels.map((panel, index) => ({
          projectId: activeProjectId,
          generationJobId: activeJobId,
          sequence: index + 1,
          shot: panel.shot,
          narration: panel.narration,
          dialogue: panel.dialogue,
          balloonType: panel.balloonType,
          balloonPlacement: panel.balloonPlacement,
          imagePrompt: panel.imagePrompt,
          // Live image bytes/data URLs remain response-scoped until storage exists.
          imageUrl: null,
        })),
      )
      .returning();

    const completedAt = new Date();
    await Promise.all([
      db
        .update(generationJobs)
        .set({
          status: "completed",
          generationSource: storyboard.source,
          panelCount: persistedPanels.length,
          completedAt,
          updatedAt: completedAt,
          errorMessage: null,
        })
        .where(eq(generationJobs.id, activeJobId)),
      db
        .update(projects)
        .set({ status: "generated", updatedAt: completedAt })
        .where(eq(projects.id, activeProjectId)),
    ]);

    return json(
      {
        summary: storyboard.summary,
        panels: persistedPanels.map((panel, index) => ({
          sequence: panel.sequence,
          narration: panel.narration,
          dialogue: panel.dialogue,
          balloonType: panel.balloonType,
          imageUrl:
            previews[index]?.source === "gemini"
              ? previews[index].url
              : null,
          letteringMode:
            previews[index]?.source === "gemini" ? "embedded" : "overlay",
        })),
        entitlement: {
          creditsRemaining,
        },
      },
      201,
    );
  } catch (error) {
    await markGenerationFailed(db, projectId, jobId);
    await refundChapterCredit(
      db,
      reservedSubscriptionId,
      starterPriceId,
    );
    if (isUniqueViolation(error)) {
      return json(
        { error: "This generation request was already submitted." },
        409,
      );
    }
    return generationError(error);
  }
}

async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  try {
    const session = await auth0.getSession();
    const user = session?.user;
    if (!user?.sub) {
      return null;
    }

    const email =
      typeof user.email === "string" ? user.email.trim().slice(0, 320) : null;
    const preferredName =
      typeof user.name === "string"
        ? user.name
        : typeof user.nickname === "string"
          ? user.nickname
          : null;

    return {
      sub: user.sub,
      email: email || null,
      displayName: preferredName?.trim().slice(0, 200) || email || null,
    };
  } catch {
    return null;
  }
}

async function upsertOwner(
  db: ReturnType<typeof getDb>,
  identity: AuthenticatedUser,
): Promise<string> {
  const [owner] = await db
    .insert(users)
    .values({
      auth0Sub: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: users.auth0Sub,
      set: {
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  return owner.id;
}

async function markGenerationFailed(
  db: ReturnType<typeof getDb> | undefined,
  projectId: string | undefined,
  jobId: string | undefined,
) {
  if (!db) {
    return;
  }

  const failedAt = new Date();
  try {
    const updates: Promise<unknown>[] = [];
    if (jobId) {
      updates.push(
        db
          .update(generationJobs)
          .set({
            status: "failed",
            errorMessage: "Generation could not be persisted.",
            completedAt: failedAt,
            updatedAt: failedAt,
          })
          .where(eq(generationJobs.id, jobId)),
      );
    }
    if (projectId) {
      updates.push(
        db
          .update(projects)
          .set({ status: "failed", updatedAt: failedAt })
          .where(eq(projects.id, projectId)),
      );
    }
    await Promise.all(updates);
  } catch {
    // Avoid masking the original failure with a best-effort status update.
  }
}

async function refundChapterCredit(
  db: ReturnType<typeof getDb> | undefined,
  subscriptionId: string | undefined,
  starterPriceId: string,
) {
  if (!db || !subscriptionId) {
    return;
  }

  try {
    await db
      .update(subscriptions)
      .set({
        chapterCreditsRemaining: sql`least(${subscriptions.chapterCreditsRemaining} + 1, ${MAX_CHAPTER_CREDITS})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.stripePriceId, starterPriceId),
          inArray(
            subscriptions.status,
            ENTITLED_SUBSCRIPTION_STATUSES,
          ),
          or(
            isNull(subscriptions.currentPeriodEnd),
            gt(subscriptions.currentPeriodEnd, new Date()),
          ),
        ),
      );
  } catch {
    // Stripe remains the source of truth. A failed refund is deliberately not
    // allowed to mask the original request failure.
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

async function readJsonBody(
  request: Request,
): Promise<
  { ok: true; value: unknown } | { ok: false; error: string }
> {
  try {
    return { ok: true, value: (await request.json()) as unknown };
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
}

function generationError(error: unknown): Response {
  if (
    error instanceof Error &&
    error.message === "DATABASE_CONNECTION_STRING is not configured."
  ) {
    return json({ error: "Database service is not configured." }, 503);
  }
  return json({ error: "Storyboard generation could not be completed." }, 500);
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}
