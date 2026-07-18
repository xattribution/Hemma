import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/** The plugin proxies a real HTTP Immich — so fake one with node:http. */

let app: FastifyInstance;
let cookie: string;
let immich: http.Server;
let immichUrl: string;
let seenApiKey: string | null = null;
let lastRandomBody: Record<string, unknown> = {};

const PIXEL = Buffer.from("89504e470d0a1a0a", "hex"); // not a real PNG; bytes are bytes

beforeAll(async () => {
  immich = http.createServer((req, res) => {
    seenApiKey = (req.headers["x-api-key"] as string) ?? null;
    if (req.url === "/api/server/ping") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ res: "pong" }));
    } else if (req.url === "/api/server/about") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "v1.999.0" }));
    } else if (req.url === "/api/search/random" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        lastRandomBody = JSON.parse(body || "{}");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "aaaaaaaa-1111-2222-3333-444444444444", type: "IMAGE" }]));
      });
      return;
    } else if (req.url === "/api/search/metadata" && req.method === "POST") {
      // current Immich shape: { assets: { items: [...] } }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ assets: { items: [
        { id: "bbbbbbbb-1111-2222-3333-444444444444", type: "IMAGE" },
        { id: "cccccccc-1111-2222-3333-444444444444", type: "VIDEO" },
      ] } }));
    } else if (req.url?.startsWith("/api/assets/") && req.url.endsWith("/thumbnail?size=preview")) {
      res.setHeader("content-type", "image/jpeg");
      res.end(PIXEL);
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => immich.listen(0, "127.0.0.1", resolve));
  immichUrl = `http://127.0.0.1:${(immich.address() as { port: number }).port}`;

  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: { householdName: "Photo", timezone: "America/New_York", owner: { name: "P", color: "#6f9ccb", avatar: "🦉", credential: "pass123" } },
  });
  const header = setup.headers["set-cookie"];
  cookie = (Array.isArray(header) ? header[0]! : (header as string)).split(";")[0]!;
});

afterAll(async () => {
  await app.close();
  immich.close();
});

describe("immich plugin", () => {
  it("refuses photo calls until configured", async () => {
    const res = await app.inject({ method: "GET", url: "/api/p/immich/random", headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Immich isn't set up");
  });

  it("stores settings without ever echoing the key back", async () => {
    const save = await app.inject({
      method: "POST", url: "/api/p/immich/settings", headers: { cookie },
      payload: { url: immichUrl, apiKey: "secret-key-123" },
    });
    expect(save.statusCode).toBe(200);
    const settings = (await app.inject({ method: "GET", url: "/api/p/immich/settings", headers: { cookie } })).json();
    expect(settings.configured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("secret-key-123");
  });

  it("tests the connection and reports the Immich version", async () => {
    const res = await app.inject({ method: "POST", url: "/api/p/immich/test", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe("v1.999.0");
    expect(seenApiKey).toBe("secret-key-123"); // the key travels server→Immich only
  });

  it("returns random asset ids and streams the image bytes through", async () => {
    const random = await app.inject({ method: "GET", url: "/api/p/immich/random?count=5", headers: { cookie } });
    expect(random.statusCode).toBe(200);
    const id = random.json().assets[0].id as string;
    expect(id).toMatch(/^[0-9a-f-]+$/);

    const asset = await app.inject({ method: "GET", url: `/api/p/immich/asset/${id}`, headers: { cookie } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("image/jpeg");
    expect(asset.rawPayload.equals(PIXEL)).toBe(true);
  });

  it("filters random requests by the chosen album (Immich v2 path)", async () => {
    await app.inject({
      method: "POST", url: "/api/p/immich/settings", headers: { cookie },
      payload: { albumId: "album-42" },
    });
    const res = await app.inject({ method: "GET", url: "/api/p/immich/random?count=3", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(lastRandomBody.albumIds).toEqual(["album-42"]);
    await app.inject({ method: "POST", url: "/api/p/immich/settings", headers: { cookie }, payload: { albumId: "" } });
  });

  it("'in order' pages through /search/metadata and filters to images", async () => {
    const res = await app.inject({ method: "GET", url: "/api/p/immich/random?count=5&order=seq&offset=0", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().assets.map((a: { id: string }) => a.id);
    expect(ids).toContain("bbbbbbbb-1111-2222-3333-444444444444");
    expect(ids).not.toContain("cccccccc-1111-2222-3333-444444444444"); // the video
  });

  it("keeps settings parent-only", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/p/immich/settings" });
    expect(anonymous.statusCode).toBe(401);
  });
});
