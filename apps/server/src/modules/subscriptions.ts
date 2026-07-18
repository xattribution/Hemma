import crypto from "node:crypto";
import ical from "node-ical";
import type { CoreModule } from "../core/plugin-host.js";
import type { Db } from "../core/db.js";
import { now, uid } from "../core/db.js";
import { requireActor } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { recordAudit } from "../core/audit.js";
import { utcOfWall } from "../core/tz.js";
import { calSubscriptionInputSchema, type CalSubscription } from "@coord/shared";

/**
 * Calendar subscriptions: read-only ICS feeds (Google "secret address",
 * iCloud public calendar links, Outlook published calendars, TeamSnap/
 * school "subscribe" links). A poller re-fetches every feed periodically;
 * each sync atomically replaces that feed's events. Imported events carry
 * source_sub_id — the calendar module refuses to edit/delete them, the UI
 * badges them with the feed's label, and deleting the subscription sweeps
 * them all away. Nothing is ever written back to the source calendar.
 */

const SYNC_EVERY_SECONDS = 30 * 60;
const MAX_EVENTS_PER_FEED = 500;
const MAX_FEED_BYTES = 10 * 1024 * 1024;
/** One-off events outside this window aren't imported (recurring ones are). */
const PAST_WINDOW_MS = 60 * 86_400_000;
const FUTURE_WINDOW_MS = 550 * 86_400_000;

interface SubRow {
  id: string;
  household_id: string;
  label: string;
  url: string;
  category: string;
  visibility: string;
  assignee_id: string | null;
  include_keywords: string;
  exclude_keywords: string;
  skip_all_day: number;
  last_sync_at: number | null;
  last_status: string | null;
  created_at: number;
}

const keywordsOf = (raw: string) =>
  raw.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);

const eventIdFor = (subId: string, uidValue: string) =>
  `sub_${subId.slice(0, 8)}_${crypto.createHash("sha1").update(uidValue).digest("hex").slice(0, 20)}`;

function toApiSub(db: Db, row: SubRow): CalSubscription {
  const count = (db.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE source_sub_id = ? AND deleted_at IS NULL",
  ).get(row.id) as { n: number }).n;
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    category: row.category as CalSubscription["category"],
    visibility: row.visibility as CalSubscription["visibility"],
    assigneeId: row.assignee_id,
    includeKeywords: row.include_keywords,
    excludeKeywords: row.exclude_keywords,
    skipAllDay: !!row.skip_all_day,
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    eventCount: count,
    createdAt: row.created_at,
  };
}

/** webcal:// is just https:// wearing a hat (iCloud hands these out). */
function normalizeUrl(raw: string): string {
  const url = raw.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("That doesn't look like a calendar link — it should start with https:// or webcal://");
  }
  return url;
}

async function fetchFeed(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "text/calendar, text/plain, */*", "user-agent": "Hemma/1.0 (calendar subscription)" },
      redirect: "follow",
    });
  } catch {
    throw new Error("Couldn't reach that address — check the link and your internet connection");
  }
  if (!res.ok) {
    throw new Error(res.status === 404 || res.status === 410
      ? "That link doesn't work anymore — grab a fresh one from the original calendar"
      : `The calendar's server said no (error ${res.status})`);
  }
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error("That calendar is too large to import");
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new Error("That link didn't contain a calendar — make sure it's the iCal/ICS address, not a web page");
  }
  return text;
}

/** node-ical's rrule objects stringify as "DTSTART...\nRRULE:..." — keep the rule only. */
function rruleStringOf(ev: ical.VEvent): string | null {
  const rule = (ev as { rrule?: { toString(): string } }).rrule;
  if (!rule) return null;
  const line = rule.toString().split("\n").find((l) => l.startsWith("RRULE:"));
  return line ? line.slice("RRULE:".length) : null;
}

interface ImportedEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  exdates: number[];
}

