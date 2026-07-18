import type { ActorRef, EventBus } from "@coord/plugin-sdk";
import type { CoordEvent, EditScope, EventInput, EventInstance } from "@coord/shared";
import { eventInputSchema } from "@coord/shared";
import type { Db } from "../../core/db.js";
import { now, uid } from "../../core/db.js";
import { recordAudit } from "../../core/audit.js";
import { expandOccurrences, withUntilBefore, type ExceptionSpec } from "./recurrence.js";

/**
 * Calendar services — the single write/read path for events. REST routes,
 * the seed script, tests, and future plugins (AI assistant, email ingest,
 * external calendar sync) all go through these functions.
 */

/** Whoever is asking; undefined = trusted internal call (seed, tests). */
export interface Viewer {
  kind: "member" | "device" | "agent";
  memberId: string | null;
  role: string | null;
}

/** Private items: creator + parents + agents. Displays and other kids: no. */
export function canView(viewer: Viewer | undefined, visibility: string, createdBy: string | null): boolean {
  if (visibility !== "private" || !viewer) return true;
  if (viewer.kind === "agent") return true;
  if (viewer.kind === "device") return false;
  return viewer.role === "parent" || (viewer.memberId !== null && viewer.memberId === createdBy);
}

interface EventRow {
  id: string;
  household_id: string;
  title: string;
  description: string;
  location: string;
  category: string;
  start_at: number;
  end_at: number;
  all_day: number;
  timezone: string;
  rrule: string | null;
  created_by: string | null;
  visibility: string;
}

function loadExceptions(db: Db, eventId: string): ExceptionSpec[] {
  const rows = db
    .prepare("SELECT occurrence_start, kind, override_json FROM event_exceptions WHERE event_id = ?")
    .all(eventId) as { occurrence_start: number; kind: "cancelled" | "moved"; override_json: string | null }[];
  return rows.map((r) => ({
    occurrenceStart: r.occurrence_start,
    kind: r.kind,
    override: r.override_json ? (JSON.parse(r.override_json) as Record<string, unknown>) : null,
  }));
}

function toApiEvent(db: Db, row: EventRow): CoordEvent {
  const assigneeIds = (
    db.prepare("SELECT member_id FROM event_assignees WHERE event_id = ?").all(row.id) as { member_id: string }[]
  ).map((r) => r.member_id);
  const reminder = db
    .prepare("SELECT offset_minutes FROM reminders WHERE entity_type = 'event' AND entity_id = ? LIMIT 1")
    .get(row.id) as { offset_minutes: number } | undefined;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    category: row.category as CoordEvent["category"],
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: !!row.all_day,
    timezone: row.timezone,
    rrule: row.rrule,
    assigneeIds,
    reminderMinutes: reminder?.offset_minutes ?? null,
    visibility: (row.visibility ?? "family") as CoordEvent["visibility"],
    createdBy: row.created_by,
  };
}

