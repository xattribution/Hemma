import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/** Family-to-family messages + sealed chunked file transfers over two real
    instances (direct transport, real HTTP, real crypto). */

let A: FastifyInstance, B: FastifyInstance;
let aUrl: string, bUrl: string;
let aCookie: string, bCookie: string, bKidCookie: string, bTeenCookie: string;
let peerIdOnA: string, peerIdOnB: string;
let filesDir: string;

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  (Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0] : (res.headers["set-cookie"] as string)).split(";")[0]!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "sett-files-"));
  process.env.FILES_DIR = filesDir;
  ({ app: A } = await buildApp({ dbPath: ":memory:", logger: false }));
  ({ app: B } = await buildApp({ dbPath: ":memory:", logger: false }));
  await A.listen({ port: 0, host: "127.0.0.1" });
  await B.listen({ port: 0, host: "127.0.0.1" });
  aUrl = `http://127.0.0.1:${(A.server.address() as { port: number }).port}`;
  bUrl = `http://127.0.0.1:${(B.server.address() as { port: number }).port}`;

  const setup = async (app: FastifyInstance, name: string) =>
    cookieOf(await app.inject({
      method: "POST", url: "/api/setup",
      payload: { householdName: name, timezone: "America/New_York", owner: { name: "P", color: "#3d87c9", avatar: "🦉", credential: "pass123" } },
    }));
  aCookie = await setup(A, "Johnson");
  bCookie = await setup(B, "Smith");

  // B has a kid with no grant and a teen WITH the messages grant
  const addKid = async (name: string, grants: string[]) =>
    (await B.inject({
      method: "POST", url: "/api/members", headers: { cookie: bCookie },
      payload: { name, role: "child", color: "#b0563a", avatar: "🦊", credential: "4321", credentialType: "pin", grants },
    })).json().id as string;
  const kidId = await addKid("NoGrant", []);
  const teenId = await addKid("Granted", ["messages.use"]);
  const login = async (memberId: string) =>
    cookieOf(await B.inject({ method: "POST", url: "/api/auth/login", payload: { memberId, credential: "4321" } }));
  bKidCookie = await login(kidId);
  bTeenCookie = await login(teenId);

  // pair A ↔ B (direct)
  const code = (await A.inject({ method: "POST", url: "/api/federation/code", headers: { cookie: aCookie }, payload: { mode: "local" } })).json().code as string;
  await fetch(`${bUrl}/api/federation/connect`, {
    method: "POST", headers: { "content-type": "application/json", cookie: bCookie },
    body: JSON.stringify({ code, url: aUrl }),
  });
  const fed = (await A.inject({ method: "GET", url: "/api/federation", headers: { cookie: aCookie } })).json();
  peerIdOnA = fed.requests[0].id;
  await fetch(`${aUrl}/api/federation/requests/${peerIdOnA}/approve`, { method: "POST", headers: { cookie: aCookie } });
  await sleep(300);
  peerIdOnB = (await B.inject({ method: "GET", url: "/api/messages", headers: { cookie: bCookie } })).json().threads[0].peerId;
}, 30000);

afterAll(async () => {
  await A.close();
  await B.close();
  delete process.env.FILES_DIR;
  fs.rmSync(filesDir, { recursive: true, force: true });
});

