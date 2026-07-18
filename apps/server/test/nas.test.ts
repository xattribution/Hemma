import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let cookie: string;
let nasRoot: string;

const PIXEL = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201f34f4c3e0000000049454e44ae426082",
  "hex",
);

beforeAll(async () => {
  nasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coord-nas-"));
  ({ app } = await buildApp({ dbPath: ":memory:", logger: false }));
  const setup = await app.inject({
    method: "POST", url: "/api/setup",
    payload: { householdName: "Nas", timezone: "America/New_York", owner: { name: "P", color: "#3e5f7d", avatar: "🦉", credential: "pass123" } },
  });
  const header = setup.headers["set-cookie"];
  cookie = (Array.isArray(header) ? header[0]! : (header as string)).split(";")[0]!;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(nasRoot, { recursive: true, force: true });
});

describe("nas plugin", () => {
  it("creates photos/ and files/ on test", async () => {
    await app.inject({ method: "POST", url: "/api/p/nas/settings", headers: { cookie }, payload: { root: nasRoot } });
    const res = await app.inject({ method: "POST", url: "/api/p/nas/test", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(nasRoot, "photos"))).toBe(true);
    expect(fs.existsSync(path.join(nasRoot, "files"))).toBe(true);
    expect(res.json().photoCount).toBe(0);
  });

  it("complains helpfully when the mount is missing", async () => {
    await app.inject({ method: "POST", url: "/api/p/nas/settings", headers: { cookie }, payload: { root: "/does/not/exist" } });
    const res = await app.inject({ method: "POST", url: "/api/p/nas/test", headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("mounted");
    await app.inject({ method: "POST", url: "/api/p/nas/settings", headers: { cookie }, payload: { root: nasRoot } });
  });

  it("serves random photos from nested folders", async () => {
    fs.mkdirSync(path.join(nasRoot, "photos", "2026", "beach"), { recursive: true });
    fs.writeFileSync(path.join(nasRoot, "photos", "2026", "beach", "sunset.png"), PIXEL);
    await app.inject({ method: "POST", url: "/api/p/nas/test", headers: { cookie } }); // reset scan cache
    const random = await app.inject({ method: "GET", url: "/api/p/nas/random?count=5", headers: { cookie } });
    expect(random.statusCode).toBe(200);
    const id = random.json().assets[0].id as string;
    const asset = await app.inject({ method: "GET", url: `/api/p/nas/asset/${id}`, headers: { cookie } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("image/png");
    expect(asset.rawPayload.equals(PIXEL)).toBe(true);
  });

  it("rejects path traversal", async () => {
    const evil = Buffer.from("../../etc/passwd").toString("base64url");
    const res = await app.inject({ method: "GET", url: `/api/p/nas/asset/${evil}`, headers: { cookie } });
    expect([400, 404]).toContain(res.statusCode);
  });
});

describe("unified photo source", () => {
  it("400s until a source is picked", async () => {
    const res = await app.inject({ method: "GET", url: "/api/photos/random", headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it("redirects to the chosen backend", async () => {
    await app.inject({ method: "POST", url: "/api/photos/source", headers: { cookie }, payload: { source: "nas" } });
    const res = await app.inject({ method: "GET", url: "/api/photos/random?count=3", headers: { cookie } });
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe("/api/p/nas/random?count=3");
    const asset = await app.inject({ method: "GET", url: "/api/photos/asset/abc123", headers: { cookie } });
    expect(asset.statusCode).toBe(307);
    expect(asset.headers.location).toBe("/api/p/nas/asset/abc123");
  });

  it("source switching is parent-only", async () => {
    const res = await app.inject({ method: "POST", url: "/api/photos/source", payload: { source: "immich" } });
    expect(res.statusCode).toBe(401);
  });
});
