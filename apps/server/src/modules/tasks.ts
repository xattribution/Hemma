import { z } from "zod";
import { taskInputSchema, type Task, type TaskStep } from "@coord/shared";
import type { EventBus } from "@coord/plugin-sdk";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { canView, type Viewer } from "./calendar/service.js";
import { actorOf } from "../core/actor.js";
import { parse } from "../core/http.js";
import type { Db } from "../core/db.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";
import { getHousehold } from "../core/household.js";
import { isoDateOf, utcOfWall } from "../core/tz.js";

interface TaskRow {
  id: string;
  household_id: string;
  title: string;
  notes: string;
  icon: string;
  kind: "chore" | "todo";
  assignee_id: string | null;
  due_at: number | null;
  repeat: string | null;
  points: number | null;
  steps_json: string | null;
  created_by: string | null;
  visibility: string;
}

/** Steps stored as bare strings (pre-v9) upgrade to objects on read. */
export function stepsOf(row: Pick<TaskRow, "steps_json">): TaskStep[] {
  if (!row.steps_json) return [];
  return (JSON.parse(row.steps_json) as (string | TaskStep)[]).map((step) =>
    typeof step === "string" ? { text: step, assigneeId: null, points: null } : step,
  );
}

/**
 * Chore points land in the ledger ONLY when the whole task completes.
 * Step points go to the step's assignee (family chores) or whoever checked
 * it; task-level points go to the task's assignee (or the completer).
 * Uncompleting reverses exactly what completing wrote.
 */
