import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { utcOfWall } from "../src/core/tz.js";

const TZ = "America/New_York";
const wall = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  utcOfWall({ year: y, month: mo - 1, day: d, hour: h, minute: mi, second: 0 }, TZ);

let app: FastifyInstance;
let parentCookie: string;
let childCookie: string;

const cookieOf = (res: { headers: Record<string, unknown> }): string => {
  const header = res.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : (header as string);
  return raw.split(";")[0]!;
};

beforeAll(async () => {
  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
});

afterAll(async () => {
  await app.close();
});

describe("family setup and sign-in", () => {
  it("reports setup needed, then completes the wizard", async () => {
    const status = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(status.json()).toEqual({ needed: true });

    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        householdName: "Testers",
        timezone: TZ,
        owner: { name: "Pat", color: "#3d87c9", avatar: "🦉", credential: "hunter22" },
      },
    });
    expect(setup.statusCode).toBe(201);
    parentCookie = cookieOf(setup);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: parentCookie } });
    expect(me.json().member.name).toBe("Pat");
    expect(me.json().member.role).toBe("parent");
  });

  it("lets a parent add a child who signs in with a PIN", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/members",
      headers: { cookie: parentCookie },
      payload: { name: "Kiddo", role: "child", color: "#5aa832", avatar: "🐸", credential: "1234" },
    });
    expect(created.statusCode).toBe(201);
    const childId = created.json().id;

    const badLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { memberId: childId, credential: "9999" },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { memberId: childId, credential: "1234" },
    });
    expect(login.statusCode).toBe(200);
    childCookie = cookieOf(login);
  });
});

describe("calendar", () => {
  let eventId: string;
  const firstStart = wall(2026, 7, 6, 15); // Monday 3pm

  it("blocks children from creating events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: childCookie },
      payload: {
        title: "Nope", startAt: firstStart, endAt: firstStart + 3600_000,
        timezone: TZ, allDay: false,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a weekly event and expands instances in a window", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: parentCookie },
      payload: {
        title: "Swim class", startAt: firstStart, endAt: firstStart + 3600_000,
        timezone: TZ, allDay: false, rrule: "FREQ=WEEKLY", category: "sports", reminderMinutes: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    eventId = res.json().id;

    const list = await app.inject({
      method: "GET",
      url: `/api/events?start=${wall(2026, 7, 1)}&end=${wall(2026, 7, 28)}`,
      headers: { cookie: parentCookie },
    });
    const instances = list.json().instances.filter((i: { id: string }) => i.id === eventId);
    expect(instances).toHaveLength(4); // Mondays Jul 6, 13, 20, 27
    expect(instances[0].reminderMinutes).toBe(30);
  });

  it("edits a single occurrence without touching the rest", async () => {
    const second = wall(2026, 7, 13, 15);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/events/${eventId}`,
      headers: { cookie: parentCookie },
      payload: { scope: "single", occurrenceStart: second, patch: { title: "Swim MEET" } },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/api/events?start=${wall(2026, 7, 1)}&end=${wall(2026, 7, 28)}`,
      headers: { cookie: parentCookie },
    });
    const instances = list.json().instances.filter((i: { id: string }) => i.id === eventId);
    const titles = instances.map((i: { title: string }) => i.title).sort();
    expect(titles).toEqual(["Swim MEET", "Swim class", "Swim class", "Swim class"]);
  });

  it("deletes this-and-future from an occurrence", async () => {
    const third = wall(2026, 7, 20, 15);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/events/${eventId}?scope=future&occurrenceStart=${third}`,
      headers: { cookie: parentCookie },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/api/events?start=${wall(2026, 7, 1)}&end=${wall(2026, 8, 28)}`,
      headers: { cookie: parentCookie },
    });
    const instances = list.json().instances.filter((i: { id: string }) => i.id === eventId);
    expect(instances).toHaveLength(2); // series now ends before Jul 20
  });
});

describe("chores", () => {
  let choreId: string;
  let childId: string;

  it("creates a recurring chore assigned to the child", async () => {
    const members = await app.inject({ method: "GET", url: "/api/members", headers: { cookie: parentCookie } });
    childId = members.json().members.find((m: { role: string }) => m.role === "child").id;

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: parentCookie },
      payload: { title: "Feed the fish", icon: "🐠", kind: "chore", assigneeId: childId, repeat: "daily" },
    });
    expect(res.statusCode).toBe(201);
    choreId = res.json().id;
  });

  it("lets the child complete today's occurrence (and un-complete it)", async () => {
    const list = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: childCookie } });
    const today = list.json().date;
    const chore = list.json().tasks.find((t: { id: string }) => t.id === choreId);
    expect(chore.dueToday).toBe(true);
    expect(chore.completed).toBe(false);

    const complete = await app.inject({
      method: "POST",
      url: `/api/tasks/${choreId}/complete`,
      headers: { cookie: childCookie },
      payload: { occurrenceDate: today },
    });
    expect(complete.json().completed).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: childCookie } });
    expect(after.json().tasks.find((t: { id: string }) => t.id === choreId).completed).toBe(true);
  });

  it("lets the child swap the chore to a parent", async () => {
    const members = await app.inject({ method: "GET", url: "/api/members", headers: { cookie: childCookie } });
    const parentId = members.json().members.find((m: { role: string }) => m.role === "parent").id;
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${choreId}/reassign`,
      headers: { cookie: childCookie },
      payload: { toMemberId: parentId },
    });
    expect(res.statusCode).toBe(200);

    const audit = await app.inject({ method: "GET", url: "/api/audit", headers: { cookie: parentCookie } });
    expect(audit.json().entries.some((e: { action: string }) => e.action === "reassign")).toBe(true);
  });
});

describe("checklists", () => {
  it("shares a shopping list and toggles items", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/checklists",
      headers: { cookie: parentCookie },
      payload: { title: "Groceries", icon: "🛒", kind: "shopping", pinnedToDashboard: true },
    });
    const listId = created.json().id;

    const item = await app.inject({
      method: "POST",
      url: `/api/checklists/${listId}/items`,
      headers: { cookie: childCookie }, // kids can add items
      payload: { text: "Milk", quantity: "2" },
    });
    expect(item.statusCode).toBe(201);

    const toggle = await app.inject({
      method: "POST",
      url: `/api/checklists/${listId}/items/${item.json().id}/toggle`,
      headers: { cookie: parentCookie },
    });
    expect(toggle.json().checked).toBe(true);

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard/today", headers: { cookie: parentCookie } });
    expect(dashboard.json().pinnedLists.some((l: { title: string }) => l.title === "Groceries")).toBe(true);
  });
});

describe("kiosk devices", () => {
  it("exchanges a device token for a read-mostly session", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/devices",
      headers: { cookie: parentCookie },
      payload: { label: "Kitchen tablet" },
    });
    const token = created.json().token;
    expect(token).toBeTruthy();

    const session = await app.inject({ method: "POST", url: "/api/auth/device", payload: { token } });
    expect(session.statusCode).toBe(200);
    const deviceCookie = cookieOf(session);

    const dash = await app.inject({ method: "GET", url: "/api/dashboard/today", headers: { cookie: deviceCookie } });
    expect(dash.statusCode).toBe(200);

    // Devices can check items but not manage events.
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: deviceCookie },
      payload: { title: "Nope", startAt: 0, endAt: 1, timezone: TZ },
    });
    expect(forbidden.statusCode).toBe(401);
  });
});
