import http from "node:http";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/** ICS calendar subscriptions: import, filters, read-only, unsubscribe. */

let app: FastifyInstance;
let icsServer: http.Server;
let feedUrl: string;
let parentCookie: string, kidCookie: string;

const day = 86_400_000;
const dt = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00Z`;
};
const dateOnly = (ms: number) => dt(ms).slice(0, 8);

const soon = Date.now() + 2 * day;
const feedBody = () => `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Tigers U10
BEGIN:VEVENT
UID:practice-1
DTSTART:${dt(soon)}
DTEND:${dt(soon + 5400_000)}
SUMMARY:Soccer practice
LOCATION:Riverside Park
END:VEVENT
BEGIN:VEVENT
UID:piano-1
DTSTART:${dt(soon + day)}
DTEND:${dt(soon + day + 3600_000)}
RRULE:FREQ=WEEKLY;COUNT=8
SUMMARY:Piano lesson
END:VEVENT
BEGIN:VEVENT
UID:holiday-1
DTSTART;VALUE=DATE:${dateOnly(soon + 3 * day)}
DTEND;VALUE=DATE:${dateOnly(soon + 4 * day)}
SUMMARY:Team fundraiser day
END:VEVENT
BEGIN:VEVENT
UID:noise-1
DTSTART:${dt(soon + 2 * day)}
DTEND:${dt(soon + 2 * day + 3600_000)}
SUMMARY:Board meeting agenda
END:VEVENT
END:VCALENDAR
`;

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  (Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0]! : (res.headers["set-cookie"] as string)).split(";")[0]!;

beforeAll(async () => {
  icsServer = http.createServer((req, res) => {
    if (req.url === "/missing.ics") {
      res.writeHead(404).end("gone");
    } else if (req.url === "/notacalendar") {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>hello</html>");
    } else {
      res.writeHead(200, { "content-type": "text/calendar" }).end(feedBody());
    }
  });
  await new Promise<void>((resolve) => icsServer.listen(0, "127.0.0.1", resolve));
  const port = (icsServer.address() as { port: number }).port;
  feedUrl = `http://127.0.0.1:${port}/team.ics`;

  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: { householdName: "Subs", timezone: "America/New_York", owner: { name: "Dad", color: "#3e5f7d", avatar: "🦉", credential: "pass123" } },
  });
  parentCookie = cookieOf(setup);
  const kidId = (await app.inject({
    method: "POST", url: "/api/members", headers: { cookie: parentCookie },
    payload: { name: "Kid", role: "child", color: "#b0563a", avatar: "🦊", credential: "4321", credentialType: "pin" },
  })).json().id;
  kidCookie = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { memberId: kidId, credential: "4321" } }));
});

afterAll(async () => {
  await app.close();
  icsServer.close();
});

const listEvents = async (cookie: string) => {
  const win = `start=${Date.now() - day}&end=${Date.now() + 90 * day}`;
  const res = await app.inject({ method: "GET", url: `/api/events?${win}`, headers: { cookie } });
  return res.json().instances as { id: string; title: string; category: string; sourceLabel: string | null; occurrenceStart: number }[];
};

describe("calendar subscriptions", () => {
  let subId: string;

  it("imports a feed, labels it from the calendar's own name, maps the category", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/subscriptions", headers: { cookie: parentCookie },
      payload: { url: feedUrl, category: "sports" },
    });
    expect(res.statusCode).toBe(201);
    const sub = res.json();
    subId = sub.id;
    expect(sub.label).toBe("Tigers U10");
    expect(sub.lastStatus).toMatch(/^ok/);
    expect(sub.eventCount).toBe(4);

    const events = await listEvents(parentCookie);
    const practice = events.find((e) => e.title === "Soccer practice")!;
    expect(practice.category).toBe("sports");
    expect(practice.sourceLabel).toBe("Tigers U10");
    // the weekly rrule expanded into multiple occurrences
    expect(events.filter((e) => e.title === "Piano lesson").length).toBeGreaterThan(4);
  });

  it("imported events are read-only: edits and deletes bounce with a friendly hint", async () => {
    const practice = (await listEvents(parentCookie)).find((e) => e.title === "Soccer practice")!;
    const patch = await app.inject({
      method: "PATCH", url: `/api/events/${practice.id}`, headers: { cookie: parentCookie },
      payload: { scope: "all", patch: { title: "Hijacked" } },
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json().error).toContain("Tigers U10");
    const del = await app.inject({
      method: "DELETE", url: `/api/events/${practice.id}?scope=all`, headers: { cookie: parentCookie },
    });
    expect(del.statusCode).toBe(400);
  });

  it("resync is idempotent — same events, no duplicates", async () => {
    const before = (await listEvents(parentCookie)).length;
    const res = await app.inject({ method: "POST", url: `/api/subscriptions/${subId}/sync`, headers: { cookie: parentCookie } });
    expect(res.json().eventCount).toBe(4);
    expect((await listEvents(parentCookie)).length).toBe(before);
  });

  it("keyword + all-day filters trim what comes in", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/subscriptions/${subId}`, headers: { cookie: parentCookie },
      payload: { includeKeywords: "practice, piano", excludeKeywords: "board", skipAllDay: true },
    });
    expect(res.json().eventCount).toBe(2);
    const titles = (await listEvents(parentCookie)).map((e) => e.title);
    expect(titles).toContain("Soccer practice");
    expect(titles).not.toContain("Board meeting agenda");
    expect(titles).not.toContain("Team fundraiser day");
  });

  it("kids can't manage subscriptions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/subscriptions", headers: { cookie: kidCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("a dead link records a friendly error instead of exploding", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/subscriptions", headers: { cookie: parentCookie },
      payload: { url: feedUrl.replace("/team.ics", "/missing.ics") },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().lastStatus).toContain("doesn't work anymore");
    await app.inject({ method: "DELETE", url: `/api/subscriptions/${res.json().id}`, headers: { cookie: parentCookie } });

    const page = await app.inject({
      method: "POST", url: "/api/subscriptions", headers: { cookie: parentCookie },
      payload: { url: feedUrl.replace("/team.ics", "/notacalendar") },
    });
    expect(page.json().lastStatus).toContain("didn't contain a calendar");
    await app.inject({ method: "DELETE", url: `/api/subscriptions/${page.json().id}`, headers: { cookie: parentCookie } });

    const junk = await app.inject({
      method: "POST", url: "/api/subscriptions", headers: { cookie: parentCookie },
      payload: { url: "ftp://nope" },
    });
    expect(junk.statusCode).toBe(400);
  });

  it("unsubscribing sweeps every imported event away", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/subscriptions/${subId}`, headers: { cookie: parentCookie } });
    expect(res.statusCode).toBe(200);
    expect(await listEvents(parentCookie)).toHaveLength(0);
    const subs = (await app.inject({ method: "GET", url: "/api/subscriptions", headers: { cookie: parentCookie } })).json();
    expect(subs.subscriptions).toHaveLength(0);
  });
});
