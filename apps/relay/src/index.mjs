/**
 * Coord relay — the "meet in the middle" for families whose home servers
 * can't reach each other directly.
 *
 * Trust model (deliberate):
 *  - Everything families exchange is end-to-end encrypted BEFORE it gets
 *    here; the relay sees only opaque ciphertext blobs and random mailbox ids.
 *  - Nothing touches disk: pairing codes and queued messages live in RAM
 *    with short TTLs and vanish on restart.
 *  - No logging of who/what/when. The only console output is the bind line.
 *
 * Zero dependencies — plain node:http. Run behind any TLS proxy (Caddy).
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 8790);
const CODE_TTL = 10 * 60_000; // pairing codes live 10 minutes
const MSG_TTL = 7 * 24 * 3600_000; // undelivered mail lives up to 7 days (RAM only)
const MAX_BODY = 512 * 1024;
const MAX_QUEUE = 500;

/** code -> { pubkey, mailbox, payload, expires } (pairing rendezvous) */
const codes = new Map();
/** mailboxId -> [{ body, expires }] (encrypted message queues) */
const mailboxes = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes) if (entry.expires < now) codes.delete(code);
  for (const [id, queue] of mailboxes) {
    const alive = queue.filter((m) => m.expires > now);
    if (alive.length) mailboxes.set(id, alive);
    else mailboxes.delete(id);
  }
}, 30_000).unref();

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new Error("too large"));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });

http
  .createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    const url = new URL(req.url, "http://relay");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, service: "coord-relay" });
      }

      // Family A parks a pairing offer under a one-time code.
      if (req.method === "POST" && url.pathname === "/pair/offer") {
        const { code, pubkey, mailbox, payload } = await readBody(req);
        if (!code || !pubkey || !mailbox) return json(res, 400, { error: "code, pubkey, mailbox required" });
        if (codes.has(code)) return json(res, 409, { error: "code in use" });
        codes.set(code, { pubkey, mailbox, payload: payload ?? null, expires: Date.now() + CODE_TTL });
        return json(res, 201, { ok: true, ttlMs: CODE_TTL });
      }

      // Family B claims the code: gets A's pubkey/mailbox, code burns immediately.
      if (req.method === "POST" && url.pathname === "/pair/claim") {
        const { code } = await readBody(req);
        const entry = codes.get(code);
        if (!entry || entry.expires < Date.now()) return json(res, 404, { error: "unknown or expired code" });
        codes.delete(code); // one-time
        return json(res, 200, { pubkey: entry.pubkey, mailbox: entry.mailbox, payload: entry.payload });
      }

      // Drop encrypted mail into a mailbox.
      if (req.method === "POST" && url.pathname === "/mail/send") {
        const { to, body } = await readBody(req);
        if (!to || typeof body !== "string") return json(res, 400, { error: "to, body required" });
        const queue = mailboxes.get(to) ?? [];
        if (queue.length >= MAX_QUEUE) queue.shift();
        queue.push({ body, expires: Date.now() + MSG_TTL });
        mailboxes.set(to, queue);
        return json(res, 202, { ok: true });
      }

      // Collect (and clear) a mailbox. The id is an unguessable 128-bit secret.
      if (req.method === "POST" && url.pathname === "/mail/collect") {
        const { mailbox } = await readBody(req);
        if (!mailbox) return json(res, 400, { error: "mailbox required" });
        const queue = mailboxes.get(mailbox) ?? [];
        mailboxes.delete(mailbox);
        return json(res, 200, { messages: queue.map((m) => m.body) });
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 400, { error: String(err.message ?? err) });
    }
  })
  .listen(PORT, () => console.log(`coord-relay on :${PORT} (RAM-only, e2e-encrypted blobs, no logs)`));

// Keep crypto imported for future use of timing-safe compares if needed.
void crypto;
