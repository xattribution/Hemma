import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/core/db.js";

/** Group chores + the points ledger: per-step assignees, award on whole-task
    completion only, reversal on reopen, parent adjustments, goals, backup. */

let app: FastifyInstance;
let db: Db;
let parentCookie: string, miaCookie: string, leoCookie: string;
let miaId: string, leoId: string;
let choreId: string;

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  (Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0]! : (res.headers["set-cookie"] as string)).split(";")[0]!;

const totals = async () => {
  const res = await app.inject({ method: "GET", url: "/api/points/summary", headers: { cookie: parentCookie } });
  const map = new Map<string, number>();
  for (const t of res.json().totals as { memberId: string; total: number }[]) map.set(t.memberId, t.total);
  return map;
};

beforeAll(async () => {
  ({ app, db } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: { householdName: "Points", timezone: "America/New_York", owner: { name: "P", color: "#6f9ccb", avatar: "🦉", credential: "pass123" } },
  });
  parentCookie = cookieOf(setup);

  const addKid = async (name: string, pin: string) =>
    (await app.inject({
      method: "POST", url: "/api/members", headers: { cookie: parentCookie },
      payload: { name, role: "child", color: "#dda15e", avatar: "🦄", credential: pin, credentialType: "pin" },
    })).json().id as string;
  miaId = await addKid("Mia", "1111");
  leoId = await addKid("Leo", "2222");

  const login = async (memberId: string, credential: string) =>
    cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { memberId, credential } }));
  miaCookie = await login(miaId, "1111");
  leoCookie = await login(leoId, "2222");

  const chore = await app.inject({
    method: "POST", url: "/api/tasks", headers: { cookie: parentCookie },
    payload: {
      title: "Clean the kitchen", kind: "chore", assigneeId: null, repeat: null, points: null,
      steps: [
        { text: "Sweep the floor", assigneeId: miaId, points: 5 },
        { text: "Do the dishes", assigneeId: leoId, points: 7 },
        "Wipe the counters", // unassigned legacy-style string step, no points
      ],
    },
  });
  choreId = chore.json().id;
});

afterAll(async () => app.close());

