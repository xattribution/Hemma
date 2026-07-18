import { z } from "zod";
import {
  goalInputSchema, pointsAdjustSchema,
  type GoalStanding, type PointGoal, type PointsEntry, type PointsSummary,
} from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { parse } from "../core/http.js";
import type { Db } from "../core/db.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";

/**
 * Points v2 — a ledger plus parent-defined goals.
 *
 * The ledger is the single source of truth: chores write into it when a
 * whole task completes (see tasks.ts), parents adjust it manually
 * (bonuses, "left the bike out again"), and goals are just windows over
 * it. That keeps the framework open for future schemes (allowance,
 * streaks, seasonal resets) without new storage.
 */

interface GoalRow {
  id: string;
  title: string;
  icon: string;
  mode: "target" | "race";
  target: number;
  member_ids_json: string | null;
  starts_at: number;
  ends_at: number | null;
  repeat: "none" | "monthly";
  reward: string;
  created_at: number;
}

const toGoal = (row: GoalRow): PointGoal => ({
  id: row.id, title: row.title, icon: row.icon, mode: row.mode, target: row.target,
  memberIds: row.member_ids_json ? (JSON.parse(row.member_ids_json) as string[]) : null,
  startsAt: row.starts_at, endsAt: row.ends_at, repeat: row.repeat, reward: row.reward,
  createdAt: row.created_at,
});

