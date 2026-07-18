import { z } from "zod";

// ---------- Constants ----------

export const MEMBER_COLORS = [
  "#d97b72", "#dda15e", "#c9a227", "#7fb069", "#5fa8a0",
  "#6f9ccb", "#9d8bd0", "#c98bb5", "#a08066", "#7d95a3",
] as const;

export const AVATARS = [
  "🦊", "🐻", "🐰", "🦉", "🐸", "🐙", "🦄", "🐝", "🐢", "🐬",
  "🦁", "🐼", "🐨", "🦋", "🌻", "🌈", "⭐", "🚀", "⚽", "🎨",
] as const;

export const EVENT_CATEGORIES = {
  family: { label: "Family", color: "#d97b72", icon: "🏠" },
  school: { label: "School", color: "#6f9ccb", icon: "🎒" },
  sports: { label: "Sports", color: "#7fb069", icon: "⚽" },
  work: { label: "Work", color: "#7d95a3", icon: "💼" },
  appointment: { label: "Appointment", color: "#9d8bd0", icon: "🩺" },
  birthday: { label: "Birthday", color: "#c98bb5", icon: "🎂" },
  holiday: { label: "Holiday", color: "#dda15e", icon: "🎉" },
  other: { label: "Other", color: "#a08066", icon: "📌" },
} as const;

export type EventCategory = keyof typeof EVENT_CATEGORIES;
export const eventCategorySchema = z.enum(
  Object.keys(EVENT_CATEGORIES) as [EventCategory, ...EventCategory[]],
);

// ---------- Members & auth ----------

export const roleSchema = z.enum(["parent", "child"]);
export type Role = z.infer<typeof roleSchema>;

