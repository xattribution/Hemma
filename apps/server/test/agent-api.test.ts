import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/** The HAL flow: an AI client drives Coord through a bearer API token. */

let app: FastifyInstance;
let parentCookie: string;
let agentAuth: { authorization: string };

const cookieOf = (res: { headers: Record<string, unknown> }): string => {
  const header = res.headers["set-cookie"];
  return (Array.isArray(header) ? header[0] : (header as string)).split(";")[0]!;
};

beforeAll(async () => {
  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST",
    url: "/api/setup",
    payload: {
      householdName: "HALs", timezone: "America/New_York",
      owner: { name: "Dave", color: "#3d87c9", avatar: "🦉", credential: "openthedoors" },
    },
  });
  parentCookie = cookieOf(setup);
  const token = await app.inject({
    method: "POST", url: "/api/tokens", headers: { cookie: parentCookie },
    payload: { label: "HAL" },
  });
  agentAuth = { authorization: `Bearer ${token.json().token}` };
});

afterAll(async () =>
  app.close());

describe("AI agent via bearer token", () => {
  it("serves LLM instructions at /llms.txt without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/llms.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Authorization: Bearer");
  });

  it("rejects a bogus token but accepts the real one", async () => {
    const bogus = await app.inject({ method: "GET", url: "/api/members", headers: { authorization: "Bearer nope" } });
    expect(bogus.statusCode).toBe(401);
    const real = await app.inject({ method: "GET", url: "/api/members", headers: agentAuth });
    expect(real.statusCode).toBe(200);
  });

  it("lets the agent run the eggs-from-Costco flow end to end", async () => {
    // "I need to get eggs from Costco tomorrow"
    const list = await app.inject({
      method: "POST", url: "/api/checklists", headers: agentAuth,
      payload: { title: "Groceries", kind: "shopping", pinnedToDashboard: true, needBy: Date.now() + 86_400_000 },
    });
    expect(list.statusCode).toBe(201);
    const listId = list.json().id;

    const item = await app.inject({
      method: "POST", url: `/api/checklists/${listId}/items`, headers: agentAuth,
      payload: { text: "Eggs", quantity: "1 dozen", store: "Costco" },
    });
    expect(item.statusCode).toBe(201);

    // "actually get them from Walmart"
    const move = await app.inject({
      method: "PATCH", url: `/api/checklists/${listId}/items/${item.json().id}`, headers: agentAuth,
      payload: { store: "Walmart" },
    });
    expect(move.statusCode).toBe(200);

    const all = await app.inject({ method: "GET", url: "/api/checklists", headers: agentAuth });
    const groceries = all.json().checklists.find((c: { id: string }) => c.id === listId);
    expect(groceries.needBy).toBeTypeOf("number");
    expect(groceries.items[0].store).toBe("Walmart");

    // search finds it by store tag
    const search = await app.inject({ method: "GET", url: "/api/search?q=walmart", headers: agentAuth });
    expect(search.json().checklistItems.some((i: { text: string }) => i.text === "Eggs")).toBe(true);

    // and the family history attributes it to HAL
    const audit = await app.inject({ method: "GET", url: "/api/audit", headers: { cookie: parentCookie } });
    expect(audit.json().entries.some((e: { summary: string }) => e.summary.includes("HAL added"))).toBe(true);
  });

  it("lets the agent create and reassign a chore", async () => {
    const kid = await app.inject({
      method: "POST", url: "/api/members", headers: agentAuth,
      payload: { name: "Frank", role: "child", color: "#5aa832", avatar: "🐸", credential: "2001" },
    });
    expect(kid.statusCode).toBe(201);

    const chore = await app.inject({
      method: "POST", url: "/api/tasks", headers: agentAuth,
      payload: { title: "Check the pod bay doors", icon: "🚪", kind: "chore", assigneeId: null, repeat: "daily" },
    });
    expect(chore.statusCode).toBe(201);

    const reassign = await app.inject({
      method: "POST", url: `/api/tasks/${chore.json().id}/reassign`, headers: agentAuth,
      payload: { toMemberId: kid.json().id },
    });
    expect(reassign.statusCode).toBe(200);
  });

  it("stops working after the parent revokes the token", async () => {
    const tokens = await app.inject({ method: "GET", url: "/api/tokens", headers: { cookie: parentCookie } });
    const halId = tokens.json().tokens.find((t: { label: string }) => t.label === "HAL").id;
    await app.inject({ method: "DELETE", url: `/api/tokens/${halId}`, headers: { cookie: parentCookie } });
    const res = await app.inject({ method: "GET", url: "/api/members", headers: agentAuth });
    expect(res.statusCode).toBe(401);
  });
});

describe("display config", () => {
  it("creates a display with retrievable token and live-editable config", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/devices", headers: { cookie: parentCookie },
      payload: { label: "Living room", config: { layout: "calendar", showEvents: true, showChores: false, showLists: true } },
    });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json();

    // token is retrievable later (shareable link)
    const list = await app.inject({ method: "GET", url: "/api/devices", headers: { cookie: parentCookie } });
    const device = list.json().devices.find((d: { id: string }) => d.id === id);
    expect(device.token).toBe(token);
    expect(device.config.layout).toBe("calendar");

    // the display signs in and sees its own config via /me
    const session = await app.inject({ method: "POST", url: "/api/auth/device", payload: { token } });
    const deviceCookie = cookieOf(session);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: deviceCookie } });
    expect(me.json().config.showChores).toBe(false);

    // parent flips a setting; revoking signs the display out
    await app.inject({
      method: "PATCH", url: `/api/devices/${id}`, headers: { cookie: parentCookie },
      payload: { config: { layout: "dashboard", showEvents: true, showChores: true, showLists: false } },
    });
    const me2 = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: deviceCookie } });
    expect(me2.json().config.showLists).toBe(false);

    await app.inject({ method: "DELETE", url: `/api/devices/${id}`, headers: { cookie: parentCookie } });
    const me3 = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: deviceCookie } });
    expect(me3.statusCode).toBe(401);
  });
});