export function listInstances(db: Db, householdId: string, windowStart: number, windowEnd: number, viewer?: Viewer): EventInstance[] {
  const rows = (db
    .prepare(
      `SELECT * FROM events
       WHERE household_id = ? AND deleted_at IS NULL
         AND ((rrule IS NULL AND start_at < ? AND end_at > ?) OR (rrule IS NOT NULL AND start_at < ?))`,
    )
    .all(householdId, windowEnd, windowStart, windowEnd) as EventRow[])
    .filter((row) => canView(viewer, row.visibility, row.created_by));

  const instances: EventInstance[] = [];
  for (const row of rows) {
    const base = toApiEvent(db, row);
    const occurrences = expandOccurrences(
      { startAt: row.start_at, endAt: row.end_at, timezone: row.timezone, rrule: row.rrule },
      windowStart,
      windowEnd,
      row.rrule ? loadExceptions(db, row.id) : [],
    );
    for (const occ of occurrences) {
      const patch = (occ.override ?? {}) as Partial<EventInput>;
      instances.push({
        ...base,
        title: patch.title ?? base.title,
        description: patch.description ?? base.description,
        location: patch.location ?? base.location,
        category: patch.category ?? base.category,
        occurrenceStart: occ.occurrenceStart,
        occurrenceEnd: occ.occurrenceEnd,
        isException: occ.isException,
      });
    }
  }
  return instances.sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

function normalizeTimes(input: Pick<EventInput, "startAt" | "endAt" | "allDay">): { startAt: number; endAt: number } {
  const minDuration = input.allDay ? 24 * 3600_000 : 15 * 60_000;
  return {
    startAt: input.startAt,
    endAt: input.endAt > input.startAt ? input.endAt : input.startAt + minDuration,
  };
}

function setAssignees(db: Db, eventId: string, assigneeIds: string[]) {
  db.prepare("DELETE FROM event_assignees WHERE event_id = ?").run(eventId);
  const insert = db.prepare("INSERT OR IGNORE INTO event_assignees (event_id, member_id) VALUES (?, ?)");
  for (const memberId of assigneeIds) insert.run(eventId, memberId);
}

function setReminder(db: Db, householdId: string, eventId: string, minutes: number | null) {
  db.prepare("DELETE FROM reminders WHERE entity_type = 'event' AND entity_id = ?").run(eventId);
  if (minutes !== null) {
    db.prepare(
      "INSERT INTO reminders (id, household_id, entity_type, entity_id, offset_minutes, target) VALUES (?, ?, 'event', ?, ?, 'assignees')",
    ).run(uid(), householdId, eventId, minutes);
  }
}

export function createEvent(
  db: Db, bus: EventBus, householdId: string, actor: ActorRef,
  input: Omit<EventInput, "visibility"> & { visibility?: EventInput["visibility"] },
): string {
  const id = uid();
  const { startAt, endAt } = normalizeTimes(input);
  db.prepare(
    `INSERT INTO events (id, household_id, title, description, location, category, visibility, start_at, end_at, all_day, timezone, rrule, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, householdId, input.title, input.description, input.location, input.category, input.visibility ?? "family",
    startAt, endAt, input.allDay ? 1 : 0, input.timezone, input.rrule, actor.memberId, now(), now(),
  );
  setAssignees(db, id, input.assigneeIds);
  setReminder(db, householdId, id, input.reminderMinutes);
  recordAudit(db, householdId, actor, "event", id, "create", `${actor.name} added "${input.title}"`);
  bus.emit("event.created", { eventId: id, title: input.title, actor });
  return id;
}

export interface UpdateArgs {
  scope: EditScope;
  /** Required for single/future edits of recurring events. */
  occurrenceStart?: number;
  patch: Partial<EventInput>;
}

export function updateEvent(db: Db, bus: EventBus, householdId: string, actor: ActorRef, eventId: string, args: UpdateArgs): void {
  const row = db
    .prepare("SELECT * FROM events WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
    .get(eventId, householdId) as EventRow | undefined;
  if (!row) throw Object.assign(new Error("Event not found"), { statusCode: 404 });

  const patch = eventInputSchema.partial().parse(args.patch);
  const scope: EditScope = row.rrule ? args.scope : "all";

  if (scope === "single") {
    if (args.occurrenceStart === undefined) {
      throw Object.assign(new Error("occurrenceStart required for single-occurrence edits"), { statusCode: 400 });
    }
    db.prepare(
      `INSERT INTO event_exceptions (event_id, occurrence_start, kind, override_json) VALUES (?, ?, 'moved', ?)
       ON CONFLICT (event_id, occurrence_start) DO UPDATE SET kind = 'moved', override_json = excluded.override_json`,
    ).run(eventId, args.occurrenceStart, JSON.stringify(patch));
  } else if (scope === "future") {
    if (args.occurrenceStart === undefined) {
      throw Object.assign(new Error("occurrenceStart required for future edits"), { statusCode: 400 });
    }
    // End the existing series before this occurrence, then start a new event.
    db.prepare("UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?").run(
      withUntilBefore(row.rrule!, args.occurrenceStart, row.timezone),
      now(),
      eventId,
    );
    const base = toApiEvent(db, row);
    const duration = row.end_at - row.start_at;
    const newStart = patch.startAt ?? args.occurrenceStart;
    createEvent(db, bus, householdId, actor, {
      ...base,
      ...patch,
      startAt: newStart,
      endAt: patch.endAt ?? newStart + duration,
      rrule: patch.rrule !== undefined ? patch.rrule : row.rrule,
      assigneeIds: patch.assigneeIds ?? base.assigneeIds,
      reminderMinutes: patch.reminderMinutes !== undefined ? patch.reminderMinutes : base.reminderMinutes,
    });
  } else {
    // scope === "all": patch the master. For recurring events a time change
    // shifts the whole series by the delta from the edited occurrence.
    let startAt = row.start_at;
    let endAt = row.end_at;
    if (patch.startAt !== undefined) {
      const anchor = row.rrule ? (args.occurrenceStart ?? row.start_at) : row.start_at;
      startAt = row.start_at + (patch.startAt - anchor);
      const duration = (patch.endAt ?? patch.startAt + (row.end_at - row.start_at)) - patch.startAt;
      endAt = startAt + duration;
    }
    db.prepare(
      `UPDATE events SET title = ?, description = ?, location = ?, category = ?, visibility = ?, start_at = ?, end_at = ?,
       all_day = ?, timezone = ?, rrule = ?, updated_at = ? WHERE id = ?`,
    ).run(
      patch.title ?? row.title,
      patch.description ?? row.description,
      patch.location ?? row.location,
      patch.category ?? row.category,
      patch.visibility ?? row.visibility ?? "family",
      startAt,
      endAt,
      (patch.allDay ?? !!row.all_day) ? 1 : 0,
      patch.timezone ?? row.timezone,
      patch.rrule !== undefined ? patch.rrule : row.rrule,
      now(),
      eventId,
    );
    if (patch.assigneeIds) setAssignees(db, eventId, patch.assigneeIds);
    if (patch.reminderMinutes !== undefined) setReminder(db, householdId, eventId, patch.reminderMinutes);
  }

  const title = patch.title ?? row.title;
  recordAudit(db, householdId, actor, "event", eventId, "update", `${actor.name} updated "${title}"`, { scope, patch });
  bus.emit("event.updated", { eventId, title, actor });
}

export function deleteEvent(
  db: Db,
  bus: EventBus,
  householdId: string,
  actor: ActorRef,
  eventId: string,
  scope: EditScope,
  occurrenceStart?: number,
): void {
  const row = db
    .prepare("SELECT * FROM events WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
    .get(eventId, householdId) as EventRow | undefined;
  if (!row) throw Object.assign(new Error("Event not found"), { statusCode: 404 });

  const effectiveScope: EditScope = row.rrule ? scope : "all";
  if (effectiveScope === "single" && occurrenceStart !== undefined) {
    db.prepare(
      `INSERT INTO event_exceptions (event_id, occurrence_start, kind, override_json) VALUES (?, ?, 'cancelled', NULL)
       ON CONFLICT (event_id, occurrence_start) DO UPDATE SET kind = 'cancelled', override_json = NULL`,
    ).run(eventId, occurrenceStart);
  } else if (effectiveScope === "future" && occurrenceStart !== undefined) {
    db.prepare("UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?").run(
      withUntilBefore(row.rrule!, occurrenceStart, row.timezone),
      now(),
      eventId,
    );
  } else {
    db.prepare("UPDATE events SET deleted_at = ? WHERE id = ?").run(now(), eventId);
    db.prepare("DELETE FROM reminders WHERE entity_type = 'event' AND entity_id = ?").run(eventId);
  }
  recordAudit(db, householdId, actor, "event", eventId, "delete", `${actor.name} removed "${row.title}"`);
  bus.emit("event.deleted", { eventId, title: row.title, actor });
}
