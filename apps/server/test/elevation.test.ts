import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/** Always-on displays + "who's changing things?" elevation, pattern
    credentials, per-kid grants, and household rename. */

let app: FastifyInstance;
let parentCookie: string;
let deviceCookie: string;
let kidId: string;
let choreId: string;

const cookieOf = (res: { headers: Record<string, unknown> }): string => {
  const header = res.headers["set-cookie"];
  return (Array.isArray(header) ? header[0] : (header as string)).split(";")[0]!;
};

beforeAll(async () => {
  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: {
      householdName: "The Kotvas Family", timezone: "America/New_York",
      owner: { name: "Jared", color: "#3d87c9", avatar: "🦉", credential: "family123" },
    },
  });
  parentCookie = cookieOf(setup);

  // Kid with a picture pattern (cat, horse, cat, goat → cells 0,3,0,4)
  const kid = await app.inject({
    method: "POST", url: "/api/members", headers: { cookie: parentCookie },
    payload: {
      name: "Mia", role: "child", color: "#e08f3c", avatar: "🦄",
      credential: "pat:0304", credentialType: "pattern", grants: ["checklist.manage"],
    },
  });
  kidId = kid.json().id;

  const chore = await app.inject({
    method: "POST", url: "/api/tasks", headers: { cookie: parentCookie },
    payload: { title: "Feed the dog", icon: "🐶", kind: "chore", assigneeId: kidId, repeat: "daily" },
  });
  choreId = chore.json().id;

  const display = await app.inject({
    method: "POST", url: "/api/devices", headers: { cookie: parentCookie },
    payload: { label: "Kitchen" },
  });
  const session = await app.inject({ method: "POST", url: "/api/auth/device", payload: { token: display.json().token } });
  deviceCookie = cookieOf(session);
});

afterAll(async () => app.close());

describe("pattern credentials", () => {
  it("lets the kid sign in with the picture pattern (and rejects a wrong one)", async () => {
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { memberId: kidId, credential: "pat:8888" } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({ method: "POST", url: "/api/auth/login", payload: { memberId: kidId, credential: "pat:0304" } });
    expect(right.statusCode).toBe(200);
    expect(right.json().member.credentialType).toBe("pattern");
  });

  it("rejects malformed patterns at member creation", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/members", headers: { cookie: parentCookie },
      payload: { name: "Bad", role: "child", color: "#5aa832", avatar: "🐸", credential: "pat:9x", credentialType: "pattern" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("per-kid grants", () => {
  it("granted capability works; ungranted is refused", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { memberId: kidId, credential: "pat:0304" } });
    const kidCookie = cookieOf(login);

    // Mia has checklist.manage → can create a list
    const list = await app.inject({
      method: "POST", url: "/api/checklists", headers: { cookie: kidCookie },
      payload: { title: "Mia's wishlist", kind: "checklist" },
    });
    expect(list.statusCode).toBe(201);

    // …but not event.manage
    const event = await app.inject({
      method: "POST", url: "/api/events", headers: { cookie: kidCookie },
      payload: { title: "Nope", startAt: Date.now(), endAt: Date.now() + 3600_000, timezone: "America/New_York" },
    });
    expect(event.statusCode).toBe(403);
  });
});

describe("display elevation", () => {
  it("read works, changes are refused with an elevate hint", async () => {
    const read = await app.inject({ method: "GET", url: "/api/dashboard/today", headers: { cookie: deviceCookie } });
    expect(read.statusCode).toBe(200);

    const change = await app.inject({
      method: "POST", url: `/api/tasks/${choreId}/complete`, headers: { cookie: deviceCookie },
      payload: { occurrenceDate: "2026-07-12" },
    });
    expect(change.statusCode).toBe(403);
    expect(change.json().code).toBe("elevate");
  });

  it("elevates with the kid's pattern, acts as them, then de-elevates", async () => {
    const bad = await app.inject({
      method: "POST", url: "/api/auth/device/elevate", headers: { cookie: deviceCookie },
      payload: { memberId: kidId, credential: "pat:1111" },
    });
    expect(bad.statusCode).toBe(401);

    const elevated = await app.inject({
      method: "POST", url: "/api/auth/device/elevate", headers: { cookie: deviceCookie },
      payload: { memberId: kidId, credential: "pat:0304" },
    });
    expect(elevated.statusCode).toBe(200);
    expect(elevated.json().member.name).toBe("Mia");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: deviceCookie } });
    expect(me.json().elevation.member.name).toBe("Mia");

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${choreId}/complete`, headers: { cookie: deviceCookie },
      payload: { occurrenceDate: "2026-07-12" },
    });
    expect(complete.statusCode).toBe(200);

    // attributed to Mia, not the display
    const audit = await app.inject({ method: "GET", url: "/api/audit?q=Mia", headers: { cookie: parentCookie } });
    expect(audit.json().entries.some((e: { summary: string }) => e.summary.startsWith("Mia completed"))).toBe(true);

    // elevated-as-kid still can't do parent things
    const forbidden = await app.inject({
      method: "POST", url: "/api/events", headers: { cookie: deviceCookie },
      payload: { title: "Nope", startAt: Date.now(), endAt: Date.now() + 1, timezone: "America/New_York" },
    });
    expect(forbidden.statusCode).toBe(403);

    await app.inject({ method: "POST", url: "/api/auth/device/deelevate", headers: { cookie: deviceCookie } });
    const after = await app.inject({
      method: "POST", url: `/api/tasks/${choreId}/complete`, headers: { cookie: deviceCookie },
      payload: { occurrenceDate: "2026-07-12" },
    });
    expect(after.json().code).toBe("elevate");
  });

  it("a display with requireAuthToChange off keeps the anonymous allowlist", async () => {
    const display = await app.inject({
      method: "POST", url: "/api/devices", headers: { cookie: parentCookie },
      payload: {
        label: "Trusted hallway",
        config: { layout: "dashboard", showEvents: true, showChores: true, showLists: true, requireAuthToChange: false },
      },
    });
    const session = await app.inject({ method: "POST", url: "/api/auth/device", payload: { token: display.json().token } });
    const trusted = cookieOf(session);
    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${choreId}/complete`, headers: { cookie: trusted },
      payload: { occurrenceDate: "2026-07-13" },
    });
    expect(complete.statusCode).toBe(200);
  });
});

describe("household", () => {
  it("renames the family", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/household", headers: { cookie: parentCookie },
      payload: { name: "The Kotvas-West Crew" },
    });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: parentCookie } });
    expect(me.json().household.name).toBe("The Kotvas-West Crew");
  });
});
