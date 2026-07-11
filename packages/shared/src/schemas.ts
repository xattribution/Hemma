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

export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  color: z.string(),
  avatar: z.string(),
  sortOrder: z.number(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  role: roleSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  avatar: z.string().min(1).max(8),
  // Parents set a password (min 6); kids get a 4-digit PIN.
  credential: z.string().min(4).max(72),
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

export type Me =
  | { kind: "member"; member: Member; household: { name: string; timezone: string } }
  | { kind: "device"; label: string; household: { name: string; timezone: string } };

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
});
export type ChecklistInput = z.infer<typeof checklistInputSchema>;

export const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean(),
  checkedBy: z.string().nullable(),
  quantity: z.string().nullable(),
  sortOrder: z.number(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = checklistInputSchema.extend({
  id: z.string(),
  items: z.array(checklistItemSchema),
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