/** Turn a parsed feed into rows, applying the subscription's filters. */
export function eventsOf(
  parsed: ical.CalendarResponse,
  sub: Pick<SubRow, "id" | "include_keywords" | "exclude_keywords" | "skip_all_day">,
  householdTz: string,
  nowMs: number,
): { events: ImportedEvent[]; calName: string | null; skipped: number } {
  const include = keywordsOf(sub.include_keywords);
  const exclude = keywordsOf(sub.exclude_keywords);
  const events: ImportedEvent[] = [];
  let calName: string | null = null;
  let skipped = 0;

  const push = (ev: ical.VEvent, idSuffix: string, withRrule: boolean) => {
    const title = String(ev.summary ?? "").trim().slice(0, 120) || "(untitled)";
    const lower = title.toLowerCase();
    if (include.length && !include.some((k) => lower.includes(k))) return;
    if (exclude.some((k) => lower.includes(k))) return;

    const allDay = (ev as { datetype?: string }).datetype === "date";
    if (allDay && sub.skip_all_day) return;
    if (!ev.start) return;

    const rrule = withRrule ? rruleStringOf(ev) : null;
    let startAt: number;
    let endAt: number;
    let timezone = householdTz;
    if (allDay) {
      // DATE values parse as UTC midnight; pin them to the household's day.
      const s = ev.start as Date;
      const e = (ev.end as Date | undefined) ?? s;
      startAt = utcOfWall({ year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate(), hour: 0, minute: 0, second: 0 }, householdTz);
      endAt = utcOfWall({ year: e.getUTCFullYear(), month: e.getUTCMonth(), day: e.getUTCDate(), hour: 0, minute: 0, second: 0 }, householdTz);
      if (endAt <= startAt) endAt = startAt + 86_400_000;
    } else {
      startAt = (ev.start as Date).getTime();
      endAt = (ev.end as Date | undefined)?.getTime() ?? startAt + 3600_000;
      if (endAt <= startAt) endAt = startAt + 3600_000;
      timezone = (ev.start as { tz?: string }).tz ?? householdTz;
    }
    if (!rrule && (startAt < nowMs - PAST_WINDOW_MS || startAt > nowMs + FUTURE_WINDOW_MS)) return;

    if (events.length >= MAX_EVENTS_PER_FEED) {
      skipped++;
      return;
    }
    const exdates = rrule
      ? Object.values((ev.exdate ?? {}) as Record<string, Date>).map((d) => d.getTime())
      : [];
    events.push({
      id: eventIdFor(sub.id, idSuffix),
      title,
      description: String(ev.description ?? "").slice(0, 2000),
      location: String(ev.location ?? "").slice(0, 200),
      startAt, endAt, allDay, timezone, rrule, exdates,
    });
  };

  for (const component of Object.values(parsed)) {
    if (!component) continue;
    if (component.type === "VCALENDAR") {
      const name = (component as Record<string, unknown>)["WR-CALNAME"];
      if (typeof name === "string" && name.trim()) calName = name.trim().slice(0, 60);
      continue;
    }
    if (component.type !== "VEVENT") continue;
    const ev = component as ical.VEvent;
    const uidValue = String(ev.uid ?? crypto.randomUUID());
    push(ev, uidValue, true);
    // Modified occurrences ("this practice moved to 6pm") arrive as override
    // VEVENTs keyed by recurrence id: cancel the original slot, import the
    // override as its own one-off.
    const recurrences = (ev as { recurrences?: Record<string, ical.VEvent> }).recurrences;
    if (recurrences) {
      const parent = events.find((e) => e.id === eventIdFor(sub.id, uidValue));
      for (const [recurId, override] of Object.entries(recurrences)) {
        const originalStart = (override as { recurrenceid?: Date }).recurrenceid?.getTime();
        if (parent && originalStart) parent.exdates.push(originalStart);
        push(override, `${uidValue}:${recurId}`, false);
      }
    }
  }
  return { events, calName, skipped };
}

