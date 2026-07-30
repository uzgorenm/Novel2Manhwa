import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auth0Sub: text("auth0_sub").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    stripeCustomerId: text("stripe_customer_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_auth0_sub_uidx").on(table.auth0Sub),
    uniqueIndex("users_stripe_customer_id_uidx").on(table.stripeCustomerId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    chapterTitle: text("chapter_title").notNull(),
    manuscript: text("manuscript").notNull(),
    stylePreset: text("style_preset").notNull(),
    status: text("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    index("projects_owner_created_idx").on(table.userId, table.createdAt),
  ],
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").default("queued").notNull(),
    generationSource: text("generation_source"),
    textModel: text("text_model"),
    imageModel: text("image_model"),
    idempotencyKey: text("idempotency_key"),
    panelCount: integer("panel_count").default(0).notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    index("generation_jobs_owner_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("generation_jobs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    uniqueIndex("generation_jobs_owner_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const panels = pgTable(
  "panels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    generationJobId: uuid("generation_job_id")
      .notNull()
      .references(() => generationJobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    shot: text("shot").notNull(),
    narration: text("narration").default("").notNull(),
    dialogue: text("dialogue").default("").notNull(),
    balloonType: text("balloon_type").default("none").notNull(),
    balloonPlacement: text("balloon_placement").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("panels_job_sequence_uidx").on(
      table.generationJobId,
      table.sequence,
    ),
    index("panels_project_sequence_idx").on(table.projectId, table.sequence),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripePriceId: text("stripe_price_id"),
    status: text("status").notNull(),
    chapterCreditsRemaining: integer("chapter_credits_remaining")
      .default(0)
      .notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
      mode: "date",
    }),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }),
    lastStripeEventCreatedAt: timestamp("last_stripe_event_created_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    index("subscriptions_owner_idx").on(table.userId),
    uniqueIndex("subscriptions_stripe_subscription_id_uidx").on(
      table.stripeSubscriptionId,
    ),
    index("subscriptions_stripe_customer_id_idx").on(table.stripeCustomerId),
  ],
);

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    stripeCreatedAt: timestamp("stripe_created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("stripe_webhook_events_processed_idx").on(table.processedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Panel = typeof panels.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