export const credentialTypeSchema = z.enum(["password", "pin", "pattern"]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

/**
 * The 3×3 picture-pattern grid (kid-friendly credential): a pattern is 4
 * taps on this fixed grid, encoded as "pat:" + the four cell indices,
 * e.g. cat-goat-cat-horse → "pat:0403".
 */
export const PATTERN_ANIMALS = ["🐱", "🐶", "🐰", "🐴", "🐐", "🐸", "🐼", "🦊", "🐢"] as const;
export const PATTERN_REGEX = /^pat:[0-8]{4}$/;

export const grantSchema = z.enum(["event.manage", "task.manage", "checklist.manage", "messages.use"]);

export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  color: z.string(),
  avatar: z.string(),
  sortOrder: z.number(),
  credentialType: credentialTypeSchema,
  /** Extra capabilities granted to a kid (parents implicitly have all). */
  grants: z.array(grantSchema),
  /** Kid UI tier: 'little' = giant Fisher-Price UI; 'teen'/null = standard. */
  uiLevel: z.enum(["little", "teen"]).nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  role: roleSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  avatar: z.string().min(1).max(8),
  // Parents: password (min 6). Kids: 4-digit PIN, or a picture pattern ("pat:0403").
  credential: z.string().min(4).max(72),
  credentialType: credentialTypeSchema.optional(),
  grants: z.array(grantSchema).optional(),
  uiLevel: z.enum(["little", "teen"]).nullable().optional(),
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const setupInputSchema = z.object({
  householdName: z.string().trim().min(1).max(60),
  timezone: z.string().min(1),
  owner: memberInputSchema.omit({ role: true }),
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const loginInputSchema = z.object({
  memberId: z.string(),
  credential: z.string().min(1).max(72),
});

// ---------- Displays ----------

/** What a shared display (kitchen tablet, living-room screen…) shows. */
export const displayConfigSchema = z.object({
  layout: z.enum(["dashboard", "calendar", "lists", "photos"]).default("dashboard"),
  showEvents: z.boolean().default(true),
  showChores: z.boolean().default(true),
  showLists: z.boolean().default(true),
  /**
   * Always-on trust model: the display is freely readable, but changing
   * anything asks "who's doing this?" — a quick avatar + password/PIN/
   * pattern check that acts as that member for a couple of minutes.
   */
  requireAuthToChange: z.boolean().default(true),
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;
export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  layout: "dashboard",
  showEvents: true,
  showChores: true,
  showLists: true,
  requireAuthToChange: true,
};

export interface DisplayInfo {
  id: string;
  label: string;
  /** Retrievable — display links are shareable within the family. */
  token: string | null;
  config: DisplayConfig;
  createdAt: number;
}

export type Me =
  | { kind: "member"; member: Member; household: { name: string; timezone: string } }
  | {
      kind: "device";
      label: string;
      config: DisplayConfig;
      /** Who the display is currently acting as, if someone verified themselves. */
      elevation: { member: Member; until: number } | null;
      household: { name: string; timezone: string };
    };

// ---------- Events ----------

/**
 * Who an item is for. 'family' = the whole household; 'private' = just its
 * creator (parents and connected AIs can always read everything — private
 * items of others are hidden by default in their UI, never from them).
 * Displays and kids never receive other people's private items at all.
 */
export const visibilitySchema = z.enum(["family", "private"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  location: z.string().max(200).default(""),
  category: eventCategorySchema.default("family"),
  visibility: visibilitySchema.default("family"),
  startAt: z.number().int(), // UTC ms
  endAt: z.number().int(),
  allDay: z.boolean().default(false),
  timezone: z.string().min(1),
  rrule: z.string().max(500).nullable().default(null),
  assigneeIds: z.array(z.string()).default([]),
  reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().default(null),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventSchema = eventInputSchema.extend({
  id: z.string(),
  createdBy: z.string().nullable(),
  /** Set when the event came from a subscribed calendar (read-only here). */
  sourceLabel: z.string().nullable().default(null),
});
export type CoordEvent = z.infer<typeof eventSchema>;

/** A concrete occurrence of an event within a queried window. */
export const eventInstanceSchema = eventSchema.extend({
  /** UTC ms identifying which occurrence of a recurring event this is. */
  occurrenceStart: z.number().int(),
  occurrenceEnd: z.number().int(),
  isException: z.boolean(),
});
export type EventInstance = z.infer<typeof eventInstanceSchema>;

export const editScopeSchema = z.enum(["single", "future", "all"]);
export type EditScope = z.infer<typeof editScopeSchema>;

// ---------- Family messages & file transfers ----------

/** One sealed file moving between two families (chunked, resumable). */
export const fedTransferSchema = z.object({
  id: z.string(),
  peerId: z.string(),
  direction: z.enum(["in", "out"]),
  name: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  chunks: z.number().int(),
  status: z.enum(["offered", "sending", "receiving", "done", "declined", "failed"]),
  /** Chunks moved so far — progress = this / chunks. */
  progress: z.number().int(),
  /** Where an accepted file landed: 'nas' or 'app' (null until accepted). */
  dest: z.enum(["nas", "app"]).nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
});
export type FedTransfer = z.infer<typeof fedTransferSchema>;

export const fedMessageSchema = z.object({
  id: z.string(),
  peerId: z.string(),
  direction: z.enum(["in", "out"]),
  /** Display name: local member (out) or "Name (Family)" (in). */
  sender: z.string(),
  kind: z.enum(["text", "file"]),
  body: z.string(),
  transferId: z.string().nullable(),
  createdAt: z.number(),
});
export type FedMessage = z.infer<typeof fedMessageSchema>;

export const messageThreadSchema = z.object({
  peerId: z.string(),
  peerName: z.string(),
  lastMessage: fedMessageSchema.nullable(),
  unread: z.number().int(),
});
export type MessageThread = z.infer<typeof messageThreadSchema>;

// ---------- Calendar subscriptions (ICS feeds) ----------

/**
 * A read-only feed from another calendar (Google's "secret address", iCloud
 * public links, Outlook published calendars, TeamSnap/school "subscribe"
 * links). Hemma polls it and mirrors matching events; nothing is ever sent
 * back. Imported events carry sourceLabel and can't be edited in Hemma.
 */
export const calSubscriptionInputSchema = z.object({
  /** Shown on imported events; defaults to the feed's own calendar name. */
  label: z.string().trim().max(60).default(""),
  url: z.string().trim().min(1).max(2000),
  category: eventCategorySchema.default("other"),
  visibility: visibilitySchema.default("family"),
  /** Whose calendar this is — imported events get this assignee's color. */
  assigneeId: z.string().nullable().default(null),
  /** Only import events whose title contains one of these words (empty = all). */
  includeKeywords: z.string().max(300).default(""),
  /** Skip events whose title contains one of these words. */
  excludeKeywords: z.string().max(300).default(""),
  skipAllDay: z.boolean().default(false),
});
export type CalSubscriptionInput = z.infer<typeof calSubscriptionInputSchema>;

export const calSubscriptionSchema = calSubscriptionInputSchema.extend({
  id: z.string(),
  lastSyncAt: z.number().nullable(),
  /** "ok: 12 events" or a short human-readable error from the last sync. */
  lastStatus: z.string().nullable(),
  eventCount: z.number().int(),
  createdAt: z.number(),
});
export type CalSubscription = z.infer<typeof calSubscriptionSchema>;

// ---------- Tasks & chores ----------

export const taskKindSchema = z.enum(["chore", "todo"]);

/**
 * A sub-step of one chore. Steps can carry their own assignee (family/group
 * chores: "clean the kitchen — Mia: floor, Leo: dishes") and their own
 * points. Bare strings are accepted everywhere for back-compat and upgraded
 * to { text } objects.
 */
export const taskStepSchema = z.object({
  text: z.string().trim().min(1).max(120),
  assigneeId: z.string().nullable().default(null),
  points: z.number().int().min(0).max(1000).nullable().default(null),
});
export type TaskStep = z.infer<typeof taskStepSchema>;
export const taskStepInputSchema = z
  .union([z.string().trim().min(1).max(120), taskStepSchema])
  .transform((step): TaskStep =>
    typeof step === "string" ? { text: step, assigneeId: null, points: null } : step,
  );

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(1000).default(""),
  icon: z.string().max(8).default("⭐"),
  kind: taskKindSchema.default("chore"),
  assigneeId: z.string().nullable().default(null),
  dueAt: z.number().int().nullable().default(null),
  /** For recurring chores: "daily" | "weekdays" | comma list of weekday numbers 0-6 (Sun=0). */
  repeat: z.string().max(40).nullable().default(null),
  points: z.number().int().min(0).max(1000).nullable().default(null),
  /** Sub-steps shown inside the one chore ("vacuum", "fluff pillows", …). */
  steps: z.array(taskStepInputSchema).max(20).default([]),
  visibility: visibilitySchema.default("family"),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskSchema = taskInputSchema.extend({
  id: z.string(),
  steps: z.array(taskStepSchema),
  createdBy: z.string().nullable(),
  /** ISO date (YYYY-MM-DD, household tz) this occurrence refers to; null for one-off. */
  occurrenceDate: z.string().nullable(),
  /** Indices of steps checked off for this occurrence. */
  stepsDone: z.array(z.number().int()),
  dueToday: z.boolean(),
  completed: z.boolean(),
  completedBy: z.string().nullable(),
  completedAt: z.number().int().nullable(),
});
export type Task = z.infer<typeof taskSchema>;

// ---------- Checklists ----------

export const checklistKindSchema = z.enum(["shopping", "checklist", "packing", "meal"]);

export const checklistInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  icon: z.string().max(8).default("🛒"),
  kind: checklistKindSchema.default("shopping"),
  pinnedToDashboard: z.boolean().default(false),
  /** Optional deadline (UTC ms) — the list surfaces in that day's summary. */
  needBy: z.number().int().nullable().default(null),
  /** Optional event link — the list rides along with the event's day(s). */
  linkedEventId: z.string().nullable().default(null),
});
export type ChecklistInput = z.infer<typeof checklistInputSchema>;

/** Colors for store quick-tags; assigned deterministically when a store is first used. */
export const STORE_COLORS = [
  "#3d87c9", "#5aa832", "#e08f3c", "#7a6fd0", "#c364ab",
  "#2f9e8f", "#d9a900", "#e05d5d", "#5a7d8c", "#8a6d4f",
] as const;

export interface StoreTag {
  name: string;
  color: string;
}

export const checklistItemInputSchema = z.object({
  text: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(40).nullable().default(null),
  /** Store tag, e.g. "Costco" — "eggs from Costco" lands here. */
  store: z.string().trim().max(40).nullable().default(null),
  /** Meal-plan lists: also drop this item onto the default grocery list. */
  alsoGrocery: z.boolean().default(false),
});
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

export const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean(),
  checkedBy: z.string().nullable(),
  quantity: z.string().nullable(),
  store: z.string().nullable(),
  sortOrder: z.number(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = checklistInputSchema.extend({
  id: z.string(),
  items: z.array(checklistItemSchema),
  /** Title of the linked event, resolved server-side for display. */
  linkedEventTitle: z.string().nullable(),
});
export type Checklist = z.infer<typeof checklistSchema>;

// ---------- Audit / history ----------

export const auditEntrySchema = z.object({
  id: z.number(),
  actorId: z.string().nullable(),
  actorName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  summary: z.string(),
  createdAt: z.number(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

// ---------- Points ----------

/**
 * Points are a ledger, not a counter: every award/deduction is a row with a
 * reason, so totals are auditable and reversible. Chore points land ONLY
 * when the whole task completes (step points go to whoever checked the
 * step); parents can adjust manually (bonuses / bad behavior).
 */
export const pointsEntrySchema = z.object({
  id: z.number(),
  memberId: z.string(),
  delta: z.number().int(),
  reason: z.string(),
  source: z.enum(["task", "step", "manual"]),
  taskId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
});
export type PointsEntry = z.infer<typeof pointsEntrySchema>;

export const pointsAdjustSchema = z.object({
  memberId: z.string(),
  delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, "Zero changes nothing"),
  reason: z.string().trim().min(1).max(200),
});

/**
 * A goal frames a window of the ledger. The primitives are deliberately
 * few — window + target + participants + mode — so future reward schemes
 * (allowance, streaks…) can reuse the same plumbing.
 *  - mode "target": everyone fills their own bar to `target`
 *  - mode "race":   first participant past `target` wins
 *  - repeat "monthly": the window resets each calendar month
 *  - endsAt: optional deadline ("earn 50 by the 30th")
 */
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  icon: z.string().max(8).default("🏆"),
  mode: z.enum(["target", "race"]).default("target"),
  target: z.number().int().min(1).max(100000),
  /** null = every kid; otherwise explicit member ids (adults allowed too). */
  memberIds: z.array(z.string()).nullable().default(null),
  startsAt: z.number().int(),
  endsAt: z.number().int().nullable().default(null),
  repeat: z.enum(["none", "monthly"]).default("none"),
  /** Free-text reward ("movie night", "$10") — display only. */
  reward: z.string().max(120).default(""),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export const goalSchema = goalInputSchema.extend({ id: z.string(), createdAt: z.number() });
export type PointGoal = z.infer<typeof goalSchema>;

export interface GoalStanding {
  memberId: string;
  earned: number; // within the goal's current window (never below 0 for display)
  reached: boolean;
  /** race mode: ms when this member crossed the target (winner = earliest). */
  reachedAt: number | null;
}

export interface PointsSummary {
  totals: { memberId: string; total: number }[];
  goals: { goal: PointGoal; windowStart: number; windowEnd: number | null; standings: GoalStanding[] }[];
  recent: PointsEntry[];
}

// ---------- Dashboard ----------

export type DashboardToday = {
  date: string;
  household: { name: string; timezone: string };
  events: EventInstance[];
  tomorrowEvents: EventInstance[];
  choresByMember: { member: Member; tasks: Task[] }[];
  pinnedLists: Checklist[];
};