function awardPoints(
  db: Db, householdId: string, row: TaskRow, key: string,
  actor: { memberId: string | null; name: string },
) {
  const steps = stepsOf(row);
  const checks = db
    .prepare("SELECT step_index, checked_by FROM step_checks WHERE task_id = ? AND occurrence_date = ?")
    .all(row.id, key) as { step_index: number; checked_by: string | null }[];
  const checkerOf = new Map(checks.map((c) => [c.step_index, c.checked_by]));
  const insert = db.prepare(
    `INSERT INTO points_ledger (household_id, member_id, delta, reason, source, task_id, occurrence_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  steps.forEach((step, index) => {
    if (!step.points) return;
    const recipient = step.assigneeId ?? checkerOf.get(index) ?? row.assignee_id ?? actor.memberId;
    if (recipient) {
      insert.run(householdId, recipient, step.points, `${step.text} — ${row.title}`, "step", row.id, key, actor.memberId, now());
    }
  });
  if (row.points) {
    const recipient = row.assignee_id ?? actor.memberId;
    if (recipient) insert.run(householdId, recipient, row.points, row.title, "task", row.id, key, actor.memberId, now());
  }
}

function reversePoints(db: Db, taskId: string, key: string) {
  db.prepare("DELETE FROM points_ledger WHERE task_id = ? AND occurrence_date = ? AND source IN ('task','step')")
    .run(taskId, key);
}

/** Does a repeat pattern ("daily" | "weekdays" | "0,3,5") land on this weekday (0=Sun)? */
export function repeatsOn(repeat: string, weekday: number): boolean {
  if (repeat === "daily") return true;
  if (repeat === "weekdays") return weekday >= 1 && weekday <= 5;
  return repeat
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .includes(weekday);
}

/** List tasks as they stand for a given household-local date. */
export function listTasksFor(db: Db, householdId: string, isoDate: string, tz: string, viewer?: Viewer): Task[] {
  const [y, m, d] = isoDate.split("-").map(Number);
  const noonUtc = utcOfWall({ year: y!, month: m! - 1, day: d!, hour: 12, minute: 0, second: 0 }, tz);
  const weekday = new Date(noonUtc).getUTCDay(); // noon avoids DST edge ambiguity
  const rows = db
    .prepare("SELECT * FROM tasks WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at")
    .all(householdId) as TaskRow[];

  const tasks: Task[] = [];
  for (const row of rows) {
    if (!canView(viewer, row.visibility ?? "family", row.created_by)) continue;
    const recurring = row.repeat !== null;
    if (recurring && !repeatsOn(row.repeat!, weekday)) continue;
    const occurrenceKey = recurring ? isoDate : "";
    const completion = db
      .prepare("SELECT completed_by, completed_at FROM task_completions WHERE task_id = ? AND occurrence_date = ?")
      .get(row.id, occurrenceKey) as { completed_by: string | null; completed_at: number } | undefined;
    const stepsDone = (db
      .prepare("SELECT step_index FROM step_checks WHERE task_id = ? AND occurrence_date = ?")
      .all(row.id, occurrenceKey) as { step_index: number }[]).map((r) => r.step_index);
    tasks.push({
      id: row.id,
      title: row.title,
      notes: row.notes,
      icon: row.icon,
      kind: row.kind,
      assigneeId: row.assignee_id,
      dueAt: row.due_at,
      repeat: row.repeat,
      points: row.points,
      steps: stepsOf(row),
      visibility: (row.visibility ?? "family") as Task["visibility"],
      stepsDone,
      createdBy: row.created_by,
      occurrenceDate: recurring ? isoDate : null,
      dueToday: recurring ? true : row.due_at === null || isoDateOf(row.due_at, tz) <= isoDate,
      completed: !!completion,
      completedBy: completion?.completed_by ?? null,
      completedAt: completion?.completed_at ?? null,
    });
  }
  return tasks;
}

export function completeTask(
  db: Db, bus: EventBus, householdId: string,
  actor: { memberId: string | null; name: string },
  taskId: string, occurrenceDate: string | null,
): { completed: boolean } {
  const row = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
    .get(taskId, householdId) as TaskRow | undefined;
  if (!row) throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  const key = row.repeat !== null ? (occurrenceDate ?? "") : "";
  if (row.repeat !== null && !key) {
    throw Object.assign(new Error("occurrenceDate required for recurring chores"), { statusCode: 400 });
  }
  const existing = db
    .prepare("SELECT 1 FROM task_completions WHERE task_id = ? AND occurrence_date = ?")
    .get(taskId, key);
  const steps = stepsOf(row);
  if (existing) {
    db.prepare("DELETE FROM task_completions WHERE task_id = ? AND occurrence_date = ?").run(taskId, key);
    db.prepare("DELETE FROM step_checks WHERE task_id = ? AND occurrence_date = ?").run(taskId, key);
    reversePoints(db, taskId, key);
    recordAudit(db, householdId, actor, "task", taskId, "uncomplete", `${actor.name} unchecked "${row.title}"`);
  } else {
    db.prepare(
      "INSERT INTO task_completions (task_id, occurrence_date, completed_by, completed_at) VALUES (?, ?, ?, ?)",
    ).run(taskId, key, actor.memberId, now());
    // OR IGNORE keeps the real checker on steps already ticked individually.
    const insertStep = db.prepare(
      "INSERT OR IGNORE INTO step_checks (task_id, occurrence_date, step_index, checked_by) VALUES (?, ?, ?, ?)",
    );
    steps.forEach((_, index) => insertStep.run(taskId, key, index, actor.memberId));
    awardPoints(db, householdId, row, key, actor);
    recordAudit(db, householdId, actor, "task", taskId, "complete", `${actor.name} completed "${row.title}" 🎉`);
  }
  bus.emit("task.completed", { taskId, title: row.title, occurrenceDate: key || null, actor });
  return { completed: !existing };
}

export const tasksModule: CoreModule = {
  id: "core.tasks",
  name: "Chores & to-dos",
  description: "Kids' chores and family to-dos with completion and swapping.",
  register({ app, db, bus }) {
    app.get("/api/tasks", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const household = getHousehold(db)!;
      const query = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query, reply);
      if (!query) return;
      const isoDate = query.date ?? isoDateOf(now(), household.timezone);
      return { date: isoDate, tasks: listTasksFor(db, household.id, isoDate, household.timezone, access) };
    });

    app.post("/api/tasks", (req, reply) => {
      const access = requireActor(db, req, reply, "task.manage");
      if (!access) return;
      const input = parse(taskInputSchema, req.body, reply);
      if (!input) return;
      const id = uid();
      db.prepare(
        `INSERT INTO tasks (id, household_id, title, notes, icon, kind, assignee_id, due_at, repeat, points, steps_json, visibility, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, access.householdId, input.title, input.notes, input.icon, input.kind,
        input.assigneeId, input.dueAt, input.repeat, input.points,
        input.steps.length ? JSON.stringify(input.steps) : null, input.visibility ?? "family", access.memberId, now());
      recordAudit(db, access.householdId, actorOf(access), "task", id, "create", `${access.name} added "${input.title}"`);
      bus.emit("task.created", { taskId: id, title: input.title, actor: actorOf(access) });
      reply.code(201);
      return { id };
    });

    app.patch("/api/tasks/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "task.manage");
      if (!access) return;
      const patch = parse(taskInputSchema.partial(), req.body, reply);
      if (!patch) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id) as TaskRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Task not found" });
        return;
      }
      db.prepare(
        "UPDATE tasks SET title = ?, notes = ?, icon = ?, kind = ?, assignee_id = ?, due_at = ?, repeat = ?, points = ?, steps_json = ?, visibility = ? WHERE id = ?",
      ).run(
        patch.title ?? row.title, patch.notes ?? row.notes, patch.icon ?? row.icon, patch.kind ?? row.kind,
        patch.assigneeId !== undefined ? patch.assigneeId : row.assignee_id,
        patch.dueAt !== undefined ? patch.dueAt : row.due_at,
        patch.repeat !== undefined ? patch.repeat : row.repeat,
        patch.points !== undefined ? patch.points : row.points,
        patch.steps !== undefined ? (patch.steps.length ? JSON.stringify(patch.steps) : null) : row.steps_json,
        patch.visibility ?? row.visibility ?? "family",
        id,
      );
      recordAudit(db, access.householdId, actorOf(access), "task", id, "update",
        `${access.name} updated "${patch.title ?? row.title}"`);
      bus.emit("task.created", { taskId: id, title: patch.title ?? row.title, actor: actorOf(access) });
      return { ok: true };
    });

    app.delete("/api/tasks/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "task.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT title FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id) as { title: string } | undefined;
      if (!row) {
        reply.code(404).send({ error: "Task not found" });
        return;
      }
      db.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now(), id);
      db.prepare("DELETE FROM reminders WHERE entity_type = 'task' AND entity_id = ?").run(id);
      recordAudit(db, access.householdId, actorOf(access), "task", id, "delete", `${access.name} removed "${row.title}"`);
      bus.emit("task.created", { taskId: id, title: row.title, actor: actorOf(access) });
      return { ok: true };
    });

    // Anyone in the family — displays and connected AIs included — can check off a chore.
    app.post("/api/tasks/:id/complete", (req, reply) => {
      const access = requireActor(db, req, reply, "task.complete");
      if (!access) return;
      const body = parse(z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }), req.body ?? {}, reply);
      if (!body) return;
      return completeTask(db, bus, access.householdId, actorOf(access), (req.params as { id: string }).id, body.occurrenceDate);
    });

    // Check off one step of a chore; when the last step lands, the chore
    // completes itself (and unchecking a step reopens it).
    app.post("/api/tasks/:id/steps/:index/toggle", (req, reply) => {
      const access = requireActor(db, req, reply, "task.complete");
      if (!access) return;
      const body = parse(z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }), req.body ?? {}, reply);
      if (!body) return;
      const { id, index } = req.params as { id: string; index: string };
      const stepIndex = Number.parseInt(index, 10);
      const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id) as TaskRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Task not found" });
        return;
      }
      const steps = stepsOf(row);
      if (Number.isNaN(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
        reply.code(400).send({ error: "No such step" });
        return;
      }
      // Family chores: a kid can only tick their own (or unassigned) steps.
      const step = steps[stepIndex]!;
      if (access.role === "child" && step.assigneeId && step.assigneeId !== access.memberId) {
        reply.code(403).send({ error: "That step is someone else's job" });
        return;
      }
      const key = row.repeat !== null ? (body.occurrenceDate ?? "") : "";
      const done = db.prepare("SELECT 1 FROM step_checks WHERE task_id = ? AND occurrence_date = ? AND step_index = ?")
        .get(id, key, stepIndex);
      if (done) db.prepare("DELETE FROM step_checks WHERE task_id = ? AND occurrence_date = ? AND step_index = ?").run(id, key, stepIndex);
      else db.prepare("INSERT INTO step_checks (task_id, occurrence_date, step_index, checked_by) VALUES (?, ?, ?, ?)").run(id, key, stepIndex, access.memberId);

      const doneCount = (db.prepare("SELECT COUNT(*) AS c FROM step_checks WHERE task_id = ? AND occurrence_date = ?")
        .get(id, key) as { c: number }).c;
      const completed = !!db.prepare("SELECT 1 FROM task_completions WHERE task_id = ? AND occurrence_date = ?").get(id, key);
      if (doneCount === steps.length && !completed) {
        completeTask(db, bus, access.householdId, actorOf(access), id, key || null);
      } else if (doneCount < steps.length && completed) {
        db.prepare("DELETE FROM task_completions WHERE task_id = ? AND occurrence_date = ?").run(id, key);
        reversePoints(db, id, key); // reopened — the award un-happens
        bus.emit("task.completed", { taskId: id, title: row.title, occurrenceDate: key || null, actor: actorOf(access) });
      } else {
        bus.emit("task.completed", { taskId: id, title: row.title, occurrenceDate: key || null, actor: actorOf(access) });
      }
      return { ok: true };
    });

    // Kids can swap chores between themselves — "super simple reassigning".
    app.post("/api/tasks/:id/reassign", (req, reply) => {
      const access = requireActor(db, req, reply, "task.reassign");
      if (!access) return;
      const body = parse(z.object({ toMemberId: z.string().nullable() }), req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id) as TaskRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Task not found" });
        return;
      }
      const target = body.toMemberId
        ? (db.prepare("SELECT name FROM members WHERE id = ? AND deleted_at IS NULL").get(body.toMemberId) as { name: string } | undefined)
        : null;
      if (body.toMemberId && !target) {
        reply.code(400).send({ error: "Unknown family member" });
        return;
      }
      db.prepare("UPDATE tasks SET assignee_id = ? WHERE id = ?").run(body.toMemberId, id);
      recordAudit(db, access.householdId, actorOf(access), "task", id, "reassign",
        target ? `${access.name} handed "${row.title}" to ${target.name}` : `${access.name} unassigned "${row.title}"`);
      bus.emit("task.reassigned", { taskId: id, title: row.title, toMemberId: body.toMemberId ?? "", actor: actorOf(access) });
      return { ok: true };
    });
  },
};