describe("family messages & file transfers", () => {
  it("kids without the grant are locked out; granted teens are in", async () => {
    const kid = await B.inject({ method: "GET", url: "/api/messages", headers: { cookie: bKidCookie } });
    expect(kid.statusCode).toBe(403);
    const teen = await B.inject({ method: "GET", url: "/api/messages", headers: { cookie: bTeenCookie } });
    expect(teen.statusCode).toBe(200);
  });

  it("a text lands in the other family's thread (and the parent sees it too)", async () => {
    const send = await A.inject({
      method: "POST", url: `/api/messages/${peerIdOnA}`, headers: { cookie: aCookie },
      payload: { text: "Dinner Sunday at ours?" },
    });
    expect(send.statusCode).toBe(200);
    await sleep(250);
    const thread = (await B.inject({ method: "GET", url: `/api/messages/${peerIdOnB}`, headers: { cookie: bTeenCookie } })).json();
    const last = thread.messages.at(-1);
    expect(last.body).toBe("Dinner Sunday at ours?");
    expect(last.direction).toBe("in");
    expect(last.sender).toContain("Johnson");
    // parental visibility: the parent reads the exact same thread
    const parentView = (await B.inject({ method: "GET", url: `/api/messages/${peerIdOnB}`, headers: { cookie: bCookie } })).json();
    expect(parentView.messages.at(-1).body).toBe("Dinner Sunday at ours?");
  });

  it("unread counts tick up and clear on read", async () => {
    const before = (await B.inject({ method: "GET", url: "/api/messages", headers: { cookie: bCookie } })).json();
    expect(before.threads[0].unread).toBeGreaterThan(0);
    await B.inject({ method: "POST", url: `/api/messages/${peerIdOnB}/read`, headers: { cookie: bCookie } });
    const after = (await B.inject({ method: "GET", url: "/api/messages", headers: { cookie: bCookie } })).json();
    expect(after.threads[0].unread).toBe(0);
  });

  it("a file offer travels, gets accepted, pulls sealed chunks, and matches byte-for-byte", async () => {
    // ~1.3 MB of random bytes → 3 chunks at 512 KiB
    const payload = crypto.randomBytes(1_300_000);
    const upload = await fetch(`${aUrl}/api/messages/${peerIdOnA}/file?name=beach%20photos.zip`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", cookie: aCookie },
      body: payload,
    });
    expect(upload.ok).toBe(true);
    await sleep(300);

    // B sees the offer in the thread
    const thread = (await B.inject({ method: "GET", url: `/api/messages/${peerIdOnB}`, headers: { cookie: bCookie } })).json();
    const fileMsg = thread.messages.at(-1);
    expect(fileMsg.kind).toBe("file");
    expect(fileMsg.body).toBe("beach photos.zip");
    const transfer = thread.transfers[fileMsg.transferId];
    expect(transfer.status).toBe("offered");
    expect(transfer.size).toBe(payload.length);

    // accept into the app's own folder → sealed chunk pull kicks off
    const accept = await B.inject({
      method: "POST", url: `/api/messages/transfers/${fileMsg.transferId}/accept`,
      headers: { cookie: bCookie }, payload: { dest: "app" },
    });
    expect(accept.statusCode).toBe(200);

    let status = "";
    for (let i = 0; i < 40 && status !== "done"; i++) {
      await sleep(250);
      const t = (await B.inject({ method: "GET", url: `/api/messages/${peerIdOnB}`, headers: { cookie: bCookie } })).json();
      status = t.transfers[fileMsg.transferId]?.status;
      if (status === "failed") throw new Error(t.transfers[fileMsg.transferId].error);
    }
    expect(status).toBe("done");

    // the saved file is byte-identical, in a per-family folder
    const saved = path.join(filesDir, "Shared from Johnson", "beach photos.zip");
    expect(fs.existsSync(saved)).toBe(true);
    expect(crypto.createHash("sha256").update(fs.readFileSync(saved)).digest("hex"))
      .toBe(crypto.createHash("sha256").update(payload).digest("hex"));

    // download-to-device works too
    const dl = await B.inject({
      method: "GET", url: `/api/messages/transfers/${fileMsg.transferId}/download`, headers: { cookie: bCookie },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.length).toBe(payload.length);

    // the sender's side flipped to done as well
    await sleep(250);
    const onA = (await A.inject({ method: "GET", url: `/api/messages/${peerIdOnA}`, headers: { cookie: aCookie } })).json();
    expect(onA.transfers[fileMsg.transferId].status).toBe("done");
  });

  it("declining a file tells the sender", async () => {
    await fetch(`${aUrl}/api/messages/${peerIdOnA}/file?name=huge.iso`, {
      method: "PUT", headers: { "content-type": "application/octet-stream", cookie: aCookie },
      body: crypto.randomBytes(1000),
    });
    await sleep(300);
    const thread = (await B.inject({ method: "GET", url: `/api/messages/${peerIdOnB}`, headers: { cookie: bCookie } })).json();
    const offer = thread.messages.at(-1);
    await B.inject({ method: "POST", url: `/api/messages/transfers/${offer.transferId}/decline`, headers: { cookie: bCookie } });
    await sleep(250);
    const onA = (await A.inject({ method: "GET", url: `/api/messages/${peerIdOnA}`, headers: { cookie: aCookie } })).json();
    expect(onA.transfers[offer.transferId].status).toBe("declined");
  });

  it("the chunk endpoint rejects strangers", async () => {
    const res = await fetch(`${aUrl}/api/federation/blob`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pk: "not-a-peer", body: "junk" }),
    });
    expect(res.status).toBe(404);
  });
});