/** The window a goal currently measures (monthly goals roll each month). */
export function goalWindow(goal: PointGoal, at: number): { start: number; end: number | null } {
  if (goal.repeat !== "monthly") return { start: goal.startsAt, end: goal.endsAt };
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

/** Per-member earned within a window; race mode also finds when the target was crossed. */
export function standingsFor(
  db: Db, householdId: string, goal: PointGoal,
  members: { id: string; role: string }[], at: number,
): { windowStart: number; windowEnd: number | null; standings: GoalStanding[] } {
  const { start, end } = goalWindow(goal, at);
  // memberIds null = "every kid" (parents can still be added explicitly).
  const participants = goal.memberIds ?? members.filter((m) => m.role === "child").map((m) => m.id);
  const standings: GoalStanding[] = participants.map((memberId) => {
    const rows = db
      .prepare(
        `SELECT delta, created_at FROM points_ledger
         WHERE household_id = ? AND member_id = ? AND created_at >= ? ${end ? "AND created_at < ?" : ""}
         ORDER BY created_at, id`,
      )
      .all(...(end ? [householdId, memberId, start, end] : [householdId, memberId, start])) as
      { delta: number; created_at: number }[];
    let sum = 0;
    let reachedAt: number | null = null;
    for (const row of rows) {
      sum += row.delta;
      if (reachedAt === null && sum >= goal.target) reachedAt = row.created_at;
      if (reachedAt !== null && sum < goal.target) reachedAt = null; // deduction undid it
    }
    return { memberId, earned: sum, reached: sum >= goal.target, reachedAt };
  });
  return { windowStart: start, windowEnd: end, standings };
}

export const pointsModule: CoreModule = {
  id: "core.points",
  name: "Points & goals",
  description: "The family points ledger, parent adjustments, and reward goals.",
  register({ app, db, bus, broadcast }) {
    const nudge = () => broadcast({ type: "invalidate", keys: ["points"] });
    // Chore completions/reversals write the ledger inside tasks.ts — this
    // module just relays the change to open Points pages.
    bus.on("task.completed", () => nudge());

    app.get("/api/points/summary", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const membersList = db.prepare("SELECT id, role FROM members WHERE deleted_at IS NULL ORDER BY sort_order")
        .all() as { id: string; role: string }[];
      const totals = membersList.map(({ id: memberId }) => ({
        memberId,
        total: (db.prepare("SELECT COALESCE(SUM(delta), 0) AS t FROM points_ledger WHERE household_id = ? AND member_id = ?")
          .get(access.householdId, memberId) as { t: number }).t,
      }));
      const goals = (db.prepare("SELECT * FROM point_goals WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at")
        .all(access.householdId) as GoalRow[])
        .map(toGoal)
        .map((goal) => ({ goal, ...standingsFor(db, access.householdId, goal, membersList, now()) }));
      const query = parse(z.object({ memberId: z.string().optional() }), req.query ?? {}, reply);
      if (!query) return;
      const recent = (db
        .prepare(
          `SELECT id, member_id, delta, reason, source, task_id, created_by, created_at FROM points_ledger
           WHERE household_id = ? ${query.memberId ? "AND member_id = ?" : ""}
           ORDER BY created_at DESC, id DESC LIMIT 50`,
        )
        .all(...(query.memberId ? [access.householdId, query.memberId] : [access.householdId])) as {
          id: number; member_id: string; delta: number; reason: string;
          source: PointsEntry["source"]; task_id: string | null; created_by: string | null; created_at: number;
        }[])
        .map((r): PointsEntry => ({
          id: r.id, memberId: r.member_id, delta: r.delta, reason: r.reason,
          source: r.source, taskId: r.task_id, createdBy: r.created_by, createdAt: r.created_at,
        }));
      const summary: PointsSummary = { totals, goals, recent };
      return summary;
    });

    // Parents add bonuses or deduct for bad behavior — always with a reason.
    app.post("/api/points/adjust", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(pointsAdjustSchema, req.body, reply);
      if (!body) return;
      const member = db.prepare("SELECT name FROM members WHERE id = ? AND deleted_at IS NULL").get(body.memberId) as
        | { name: string } | undefined;
      if (!member) {
        reply.code(404).send({ error: "Member not found" });
        return;
      }
      db.prepare(
        `INSERT INTO points_ledger (household_id, member_id, delta, reason, source, created_by, created_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
      ).run(access.householdId, body.memberId, body.delta, body.reason, access.memberId, now());
      recordAudit(db, access.householdId, actorOf(access), "points", body.memberId, "update",
        `${access.name} ${body.delta > 0 ? "gave" : "took"} ${Math.abs(body.delta)} points ${body.delta > 0 ? "to" : "from"} ${member.name}: ${body.reason}`);
      nudge();
      return { ok: true };
    });

    // ---------- goals (parent-defined) ----------

    app.post("/api/points/goals", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const input = parse(goalInputSchema, req.body, reply);
      if (!input) return;
      const id = uid();
      db.prepare(
        `INSERT INTO point_goals (id, household_id, title, icon, mode, target, member_ids_json, starts_at, ends_at, repeat, reward, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, access.householdId, input.title, input.icon, input.mode, input.target,
        input.memberIds ? JSON.stringify(input.memberIds) : null,
        input.startsAt, input.endsAt, input.repeat, input.reward, now());
      recordAudit(db, access.householdId, actorOf(access), "points", id, "create",
        `${access.name} set up the goal "${input.title}"`);
      nudge();
      reply.code(201);
      return { id };
    });

    app.patch("/api/points/goals/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const patch = parse(goalInputSchema.partial(), req.body, reply);
      if (!patch) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM point_goals WHERE id = ? AND deleted_at IS NULL").get(id) as GoalRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Goal not found" });
        return;
      }
      db.prepare(
        `UPDATE point_goals SET title = ?, icon = ?, mode = ?, target = ?, member_ids_json = ?, starts_at = ?, ends_at = ?, repeat = ?, reward = ? WHERE id = ?`,
      ).run(
        patch.title ?? row.title, patch.icon ?? row.icon, patch.mode ?? row.mode, patch.target ?? row.target,
        patch.memberIds !== undefined ? (patch.memberIds ? JSON.stringify(patch.memberIds) : null) : row.member_ids_json,
        patch.startsAt ?? row.starts_at,
        patch.endsAt !== undefined ? patch.endsAt : row.ends_at,
        patch.repeat ?? row.repeat, patch.reward ?? row.reward, id,
      );
      nudge();
      return { ok: true };
    });

    app.delete("/api/points/goals/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      db.prepare("UPDATE point_goals SET deleted_at = ? WHERE id = ?").run(now(), id);
      nudge();
      return { ok: true };
    });
  },
};
