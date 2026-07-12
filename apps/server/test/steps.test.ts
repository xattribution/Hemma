import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let cookie: string;
let choreId: string;
let today: string;

beforeAll(async () => {
  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: { householdName: "Steps", timezone: "America/New_York", owner: { name: "P", color: "#3d87c9", avatar: "🦉", credential: "pass123" } },
  });
  const header = setup.headers["set-cookie"];
  cookie = (Array.isArray(header) ? header[0] : (header as string)).split(";")[0]!;
  const chore = await app.inject({
    method: "POST", url: "/api/tasks", headers: { cookie },
    payload: { title: "Clean the living room", kind: "chore", repeat: "daily", steps: ["vacuum", "toys", "pillows"] },
  });
  choreId = chore.json().id;
  today = (await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } })).json().date;
});

afterAll(async () => app.close());

const getChore = async () =>
  (await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } })).json()
    .tasks.find((t: { id: string }) => t.id === choreId);

describe("grouped chore steps", () => {
  it("auto-completes the chore when the last step is checked", async () => {
    for (const i of [0, 1]) {
      await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/${i}/toggle`, headers: { cookie }, payload: { occurrenceDate: today } });
    }
    expect((await getChore()).completed).toBe(false);
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/2/toggle`, headers: { cookie }, payload: { occurrenceDate: today } });
    const done = await getChore();
    expect(done.completed).toBe(true);
    expect(done.stepsDone).toHaveLength(3);
  });

  it("unchecking a step reopens the chore; manual complete fills all steps", async () => {
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/steps/1/toggle`, headers: { cookie }, payload: { occurrenceDate: today } });
    expect((await getChore()).completed).toBe(false);
    await app.inject({ method: "POST", url: `/api/tasks/${choreId}/complete`, headers: { cookie }, payload: { occurrenceDate: today } });
    const done = await getChore();
    expect(done.completed).toBe(true);
    expect(done.stepsDone).toHaveLength(3);
  });
});