/** Fetch + parse + atomically replace this subscription's events. */
export async function syncSubscription(
  db: Db,
  sub: SubRow,
  log: (msg: string) => void,
): Promise<{ ok: boolean; status: string }> {
  let status: string;
  let ok = false;
  try {
    const text = await fetchFeed(normalizeUrl(sub.url));
    const parsed = ical.sync.parseICS(text);
    const householdTz =
      (db.prepare("SELECT timezone FROM households WHERE id = ?").get(sub.household_id) as { timezone: string } | undefined)
        ?.timezone ?? "UTC";
    const { events, calName, skipped } = eventsOf(parsed, sub, householdTz, now());

    const replace = db.transaction(() => {
      db.prepare("DELETE FROM event_exceptions WHERE event_id IN (SELECT id FROM events WHERE source_sub_id = ?)").run(sub.id);
      db.prepare("DELETE FROM event_assignees WHERE event_id IN (SELECT id FROM events WHERE source_sub_id = ?)").run(sub.id);
      db.prepare("DELETE FROM events WHERE source_sub_id = ?").run(sub.id);
      const insert = db.prepare(
        `INSERT INTO events (id, household_id, title, description, location, category, visibility, start_at, end_at,
           all_day, timezone, rrule, created_by, source_sub_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      );
      const insertExdate = db.prepare(
        "INSERT OR IGNORE INTO event_exceptions (event_id, occurrence_start, kind, override_json) VALUES (?, ?, 'cancelled', NULL)",
      );
      const insertAssignee = db.prepare("INSERT OR IGNORE INTO event_assignees (event_id, member_id) VALUES (?, ?)");
      for (const ev of events) {
        insert.run(
          ev.id, sub.household_id, ev.title, ev.description, ev.location, sub.category, sub.visibility,
          ev.startAt, ev.endAt, ev.allDay ? 1 : 0, ev.timezone, ev.rrule, sub.id, now(), now(),
        );
        for (const ex of ev.exdates) insertExdate.run(ev.id, ex);
        if (sub.assignee_id) insertAssignee.run(ev.id, sub.assignee_id);
      }
      // First successful sync names the subscription after the feed itself.
      if (!sub.label && calName) {
        db.prepare("UPDATE cal_subscriptions SET label = ? WHERE id = ?").run(calName, sub.id);
      }
    });
    replace();
    status = `ok: ${events.length} events`;
    if (skipped) {
      status += ` (${skipped} beyond the ${MAX_EVENTS_PER_FEED}-event limit were left out)`;
      log(`subscription ${sub.id}: dropped ${skipped} events over cap`);
    }
    ok = true;
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
    log(`subscription sync failed (${sub.url}): ${status}`);
  }
  db.prepare("UPDATE cal_subscriptions SET last_sync_at = ?, last_status = ? WHERE id = ?").run(now(), status, sub.id);
  return { ok, status };
}

export const subscriptionsModule: CoreModule = {
  id: "core.calsync",
  name: "Calendar subscriptions",
  description: "Follow calendars you already use (Google, iCloud, Outlook, team apps) — read-only, always up to date.",
  register({ app, db, scheduler, broadcast, log }) {
    const subById = (id: string, householdId: string) =>
      db.prepare("SELECT * FROM cal_subscriptions WHERE id = ? AND household_id = ?").get(id, householdId) as SubRow | undefined;
    const notify = () => broadcast({ type: "invalidate", keys: ["events", "dashboard"] });

    scheduler.every("cal-subscriptions", SYNC_EVERY_SECONDS, async () => {
      const subs = db.prepare("SELECT * FROM cal_subscriptions").all() as SubRow[];
      let changed = false;
      for (const sub of subs) {
        const { ok } = await syncSubscription(db, sub, log);
        changed = changed || ok;
      }
      if (changed) notify();
    });

    app.get("/api/subscriptions", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const rows = db
        .prepare("SELECT * FROM cal_subscriptions WHERE household_id = ? ORDER BY created_at")
        .all(access.householdId) as SubRow[];
      return { subscriptions: rows.map((r) => toApiSub(db, r)) };
    });

    app.post("/api/subscriptions", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const input = calSubscriptionInputSchema.parse(req.body);
      try {
        normalizeUrl(input.url);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "Bad link" });
      }
      const id = uid();
      db.prepare(
        `INSERT INTO cal_subscriptions (id, household_id, label, url, category, visibility, assignee_id,
           include_keywords, exclude_keywords, skip_all_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, access.householdId, input.label, input.url, input.category, input.visibility,
        input.assigneeId, input.includeKeywords, input.excludeKeywords, input.skipAllDay ? 1 : 0, now(),
      );
      const sub = subById(id, access.householdId)!;
      await syncSubscription(db, sub, log);
      const fresh = subById(id, access.householdId)!;
      recordAudit(db, access.householdId, actorOf(access), "household", id, "create",
        `${access.name} subscribed to the calendar "${fresh.label || input.url}"`);
      notify();
      return reply.code(201).send(toApiSub(db, fresh));
    });

    app.patch("/api/subscriptions/:id", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      const sub = subById(id, access.householdId);
      if (!sub) return reply.code(404).send({ error: "Subscription not found" });
      const patch = calSubscriptionInputSchema.partial().parse(req.body);
      db.prepare(
        `UPDATE cal_subscriptions SET label = ?, url = ?, category = ?, visibility = ?, assignee_id = ?,
           include_keywords = ?, exclude_keywords = ?, skip_all_day = ? WHERE id = ?`,
      ).run(
        patch.label ?? sub.label,
        patch.url ?? sub.url,
        patch.category ?? sub.category,
        patch.visibility ?? sub.visibility,
        patch.assigneeId !== undefined ? patch.assigneeId : sub.assignee_id,
        patch.includeKeywords ?? sub.include_keywords,
        patch.excludeKeywords ?? sub.exclude_keywords,
        (patch.skipAllDay ?? !!sub.skip_all_day) ? 1 : 0,
        id,
      );
      await syncSubscription(db, subById(id, access.householdId)!, log);
      notify();
      return toApiSub(db, subById(id, access.householdId)!);
    });

    app.post("/api/subscriptions/:id/sync", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const sub = subById((req.params as { id: string }).id, access.householdId);
      if (!sub) return reply.code(404).send({ error: "Subscription not found" });
      await syncSubscription(db, sub, log);
      notify();
      return toApiSub(db, subById(sub.id, access.householdId)!);
    });

    app.delete("/api/subscriptions/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const sub = subById((req.params as { id: string }).id, access.householdId);
      if (!sub) return reply.code(404).send({ error: "Subscription not found" });
      db.transaction(() => {
        db.prepare("DELETE FROM event_exceptions WHERE event_id IN (SELECT id FROM events WHERE source_sub_id = ?)").run(sub.id);
        db.prepare("DELETE FROM event_assignees WHERE event_id IN (SELECT id FROM events WHERE source_sub_id = ?)").run(sub.id);
        db.prepare("DELETE FROM events WHERE source_sub_id = ?").run(sub.id);
        db.prepare("DELETE FROM cal_subscriptions WHERE id = ?").run(sub.id);
      })();
      recordAudit(db, access.householdId, actorOf(access), "household", sub.id, "delete",
        `${access.name} unsubscribed from the calendar "${sub.label || sub.url}"`);
      notify();
      return { ok: true };
    });
  },
};
