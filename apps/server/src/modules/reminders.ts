import { z } from "zod";
import webpush from "web-push";
import type { CoreModule } from "../core/plugin-host.js";
import { requireMember, requireSession } from "../core/auth.js";
import { parse } from "../core/http.js";
import { now, uid } from "../core/db.js";
import { getHousehold } from "../core/household.js";
import { expandOccurrences } from "./calendar/recurrence.js";

const GRACE_MS = 5 * 60_000; // fire up to 5 min late after downtime, never twice

interface ReminderRow {
  id: string;
  entity_type: "event" | "task";
  entity_id: string;
  offset_minutes: number;
  target: string;
}

export const remindersModule: CoreModule = {
  id: "core.reminders",
  name: "Reminders",
  description: "Nudges before events and chores — on-screen and as push notifications.",
  register({ app, db, bus, scheduler, settings, broadcast, log }) {
    // ---- VAPID keys: generated once at first boot ----
    let vapid = settings.get<{ publicKey: string; privateKey: string } | null>("vapid", null);
    if (!vapid) {
      vapid = webpush.generateVAPIDKeys();
      settings.set("vapid", vapid);
      log("generated VAPID keys for web push");
    }
    webpush.setVapidDetails("mailto:admin@coord.local", vapid.publicKey, vapid.privateKey);

    app.get("/api/push/vapid-key", () => ({ publicKey: vapid!.publicKey }));

    app.post("/api/push/subscriptions", (req, reply) => {
      const member = requireMember(db, req, reply);
      if (!member) return;
      const body = parse(
        z.object({
          endpoint: z.string().url(),
          keys: z.object({ p256dh: z.string(), auth: z.string() }),
        }),
        req.body,
        reply,
      );
      if (!body) return;
      db.prepare(
        `INSERT INTO push_subscriptions (endpoint, member_id, keys_json, user_agent, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET member_id = excluded.member_id, keys_json = excluded.keys_json`,
      ).run(body.endpoint, member.id, JSON.stringify(body.keys), req.headers["user-agent"] ?? "", now());
      reply.code(201);
      return { ok: true };
    });

    app.delete("/api/push/subscriptions", (req, reply) => {
      if (!requireMember(db, req, reply)) return;
      const body = parse(z.object({ endpoint: z.string() }), req.body, reply);
      if (!body) return;
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(body.endpoint);
      return { ok: true };
    });

    // ---- Delivery: bus → in-app toast + web push ----
    bus.on("reminder.fired", ({ entityType, entityId, title, body, targetMemberIds }) => {
      broadcast({ type: "reminder", payload: { title, body, entityType, entityId } });

      const subs = targetMemberIds?.length
        ? (db.prepare(
            `SELECT endpoint, keys_json FROM push_subscriptions WHERE member_id IN (${targetMemberIds.map(() => "?").join(",")})`,
          ).all(...targetMemberIds) as { endpoint: string; keys_json: string }[])
        : (db.prepare("SELECT endpoint, keys_json FROM push_subscriptions").all() as { endpoint: string; keys_json: string }[]);

      for (const sub of subs) {
        webpush
          .sendNotification(
            { endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) },
            JSON.stringify({ title, body }),
          )
          .catch((err: { statusCode?: number }) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
            }
          });
      }
    });

    // ---- The clock: check every 30s for reminders that just came due ----
    scheduler.every("reminders.tick", 30, () => {
      const household = getHousehold(db);
      if (!household) return;
      const nowMs = now();
      const timeFmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: household.timezone,
      });

      const fire = (reminder: ReminderRow, occurrenceAt: number, title: string, body: string, targets: string[] | null) => {
        const inserted = db
          .prepare("INSERT OR IGNORE INTO reminder_fires (reminder_id, occurrence_at, fired_at) VALUES (?, ?, ?)")
          .run(reminder.id, occurrenceAt, nowMs);
        if (inserted.changes === 0) return; // already fired
        bus.emit("reminder.fired", {
          entityType: reminder.entity_type, entityId: reminder.entity_id,
          title, body, targetMemberIds: targets,
        });
      };

      const rows = db.prepare("SELECT * FROM reminders").all() as ReminderRow[];
      for (const reminder of rows) {
        const offsetMs = reminder.offset_minutes * 60_000;

        if (reminder.entity_type === "event") {
          const event = db
            .prepare("SELECT * FROM events WHERE id = ? AND deleted_at IS NULL")
            .get(reminder.entity_id) as
            | { title: string; location: string; start_at: number; end_at: number; timezone: string; rrule: string | null }
            | undefined;
          if (!event) continue;
          // Occurrences whose (start - offset) falls inside (now - grace, now].
          const occurrences = expandOccurrences(
            { startAt: event.start_at, endAt: event.end_at, timezone: event.timezone, rrule: event.rrule },
            nowMs - GRACE_MS + offsetMs,
            nowMs + offsetMs + 60_000,
          );
          for (const occ of occurrences) {
            const fireAt = occ.occurrenceStart - offsetMs;
            if (fireAt <= nowMs && fireAt > nowMs - GRACE_MS) {
              const assignees = (
                db.prepare("SELECT member_id FROM event_assignees WHERE event_id = ?").all(reminder.entity_id) as { member_id: string }[]
              ).map((r) => r.member_id);
              fire(
                reminder, occ.occurrenceStart,
                `⏰ ${event.title}`,
                `${timeFmt.format(occ.occurrenceStart)}${event.location ? ` · ${event.location}` : ""}`,
                reminder.target === "assignees" && assignees.length ? assignees : null,
              );
            }
          }
        } else {
          const task = db
            .prepare("SELECT title, assignee_id, due_at FROM tasks WHERE id = ? AND deleted_at IS NULL")
            .get(reminder.entity_id) as { title: string; assignee_id: string | null; due_at: number | null } | undefined;
          if (!task?.due_at) continue;
          const fireAt = task.due_at - offsetMs;
          if (fireAt <= nowMs && fireAt > nowMs - GRACE_MS) {
            fire(
              reminder, task.due_at,
              `✅ ${task.title}`,
              `Due at ${timeFmt.format(task.due_at)}`,
              task.assignee_id ? [task.assignee_id] : null,
            );
          }
        }
      }
    });

    // ---- Task reminder management (event reminders ride along with events) ----
    app.post("/api/tasks/:id/reminder", (req, reply) => {
      const member = requireMember(db, req, reply);
      if (!member) return;
      const body = parse(z.object({ offsetMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable() }), req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      db.prepare("DELETE FROM reminders WHERE entity_type = 'task' AND entity_id = ?").run(id);
      if (body.offsetMinutes !== null) {
        db.prepare(
          "INSERT INTO reminders (id, household_id, entity_type, entity_id, offset_minutes, target) VALUES (?, ?, 'task', ?, ?, 'assignees')",
        ).run(uid(), member.household_id, id, body.offsetMinutes);
      }
      return { ok: true };
    });
  },
};
