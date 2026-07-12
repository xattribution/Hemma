import { z } from "zod";

// ---------- Constants ----------

export const MEMBER_COLORS = [
  "#e05d5d", "#e08f3c", "#d9a900", "#5aa832", "#2f9e8f",
  "#3d87c9", "#7a6fd0", "#c364ab", "#8a6d4f", "#5a7d8c",
] as const;

export const AVATARS = [
  "🦊", "🐻", "🐰", "🦉", "🐸", "🐙", "🦄", "🐝", "🐢", "🐬",
  "🦁", "🐼", "🐨", "🦋", "🌻", "🌈", "⭐", "🚀", "⚽", "🎨",
] as const;

export const EVENT_CATEGORIES = {
  family: { label: "Family", color: "#e05d5d", icon: "🏠" },
  school: { label: "School", color: "#3d87c9", icon: "🎒" },
  sports: { label: "Sports", color: "#5aa832", icon: "⚽" },
  work: { label: "Work", color: "#5a7d8c", icon: "💼" },
  appointment: { label: "Appointment", color: "#7a6fd0", icon: "🩺" },
  birthday: { label: "Birthday", color: "#c364ab", icon: "🎂" },
  holiday: { label: "Holiday", color: "#e08f3c", icon: "🎉" },
  other: { label: "Other", color: "#8a6d4f", icon: "📌" },
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

export const grantSchema = z.enum(["event.manage", "task.manage", "checklist.manage"]);

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
  layout: z.enum(["dashboard", "calendar", "lists"]).default("dashboard"),
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

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  location: z.string().max(200).default(""),
  category: eventCategorySchema.default("family"),
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

// ---------- Tasks & chores ----------

export const taskKindSchema = z.enum(["chore", "todo"]);

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
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskSchema = taskInputSchema.extend({
  id: z.string(),
  createdBy: z.string().nullable(),
  /** ISO date (YYYY-MM-DD, household tz) this occurrence refers to; null for one-off. */
  occurrenceDate: z.string().nullable(),
  dueToday: z.boolean(),
  completed: z.boolean(),
  completedBy: z.string().nullable(),
  completedAt: z.number().int().nullable(),
});
export type Task = z.infer<typeof taskSchema>;

// ---------- Checklists ----------

export const checklistKindSchema = z.enum(["shopping", "checklist", "packing"]);

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

// ---------- Dashboard ----------

export type DashboardToday = {
  date: string;
  household: { name: string; timezone: string };
  events: EventInstance[];
  tomorrowEvents: EventInstance[];
  choresByMember: { member: Member; tasks: Task[] }[];
  pinnedLists: Checklist[];
};