describe("group chores with per-step assignees", () => {
  it("kids cannot check someone else's step", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${choreId}/steps/1/toggle`, headers: { cookie: miaCookie },
      payload: { occurrenceDate: null },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("someone else");
  });

  it("no points land until the WHOLE task completes", async () => {
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/0/toggle`, headers: { cookie: miaCookie }, payload: { occurrenceDate: null } });
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/1/toggle`, headers: { cookie: leoCookie }, payload: { occurrenceDate: null } });
    const before = await totals();
    expect(before.get(miaId)).toBe(0);
    expect(before.get(leoId)).toBe(0);
  });

  it("awards per-step points to each step's kid when the last step lands", async () => {
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/2/toggle`, headers: { cookie: leoCookie }, payload: { occurrenceDate: null } });
    const after = await totals();
    expect(after.get(miaId)).toBe(5);
    expect(after.get(leoId)).toBe(7);
    const summary = (await app.inject({ method: "GET", url: `/api/points/summary?memberId=${miaId}`, headers: { cookie: miaCookie } })).json();
    expect(summary.recent[0].reason).toContain("Sweep the floor");
    expect(summary.recent[0].source).toBe("step");
  });

  it("reopening the chore reverses the award exactly", async () => {
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/0/toggle`, headers: { cookie: miaCookie }, payload: { occurrenceDate: null } });
    const after = await totals();
    expect(after.get(miaId)).toBe(0);
    expect(after.get(leoId)).toBe(0);
  });

  it("task-level points go to the assignee of a solo chore", async () => {
    const solo = (await app.inject({
      method: "POST", url: "/api/tasks", headers: { cookie: parentCookie },
      payload: { title: "Feed the fish", kind: "chore", assigneeId: miaId, repeat: null, points: 3 },
    })).json().id;
    await app.inject({ method: "POST", url: `/api/tasks/${solo}/complete`, headers: { cookie: parentCookie }, payload: { occurrenceDate: null } });
    expect((await totals()).get(miaId)).toBe(3); // even though the parent tapped it
  });
});

describe("manual adjustments", () => {
  it("parents can deduct with a reason; the ledger says why", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/points/adjust", headers: { cookie: parentCookie },
      payload: { memberId: miaId, delta: -2, reason: "Left the bike out" },
    });
    expect(res.statusCode).toBe(200);
    expect((await totals()).get(miaId)).toBe(1);
    const summary = (await app.inject({ method: "GET", url: `/api/points/summary?memberId=${miaId}`, headers: { cookie: parentCookie } })).json();
    expect(summary.recent[0].reason).toBe("Left the bike out");
    expect(summary.recent[0].delta).toBe(-2);
  });

  it("kids cannot adjust points", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/points/adjust", headers: { cookie: leoCookie },
      payload: { memberId: leoId, delta: 100, reason: "nice try" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("goals", () => {
  it("target goals show per-member progress within their window", async () => {
    const goal = await app.inject({
      method: "POST", url: "/api/points/goals", headers: { cookie: parentCookie },
      payload: { title: "Screen time Saturday", mode: "target", target: 3, startsAt: Date.now() - 86_400_000, reward: "1h of games" },
    });
    expect(goal.statusCode).toBe(201);
    const summary = (await app.inject({ method: "GET", url: "/api/points/summary", headers: { cookie: miaCookie } })).json();
    const standings = summary.goals[0].standings as { memberId: string; earned: number; reached: boolean }[];
    const mia = standings.find((s) => s.memberId === miaId)!;
    expect(mia.earned).toBe(1); // 3 fish − 2 bike
    expect(mia.reached).toBe(false);
  });

  it("race mode records when the target was crossed (first past the post)", async () => {
    await app.inject({
      method: "POST", url: "/api/points/goals", headers: { cookie: parentCookie },
      payload: { title: "First to 5", mode: "race", target: 5, startsAt: Date.now() - 86_400_000, memberIds: [miaId, leoId] },
    });
    await app.inject({
      method: "POST", url: "/api/points/adjust", headers: { cookie: parentCookie },
      payload: { memberId: leoId, delta: 6, reason: "Helped grandma" },
    });
    const summary = (await app.inject({ method: "GET", url: "/api/points/summary", headers: { cookie: parentCookie } })).json();
    const race = summary.goals.find((g: { goal: { mode: string } }) => g.goal.mode === "race")!;
    const leo = race.standings.find((s: { memberId: string }) => s.memberId === leoId)!;
    expect(leo.reached).toBe(true);
    expect(leo.reachedAt).toBeGreaterThan(0);
    const mia = race.standings.find((s: { memberId: string }) => s.memberId === miaId)!;
    expect(mia.reached).toBe(false);
  });
});

describe("legacy string steps", () => {
  it("pre-v9 steps_json (bare strings) still reads as steps", async () => {
    db.prepare(
      `INSERT INTO tasks (id, household_id, title, notes, icon, kind, assignee_id, repeat, steps_json, created_at)
       VALUES ('legacy1', (SELECT id FROM households), 'Old chore', '', '⭐', 'chore', NULL, NULL, '["one","two"]', ?)`,
    ).run(Date.now());
    const tasks = (await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: parentCookie } })).json().tasks;
    const legacy = tasks.find((t: { id: string }) => t.id === "legacy1");
    expect(legacy.steps).toEqual([
      { text: "one", assigneeId: null, points: null },
      { text: "two", assigneeId: null, points: null },
    ]);
  });
});

describe("backup", () => {
  it("streams the whole database to a parent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/backup", headers: { cookie: parentCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("coord-backup-");
    expect(res.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("is parent-only", async () => {
    const res = await app.inject({ method: "GET", url: "/api/backup", headers: { cookie: leoCookie } });
    expect(res.statusCode).toBe(403);
  });
});
