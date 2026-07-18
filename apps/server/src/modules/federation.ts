import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Checklist } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { config } from "../config.js";
import { settingsFor } from "../core/settings.js";
import { loginAllowed, recordLoginFailure, requireAccess, requireActor } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { parse } from "../core/http.js";
import type { Db } from "../core/db.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";
import { getHousehold } from "../core/household.js";
import { deriveSharedKey, ensureKeyPair, mailboxId, open, pairingCode, seal } from "../core/fedcrypto.js";
import { loadChecklists } from "./checklists.js";
import { createEvent } from "./calendar/service.js";

/**
 * Family-to-family federation.
 *
 * - Pairing: Jackbox-style one-time code. One family creates it, the other
 *   enters it, the first approves the request. Local (direct URL on your
 *   LAN/domains) by default; the relay (coord.tinbadger.com, replaceable) is
 *   opt-in for families that can't reach each other directly.
 * - Every payload is sealed with a per-pair X25519-derived AES-256-GCM key
 *   before leaving this server; the relay only ever sees ciphertext and
 *   random mailbox ids, keeps everything in RAM, and logs nothing.
 * - Sharing is explicit and per-list. Revoking (or unpairing) makes the list
 *   simply vanish on the other side — no errors, no residue.
 * - Conflicts resolve by arrival order at the owning family (the list's home
 *   instance is the source of truth; ops apply in order received).
 */

const DEFAULT_RELAY = "https://coord.tinbadger.com";

interface PeerRow {
  id: string;
  name: string;
  pubkey: string;
  shared_key: string;
  transport: "direct" | "relay";
  peer_url: string | null;
  outbox: string | null;
  inbox: string | null;
  status: "request" | "pending" | "active";
}

type FedMessage =
  | { type: "pair.approve"; name: string; pubkey: string; mailbox?: string; url?: string }
  | { type: "list.snapshot"; list: Checklist }
  | { type: "list.revoke"; remoteId: string }
  | { type: "list.op"; remoteId: string; itemId: string; op: "toggle" }
  | { type: "event.copy"; event: Record<string, unknown> }
  | { type: "photo.link"; url: string }
  | { type: "msg.text"; text: string; from: string }
  | { type: "file.offer"; transferId: string; name: string; size: number; sha256: string; chunkSize: number; chunks: number; from: string }
  | { type: "file.accept"; transferId: string }
  | { type: "file.decline"; transferId: string }
  | { type: "file.done"; transferId: string }
  | { type: "peer.remove" };

const CHUNK_SIZE = 512 * 1024;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // buffered upload — keep sane
const MAX_OFFER_BYTES = 2 * 1024 * 1024 * 1024;

interface TransferRow {
  id: string;
  peer_id: string;
  direction: "in" | "out";
  name: string;
  size: number;
  sha256: string;
  chunk_size: number;
  chunks: number;
  status: "offered" | "sending" | "receiving" | "done" | "declined" | "failed";
  progress: number;
  dest: "nas" | "app" | null;
  local_path: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  peer_id: string;
  direction: "in" | "out";
  sender: string;
  kind: "text" | "file";
  body: string;
  transfer_id: string | null;
  created_at: number;
}

/** "../../etc passwd" → "etc passwd"; empty → "file". */
const safeName = (raw: string) =>
  (path.basename(raw).replace(/[\u0000-\u001f]/g, "").trim() || "file").slice(0, 150);

export const federationModule: CoreModule = {
  id: "core.federation",
  name: "Family connections",
  description: "Share chosen lists and events with extended family — end-to-end encrypted.",
  register({ app, db, bus, scheduler, settings, broadcast, log }) {
    const keys = ensureKeyPair(settings);
    const relayUrl = () => settings.get<string>("relayUrl", DEFAULT_RELAY).replace(/\/$/, "");
    const relayEnabled = () => settings.get<boolean>("relayEnabled", false);
    const allowPairing = () => settings.get<boolean>("allowPairing", true);
    const ourName = () => getHousehold(db)?.name ?? "A Sett family";

    /** Open pairing offers we created: code -> {mailbox, expires} (RAM only). */
    const offers = new Map<string, { mailbox: string; expires: number }>();
    const lastSent = new Map<string, string>(); // shareKey -> payload hash

    const invalidate = () => broadcast({ type: "invalidate", keys: ["checklists", "dashboard"] });
    /** Nudge every open Settings screen — a request arrived or a peer changed. */
    const fedChanged = () => broadcast({ type: "invalidate", keys: ["federation"] });

    // ---------- transport ----------

    async function relayPost(path: string, body: unknown): Promise<Record<string, unknown>> {
      const res = await fetch(`${relayUrl()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`relay ${path}: ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    }

    async function sendToPeer(peer: PeerRow, message: FedMessage) {
      // Placeholder rows (a relay offer nobody has claimed yet) have no real
      // key — there's nobody to talk to, and seal() would throw.
      if (!peer.shared_key || peer.shared_key === "-") return;
      try {
        const envelope = { pk: keys.publicKey, body: seal(peer.shared_key, message) };
        if (peer.transport === "direct" && peer.peer_url) {
          await fetch(`${peer.peer_url.replace(/\/$/, "")}/api/federation/inbox`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope),
          });
        } else if (peer.outbox) {
          await relayPost("/mail/send", { to: peer.outbox, body: JSON.stringify(envelope) });
        }
      } catch (err) {
        log(`federation: send to "${peer.name}" failed (will retry on next sync): ${String(err)}`);
      }
    }

    function handleMessage(peer: PeerRow, message: FedMessage) {
      switch (message.type) {
        case "pair.approve": {
          db.prepare("UPDATE peers SET name = ?, status = 'active', outbox = COALESCE(?, outbox), peer_url = COALESCE(?, peer_url) WHERE id = ?")
            .run(message.name, message.mailbox ?? null, message.url ?? null, peer.id);
          recordAudit(db, getHousehold(db)!.id, { memberId: null, name: "Sett" }, "peer", peer.id, "create",
            `Connected with ${message.name} 🎉`);
          invalidate();
          fedChanged();
          break;
        }
        case "list.snapshot": {
          db.prepare(
            `INSERT INTO federated_lists (peer_id, remote_id, payload_json, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (peer_id, remote_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
          ).run(peer.id, message.list.id, JSON.stringify(message.list), now());
          invalidate();
          break;
        }
        case "list.revoke": {
          db.prepare("DELETE FROM federated_lists WHERE peer_id = ? AND remote_id = ?").run(peer.id, message.remoteId);
          invalidate(); // the list quietly disappears
          break;
        }
        case "list.op": {
          // They checked/unchecked an item on a list WE own: apply in arrival order.
          const share = db
            .prepare("SELECT 1 FROM peer_shares WHERE peer_id = ? AND checklist_id = ?")
            .get(peer.id, message.remoteId);
          if (!share) return; // not shared (anymore) — ignore silently
          const item = db
            .prepare("SELECT checked, text FROM checklist_items WHERE id = ? AND checklist_id = ?")
            .get(message.itemId, message.remoteId) as { checked: number; text: string } | undefined;
          if (!item) return;
          db.prepare("UPDATE checklist_items SET checked = ?, checked_by = NULL, checked_at = ? WHERE id = ?")
            .run(item.checked ? 0 : 1, item.checked ? null : now(), message.itemId);
          if (!item.checked) {
            recordAudit(db, getHousehold(db)!.id, { memberId: null, name: `${peer.name}` }, "checklist",
              message.remoteId, "check", `${peer.name} got "${item.text}"`);
          }
          invalidate();
          void syncShares(); // push the new snapshot back out promptly
          break;
        }
        case "event.copy": {
          const input = message.event as Parameters<typeof createEvent>[4];
          createEvent(db, bus, getHousehold(db)!.id, { memberId: null, name: peer.name }, input);
          break;
        }
        case "photo.link": {
          // A photo shared from the other family: lands in History and pops
          // a toast on every open screen (the link is a public share link).
          recordAudit(db, getHousehold(db)!.id, { memberId: null, name: peer.name }, "photo", peer.id, "create",
            `${peer.name} shared a photo 📷 ${message.url}`);
          broadcast({
            type: "reminder",
            payload: { title: `📷 ${peer.name} shared a photo`, body: message.url, entityType: "event", entityId: "" },
          });
          break;
        }
        case "msg.text": {
          recordMessage(peer, "in", `${message.from} (${peer.name})`, null, "text", String(message.text).slice(0, 4000), null);
          break;
        }
        case "file.offer": {
          const size = Number(message.size);
          const chunkSize = Number(message.chunkSize);
          const chunks = Number(message.chunks);
          if (!Number.isFinite(size) || size <= 0 || size > MAX_OFFER_BYTES) return;
          if (chunkSize <= 0 || chunkSize > 4 * 1024 * 1024 || chunks !== Math.ceil(size / chunkSize)) return;
          const name = safeName(message.name);
          db.prepare(
            `INSERT OR IGNORE INTO fed_transfers (id, peer_id, direction, name, size, sha256, chunk_size, chunks, status, created_at, updated_at)
             VALUES (?, ?, 'in', ?, ?, ?, ?, ?, 'offered', ?, ?)`,
          ).run(message.transferId, peer.id, name, size, String(message.sha256), chunkSize, chunks, now(), now());
          recordMessage(peer, "in", `${message.from} (${peer.name})`, null, "file", name, message.transferId);
          break;
        }
        case "file.accept": {
          const t = getTransfer(message.transferId);
          if (t && t.peer_id === peer.id && t.direction === "out") setTransfer(t.id, { status: "sending" });
          break;
        }
        case "file.decline": {
          const t = getTransfer(message.transferId);
          if (t && t.peer_id === peer.id && t.direction === "out") setTransfer(t.id, { status: "declined" });
          break;
        }
        case "file.done": {
          const t = getTransfer(message.transferId);
          if (t && t.peer_id === peer.id && t.direction === "out") setTransfer(t.id, { status: "done", progress: t.chunks });
          break;
        }
        case "peer.remove": {
          removePeerLocal(peer.id);
          break;
        }
      }
    }

    function removePeerLocal(peerId: string) {
      db.prepare("DELETE FROM federated_lists WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM peer_shares WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM fed_messages WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM fed_transfers WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM message_reads WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM peers WHERE id = ?").run(peerId);
      invalidate();
      fedChanged();
    }

    // ---------- messages & file transfers ----------

    const messagesChanged = () => broadcast({ type: "invalidate", keys: ["messages"] });
    /** Where received/outgoing files live when not on the NAS. */
    const appFilesRoot = () =>
      process.env.FILES_DIR ?? path.join(path.dirname(config.databasePath), "files");
    const nasFilesRoot = () => {
      const root = settingsFor(db, "nas").get<string>("root", "").replace(/\/+$/, "");
      return root ? path.join(root, "files") : null;
    };

    /** Members allowed to use messages: parents + kids a parent granted. */
    const messengerIds = () =>
      (db.prepare("SELECT id, role, grants_json FROM members").all() as
        { id: string; role: string; grants_json: string | null }[])
        .filter((m) => m.role === "parent" ||
          (m.grants_json ? (JSON.parse(m.grants_json) as string[]).includes("messages.use") : false))
        .map((m) => m.id);

    function requireMessenger(req: Parameters<typeof requireAccess>[1], reply: Parameters<typeof requireAccess>[2]) {
      const access = requireAccess(db, req, reply);
      if (!access) return null;
      if (access.kind === "device") {
        reply.code(403).send({ error: "Displays can't use messages" });
        return null;
      }
      if (access.kind === "member" && access.role !== "parent") {
        const row = db.prepare("SELECT grants_json FROM members WHERE id = ?").get(access.memberId) as
          { grants_json: string | null } | undefined;
        const grants = row?.grants_json ? (JSON.parse(row.grants_json) as string[]) : [];
        if (!grants.includes("messages.use")) {
          reply.code(403).send({ error: "Ask a parent to switch on messages for you" });
          return null;
        }
      }
      return access;
    }

    function recordMessage(
      peer: PeerRow, direction: "in" | "out", sender: string, senderMemberId: string | null,
      kind: "text" | "file", body: string, transferId: string | null,
    ) {
      db.prepare(
        `INSERT INTO fed_messages (id, peer_id, direction, sender, sender_member_id, kind, body, transfer_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uid(), peer.id, direction, sender, senderMemberId, kind, body, transferId, now());
      messagesChanged();
      if (direction === "in") {
        // Standard notification pipeline (toast + web push via the reminders
        // bridge). Deliberately NO content preview — message bodies stay
        // behind sign-in, and wall displays shouldn't read them out.
        bus.emit("reminder.fired", {
          entityType: "event", entityId: "",
          title: "💬 New family message", body: `From ${peer.name}`,
          targetMemberIds: messengerIds(),
        });
      }
    }

    const toApiTransfer = (t: TransferRow) => ({
      id: t.id, peerId: t.peer_id, direction: t.direction, name: t.name, size: t.size,
      sha256: t.sha256, chunks: t.chunks, status: t.status, progress: t.progress,
      dest: t.dest, error: t.error, createdAt: t.created_at,
    });
    const toApiMessage = (m: MessageRow) => ({
      id: m.id, peerId: m.peer_id, direction: m.direction, sender: m.sender,
      kind: m.kind, body: m.body, transferId: m.transfer_id, createdAt: m.created_at,
    });
    const getTransfer = (id: string) =>
      db.prepare("SELECT * FROM fed_transfers WHERE id = ?").get(id) as TransferRow | undefined;
    const setTransfer = (id: string, fields: Partial<TransferRow>) => {
      const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
      db.prepare(`UPDATE fed_transfers SET ${sets}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(fields), now(), id);
      messagesChanged();
    };

    /** name.jpg → name (2).jpg if taken; keeps families from clobbering files. */
    function uniquePath(dir: string, name: string): string {
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let candidate = path.join(dir, name);
      for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
      return candidate;
    }

    /** Pull all chunks of an accepted incoming transfer from the sender. */
    const pulling = new Set<string>();
    async function pullTransfer(transferId: string) {
      if (pulling.has(transferId)) return;
      pulling.add(transferId);
      try {
        const t = getTransfer(transferId);
        const peer = t && (db.prepare("SELECT * FROM peers WHERE id = ?").get(t.peer_id) as PeerRow | undefined);
        if (!t || !peer || t.direction !== "in" || !t.local_path) return;
        if (peer.transport !== "direct" || !peer.peer_url) {
          setTransfer(transferId, { status: "failed", error: "File transfers need a direct connection between the two families" });
          return;
        }
        const url = `${peer.peer_url.replace(/\/$/, "")}/api/federation/blob`;
        const hash = crypto.createHash("sha256");
        fs.mkdirSync(path.dirname(t.local_path), { recursive: true });
        const handle = await fs.promises.open(t.local_path, "w");
        try {
          for (let chunk = 0; chunk < t.chunks; chunk++) {
            const res = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ pk: keys.publicKey, body: seal(peer.shared_key, { transferId, chunk }) }),
            });
            if (!res.ok) throw new Error(`their server said ${res.status}`);
            const sealed = (await res.json()) as { body?: string };
            if (!sealed.body) throw new Error("empty chunk reply");
            const payload = open<{ chunk: number; data: string }>(peer.shared_key, sealed.body);
            if (payload.chunk !== chunk) throw new Error("chunk order mismatch");
            const buf = Buffer.from(payload.data, "base64");
            hash.update(buf);
            await handle.write(buf, 0, buf.length, chunk * t.chunk_size);
            if (chunk % 8 === 0 || chunk === t.chunks - 1) setTransfer(transferId, { progress: chunk + 1 });
          }
        } finally {
          await handle.close();
        }
        if (hash.digest("hex") !== t.sha256) {
          fs.rmSync(t.local_path, { force: true });
          setTransfer(transferId, { status: "failed", error: "The file arrived damaged — ask them to send it again" });
          return;
        }
        setTransfer(transferId, { status: "done", progress: t.chunks });
        await sendToPeer(peer, { type: "file.done", transferId });
        recordAudit(db, getHousehold(db)!.id, { memberId: null, name: peer.name }, "peer", peer.id, "create",
          `Received "${t.name}" from ${peer.name} 📁`);
        bus.emit("reminder.fired", {
          entityType: "event", entityId: "",
          title: "📁 File received", body: `"${t.name}" from ${peer.name} is ready`,
          targetMemberIds: messengerIds(),
        });
      } catch (err) {
        setTransfer(transferId, { status: "failed", error: `Transfer interrupted (${String(err instanceof Error ? err.message : err)}) — accept again to retry` });
      } finally {
        pulling.delete(transferId);
      }
    }

    function receiveEnvelope(envelope: { pk?: string; body?: string }) {
      if (!envelope.pk || !envelope.body) return;
      const peer = db.prepare("SELECT * FROM peers WHERE pubkey = ?").get(envelope.pk) as PeerRow | undefined;
      if (!peer) return; // unknown sender — drop silently
      try {
        handleMessage(peer, open<FedMessage>(peer.shared_key, envelope.body));
      } catch {
        // bad seal — drop; never crash on remote input
      }
    }

    // ---------- outbound share sync (hash-gated snapshots) ----------

    async function syncShares() {
      const household = getHousehold(db);
      if (!household) return;
      const shares = db
        .prepare("SELECT s.peer_id, s.checklist_id FROM peer_shares s JOIN peers p ON p.id = s.peer_id AND p.status = 'active'")
        .all() as { peer_id: string; checklist_id: string }[];
      if (!shares.length) return;
      const lists = new Map(loadChecklists(db, household.id).map((l) => [l.id, l]));
      for (const share of shares) {
        const list = lists.get(share.checklist_id);
        const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(share.peer_id) as PeerRow | undefined;
        if (!peer) continue;
        if (!list) {
          // list deleted locally → revoke remotely
          db.prepare("DELETE FROM peer_shares WHERE peer_id = ? AND checklist_id = ?").run(share.peer_id, share.checklist_id);
          await sendToPeer(peer, { type: "list.revoke", remoteId: share.checklist_id });
          continue;
        }
        const key = `${share.peer_id}:${share.checklist_id}`;
        const hash = JSON.stringify(list);
        if (lastSent.get(key) === hash) continue;
        await sendToPeer(peer, { type: "list.snapshot", list });
        lastSent.set(key, hash);
      }
    }

    scheduler.every("federation.sync", 15, async () => {
      await syncShares();

      // Expire unclaimed relay-offer placeholders alongside their codes.
      const stale = db
        .prepare("SELECT id FROM peers WHERE shared_key = '-' AND created_at < ?")
        .all(now() - 15 * 60_000) as { id: string }[];
      for (const row of stale) removePeerLocal(row.id);

      // Direct peers we're still waiting on: ask the other side directly.
      // Approval is normally pushed to us, but if that one delivery failed
      // (server asleep, proxy hiccup) this poll rescues the pairing.
      const waitingDirect = db
        .prepare("SELECT * FROM peers WHERE status = 'pending' AND transport = 'direct' AND peer_url IS NOT NULL")
        .all() as PeerRow[];
      for (const peer of waitingDirect) {
        try {
          const res = await fetch(`${peer.peer_url!.replace(/\/$/, "")}/api/federation/pair/poll`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pubkey: keys.publicKey }),
          });
          if (!res.ok) continue;
          const verdict = (await res.json()) as { waiting: boolean; envelope?: { pk: string; body: string } };
          if (verdict.envelope) receiveEnvelope(verdict.envelope);
        } catch {
          // unreachable — try again next tick
        }
      }

      // Collect relay mail for all peers (and finalize pending relay pairings).
      if (!relayEnabled()) return;
      const peers = db.prepare("SELECT * FROM peers WHERE transport = 'relay' AND inbox IS NOT NULL").all() as PeerRow[];
      for (const peer of peers) {
        try {
          const { messages } = (await relayPost("/mail/collect", { mailbox: peer.inbox })) as { messages: string[] };
          for (const raw of messages) receiveEnvelope(JSON.parse(raw));
        } catch {
          // relay unreachable — try again next tick
        }
      }
    });

    // ---------- public endpoints (other families reach these) ----------

    // Direct-transport message drop-off. Content is sealed; auth is the seal itself.
    app.post("/api/federation/inbox", (req) => {
      receiveEnvelope((req.body ?? {}) as { pk?: string; body?: string });
      return { ok: true };
    });

    // File-chunk pull. Request AND response are sealed with the pair key, so
    // proxies and analyzers see the same opaque blobs as every other
    // federation payload. Auth is the seal: only the paired family can form
    // a valid request or read the reply.
    app.post("/api/federation/blob", async (req, reply) => {
      const envelope = (req.body ?? {}) as { pk?: string; body?: string };
      const peer = envelope.pk &&
        (db.prepare("SELECT * FROM peers WHERE pubkey = ? AND status = 'active'").get(envelope.pk) as PeerRow | undefined);
      if (!peer || !envelope.body) return reply.code(404).send({ error: "no" });
      let ask: { transferId: string; chunk: number };
      try {
        ask = open(peer.shared_key, envelope.body);
      } catch {
        return reply.code(404).send({ error: "no" });
      }
      const t = getTransfer(ask.transferId);
      if (!t || t.peer_id !== peer.id || t.direction !== "out" || !t.local_path ||
          !["offered", "sending"].includes(t.status) || ask.chunk < 0 || ask.chunk >= t.chunks) {
        return reply.code(404).send({ error: "no" });
      }
      const handle = await fs.promises.open(t.local_path, "r");
      try {
        const length = Math.min(t.chunk_size, t.size - ask.chunk * t.chunk_size);
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, ask.chunk * t.chunk_size);
        if (t.status === "offered") setTransfer(t.id, { status: "sending" });
        if (ask.chunk + 1 > t.progress) setTransfer(t.id, { progress: ask.chunk + 1 });
        return { body: seal(peer.shared_key, { chunk: ask.chunk, data: buf.toString("base64") }) };
      } finally {
        await handle.close();
      }
    });

    // "Any verdict on my request?" — a pending requester polls this until the
    // family here approves. The approval is re-issued as a sealed envelope, so
    // only the true keyholder can read it; strangers just see {waiting:true}.
    app.post("/api/federation/pair/poll", (req, reply) => {
      const body = parse(z.object({ pubkey: z.string().min(8).max(200) }), req.body, reply);
      if (!body) return;
      const peer = db.prepare("SELECT * FROM peers WHERE pubkey = ?").get(body.pubkey) as PeerRow | undefined;
      if (!peer || peer.status !== "active") return { waiting: true };
      return {
        waiting: false,
        envelope: {
          pk: keys.publicKey,
          body: seal(peer.shared_key, {
            type: "pair.approve", name: ourName(), pubkey: keys.publicKey,
            mailbox: peer.transport === "relay" ? (peer.inbox ?? undefined) : undefined,
          } satisfies FedMessage),
        },
      };
    });

    // Direct-mode pairing request (they entered OUR code and OUR url).
    app.post("/api/federation/pair", (req, reply) => {
      if (!allowPairing()) {
        reply.code(403).send({ error: "This family isn't accepting connections right now" });
        return;
      }
      const body = parse(
        z.object({ code: z.string(), pubkey: z.string(), name: z.string().max(60), replyUrl: z.string().url().max(200) }),
        req.body, reply,
      );
      if (!body) return;
      const key = `${req.ip}:fedpair`;
      if (!loginAllowed(key)) {
        reply.code(429).send({ error: "Too many tries" });
        return;
      }
      if (body.pubkey === keys.publicKey) {
        reply.code(400).send({ error: "That's this family's own code — enter it on the OTHER family's Sett" });
        return;
      }
      const offer = offers.get(body.code.toUpperCase());
      if (!offer || offer.expires < now()) {
        recordLoginFailure(key);
        reply.code(404).send({ error: "Unknown or expired code" });
        return;
      }
      offers.delete(body.code.toUpperCase());
      // Re-request from a family we already know: refresh in place instead of
      // stacking duplicate rows (duplicate pubkeys would confuse the inbox).
      const existing = db.prepare("SELECT id FROM peers WHERE pubkey = ?").get(body.pubkey) as { id: string } | undefined;
      if (existing) removePeerLocal(existing.id);
      db.prepare(
        `INSERT INTO peers (id, name, pubkey, shared_key, transport, peer_url, status, created_at)
         VALUES (?, ?, ?, ?, 'direct', ?, 'request', ?)`,
      ).run(uid(), body.name, body.pubkey, deriveSharedKey(keys.privateKey, body.pubkey), body.replyUrl, now());
      fedChanged();
      // Our pubkey is public — returning it lets the requester derive the
      // pair key right away so our approval message opens cleanly.
      return { ok: true, pending: true, pubkey: keys.publicKey };
    });

    // ---------- family-facing endpoints ----------

    app.get("/api/federation", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const peers = (db.prepare("SELECT * FROM peers ORDER BY created_at").all() as PeerRow[]).map((p) => ({
        id: p.id, name: p.name, transport: p.transport, status: p.status,
        shares: (db.prepare("SELECT checklist_id FROM peer_shares WHERE peer_id = ?").all(p.id) as { checklist_id: string }[])
          .map((s) => s.checklist_id),
      }));
      return {
        relayUrl: relayUrl(), relayEnabled: relayEnabled(), allowPairing: allowPairing(),
        peers: peers.filter((p) => p.status !== "request"),
        requests: peers.filter((p) => p.status === "request"),
      };
    });

    app.post("/api/federation/settings", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const body = parse(
        z.object({ relayUrl: z.string().url().optional(), relayEnabled: z.boolean().optional(), allowPairing: z.boolean().optional() }),
        req.body, reply,
      );
      if (!body) return;
      if (body.relayUrl !== undefined) settings.set("relayUrl", body.relayUrl);
      if (body.relayEnabled !== undefined) settings.set("relayEnabled", body.relayEnabled);
      if (body.allowPairing !== undefined) settings.set("allowPairing", body.allowPairing);
      return { ok: true };
    });

    // Create a one-time connect code (shown big on screen, speakable on the phone).
    app.post("/api/federation/code", async (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const body = parse(z.object({ mode: z.enum(["local", "relay"]).default("local") }), req.body ?? {}, reply);
      if (!body) return;
      const code = pairingCode();
      const mailbox = mailboxId();
      offers.set(code, { mailbox, expires: now() + 10 * 60_000 });
      if (body.mode === "relay") {
        if (!relayEnabled()) {
          reply.code(400).send({ error: "Turn on the connection server first" });
          return;
        }
        try {
          await relayPost("/pair/offer", { code, pubkey: keys.publicKey, mailbox });
        } catch {
          reply.code(502).send({ error: `Couldn't reach the connection server at ${relayUrl()} — is it up?` });
          return;
        }
        // Watch that mailbox for the incoming request. pubkey '-' marks this
        // as a placeholder (nobody has claimed the code yet).
        db.prepare(
          `INSERT INTO peers (id, name, pubkey, shared_key, transport, inbox, status, created_at)
           VALUES (?, '(waiting…)', ?, ?, 'relay', ?, 'pending', ?)`,
        ).run(uid(), `offer:${code}`, "-", mailbox, now());
        fedChanged();
      }
      return { code, expiresInMinutes: 10 };
    });

    // Enter another family's code (with their URL for local, or via the relay).
    app.post("/api/federation/connect", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(
        z.object({ code: z.string().min(4).max(12), url: z.string().url().max(200).optional() }),
        req.body, reply,
      );
      if (!body) return;
      const code = body.code.toUpperCase();

      if (body.url) {
        // Local/direct: talk straight to their instance.
        const ourUrl = `${req.protocol}://${req.headers.host}`;
        const res = await fetch(`${body.url.replace(/\/$/, "")}/api/federation/pair`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, pubkey: keys.publicKey, name: ourName(), replyUrl: ourUrl }),
        }).catch(() => null);
        if (!res) {
          reply.code(400).send({ error: "Couldn't reach that family — check the address and code" });
          return;
        }
        if (!res.ok) {
          // Their Sett answered with a reason (expired code, pairing off,
          // own-code mixup…) — pass it through instead of a generic shrug.
          const remote = (await res.json().catch(() => null)) as { error?: string } | null;
          reply.code(400).send({ error: remote?.error ?? "Couldn't reach that family — check the address and code" });
          return;
        }
        const { pubkey } = (await res.json()) as { pubkey: string };
        if (pubkey === keys.publicKey) {
          reply.code(400).send({ error: "That address is this Sett itself — enter the OTHER family's address" });
          return;
        }
        const dup = db.prepare("SELECT id FROM peers WHERE pubkey = ?").get(pubkey) as { id: string } | undefined;
        if (dup) removePeerLocal(dup.id); // retrying replaces the stale attempt
        db.prepare(
          `INSERT INTO peers (id, name, pubkey, shared_key, transport, peer_url, status, created_at)
           VALUES (?, '(waiting for approval…)', ?, ?, 'direct', ?, 'pending', ?)`,
        ).run(uid(), pubkey, deriveSharedKey(keys.privateKey, pubkey), body.url, now());
        fedChanged();
        return { ok: true, waiting: true };
      }

      // Relay: claim the code, seal an intro into their mailbox.
      if (!relayEnabled()) {
        reply.code(400).send({ error: "Turn on the connection server first (Settings → Family connections)" });
        return;
      }
      const claim = (await relayPost("/pair/claim", { code }).catch(() => null)) as
        | { pubkey: string; mailbox: string } | null;
      if (!claim?.pubkey) {
        reply.code(404).send({ error: "Unknown or expired code (or the connection server is unreachable)" });
        return;
      }
      if (claim.pubkey === keys.publicKey) {
        reply.code(400).send({ error: "That's this family's own code — enter it on the OTHER family's Sett" });
        return;
      }
      const sharedKey = deriveSharedKey(keys.privateKey, claim.pubkey);
      const inbox = mailboxId();
      const peerId = uid();
      const dup = db.prepare("SELECT id FROM peers WHERE pubkey = ?").get(claim.pubkey) as { id: string } | undefined;
      if (dup) removePeerLocal(dup.id);
      db.prepare(
        `INSERT INTO peers (id, name, pubkey, shared_key, transport, outbox, inbox, status, created_at)
         VALUES (?, '(waiting for approval…)', ?, ?, 'relay', ?, ?, 'pending', ?)`,
      ).run(peerId, claim.pubkey, sharedKey, claim.mailbox, inbox, now());
      await relayPost("/mail/send", {
        to: claim.mailbox,
        body: JSON.stringify({
          pk: keys.publicKey,
          body: seal(sharedKey, { type: "pair.request", name: ourName(), pubkey: keys.publicKey, mailbox: inbox }),
        }),
      });
      fedChanged();
      return { ok: true, waiting: true };
    });

    // Relay pairing requests arrive in offer mailboxes — surface them.
    scheduler.every("federation.offers", 10, async () => {
      if (!relayEnabled()) return;
      // Placeholders are the rows still carrying the dummy shared key. (An
      // earlier version matched pubkey = '-', which never matched the rows
      // actually inserted — incoming relay requests were never surfaced.)
      const waiting = db
        .prepare("SELECT * FROM peers WHERE status = 'pending' AND shared_key = '-' AND transport = 'relay'")
        .all() as PeerRow[];
      for (const offer of waiting) {
        try {
          const { messages } = (await relayPost("/mail/collect", { mailbox: offer.inbox })) as { messages: string[] };
          for (const raw of messages) {
            const envelope = JSON.parse(raw) as { pk: string; body: string };
            const sharedKey = deriveSharedKey(keys.privateKey, envelope.pk);
            const intro = open<{ type: string; name: string; pubkey: string; mailbox: string }>(sharedKey, envelope.body);
            if (intro.type !== "pair.request") continue;
            db.prepare("UPDATE peers SET name = ?, pubkey = ?, shared_key = ?, outbox = ?, status = 'request' WHERE id = ?")
              .run(intro.name, intro.pubkey, sharedKey, intro.mailbox, offer.id);
            fedChanged();
          }
        } catch { /* retry next tick */ }
      }
    });

    app.post("/api/federation/requests/:id/approve", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'request'").get(id) as PeerRow | undefined;
      if (!peer) {
        reply.code(404).send({ error: "Request not found" });
        return;
      }
      const inbox = peer.transport === "relay" ? (peer.inbox ?? mailboxId()) : null;
      db.prepare("UPDATE peers SET status = 'active', inbox = COALESCE(inbox, ?) WHERE id = ?").run(inbox, id);
      const ourUrl = `${req.protocol}://${req.headers.host}`;
      await sendToPeer({ ...peer, status: "active" }, {
        type: "pair.approve", name: ourName(), pubkey: keys.publicKey,
        mailbox: inbox ?? undefined, url: peer.transport === "direct" ? ourUrl : undefined,
      });
      recordAudit(db, access.householdId, actorOf(access), "peer", id, "create",
        `${access.name} connected with ${peer.name} 🎉`);
      invalidate();
      fedChanged();
      return { ok: true };
    });

    app.delete("/api/federation/requests/:id", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      removePeerLocal((req.params as { id: string }).id);
      return { ok: true };
    });

    app.delete("/api/federation/peers/:id", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(id) as PeerRow | undefined;
      if (peer) {
        await sendToPeer(peer, { type: "peer.remove" });
        recordAudit(db, access.householdId, actorOf(access), "peer", id, "delete",
          `${access.name} disconnected from ${peer.name}`);
      }
      removePeerLocal(id);
      return { ok: true };
    });

    // Share / revoke a list.
    app.post("/api/federation/peers/:id/share", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(z.object({ checklistId: z.string() }), req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      db.prepare("INSERT OR IGNORE INTO peer_shares (peer_id, checklist_id) VALUES (?, ?)").run(id, body.checklistId);
      lastSent.delete(`${id}:${body.checklistId}`);
      const peer = db.prepare("SELECT name FROM peers WHERE id = ?").get(id) as { name: string } | undefined;
      const list = db.prepare("SELECT title FROM checklists WHERE id = ?").get(body.checklistId) as { title: string } | undefined;
      if (peer && list) {
        recordAudit(db, access.householdId, actorOf(access), "checklist", body.checklistId, "update",
          `${access.name} shared "${list.title}" with ${peer.name}`);
      }
      await syncShares();
      return { ok: true };
    });

    app.delete("/api/federation/peers/:id/share/:checklistId", async (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id, checklistId } = req.params as { id: string; checklistId: string };
      db.prepare("DELETE FROM peer_shares WHERE peer_id = ? AND checklist_id = ?").run(id, checklistId);
      lastSent.delete(`${id}:${checklistId}`);
      const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(id) as PeerRow | undefined;
      if (peer) await sendToPeer(peer, { type: "list.revoke", remoteId: checklistId });
      return { ok: true };
    });

    // Send a (public, expiring) photo link to another family.
    app.post("/api/federation/peers/:id/share-photo", async (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check"); // any family member may share a photo
      if (!access) return;
      const body = parse(z.object({ url: z.string().url().max(300) }), req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'active'").get(id) as PeerRow | undefined;
      if (!peer) {
        reply.code(404).send({ error: "Family not found" });
        return;
      }
      await sendToPeer(peer, { type: "photo.link", url: body.url });
      recordAudit(db, access.householdId, actorOf(access), "photo", id, "update",
        `${access.name} shared a photo with ${peer.name}`);
      return { ok: true };
    });

    // Copy one of our events onto their calendar.
    app.post("/api/federation/peers/:id/send-event", async (req, reply) => {
      const access = requireActor(db, req, reply, "event.manage");
      if (!access) return;
      const body = parse(z.object({ eventId: z.string() }), req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'active'").get(id) as PeerRow | undefined;
      const row = db.prepare("SELECT * FROM events WHERE id = ? AND deleted_at IS NULL").get(body.eventId) as
        | Record<string, unknown> | undefined;
      if (!peer || !row) {
        reply.code(404).send({ error: "Peer or event not found" });
        return;
      }
      await sendToPeer(peer, {
        type: "event.copy",
        event: {
          title: row.title, description: `${row.description ?? ""}\n(from ${ourName()})`.trim(),
          location: row.location, category: row.category, startAt: row.start_at, endAt: row.end_at,
          allDay: !!row.all_day, timezone: row.timezone, rrule: row.rrule, assigneeIds: [], reminderMinutes: null,
        },
      });
      recordAudit(db, access.householdId, actorOf(access), "event", body.eventId, "update",
        `${access.name} sent "${String(row.title)}" to ${peer.name}`);
      return { ok: true };
    });

    // Lists shared WITH us (merged into the Lists page by the client).
    app.get("/api/federation/shared", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const rows = db
        .prepare(
          `SELECT f.peer_id AS peerId, f.remote_id AS remoteId, f.payload_json, p.name AS peerName
           FROM federated_lists f JOIN peers p ON p.id = f.peer_id ORDER BY f.updated_at DESC`,
        )
        .all() as { peerId: string; remoteId: string; payload_json: string; peerName: string }[];
      return {
        shared: rows.map((r) => ({ peerId: r.peerId, peerName: r.peerName, list: JSON.parse(r.payload_json) as Checklist })),
      };
    });

    // Check/uncheck an item on a list someone shared with us.
    app.post("/api/federation/shared/:peerId/:remoteId/toggle", async (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      const body = parse(z.object({ itemId: z.string() }), req.body, reply);
      if (!body) return;
      const { peerId, remoteId } = req.params as { peerId: string; remoteId: string };
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'active'").get(peerId) as PeerRow | undefined;
      const row = db.prepare("SELECT payload_json FROM federated_lists WHERE peer_id = ? AND remote_id = ?")
        .get(peerId, remoteId) as { payload_json: string } | undefined;
      if (!peer || !row) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      // Optimistic local flip; the owner's snapshot confirms shortly.
      const payload = JSON.parse(row.payload_json) as Checklist;
      const item = payload.items.find((i) => i.id === body.itemId);
      if (item) {
        item.checked = !item.checked;
        db.prepare("UPDATE federated_lists SET payload_json = ? WHERE peer_id = ? AND remote_id = ?")
          .run(JSON.stringify(payload), peerId, remoteId);
        invalidate();
      }
      await sendToPeer(peer, { type: "list.op", remoteId, itemId: body.itemId, op: "toggle" });
      return { ok: true };
    });

    // ---------- the message box (parents + kids a parent granted) ----------

    // Threads: one per connected family, with unread counts for this member.
    app.get("/api/messages", (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const peers = db.prepare("SELECT * FROM peers WHERE status = 'active' ORDER BY name").all() as PeerRow[];
      const threads = peers.map((peer) => {
        const last = db.prepare("SELECT * FROM fed_messages WHERE peer_id = ? ORDER BY created_at DESC LIMIT 1")
          .get(peer.id) as MessageRow | undefined;
        const seen = access.memberId
          ? ((db.prepare("SELECT last_seen_at FROM message_reads WHERE member_id = ? AND peer_id = ?")
              .get(access.memberId, peer.id) as { last_seen_at: number } | undefined)?.last_seen_at ?? 0)
          : Number.MAX_SAFE_INTEGER; // agents don't track unread
        const unread = (db.prepare(
          "SELECT COUNT(*) AS n FROM fed_messages WHERE peer_id = ? AND direction = 'in' AND created_at > ?",
        ).get(peer.id, seen) as { n: number }).n;
        return { peerId: peer.id, peerName: peer.name, lastMessage: last ? toApiMessage(last) : null, unread };
      });
      return { threads };
    });

    app.get("/api/messages/:peerId", (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const { peerId } = req.params as { peerId: string };
      const messages = (db.prepare(
        "SELECT * FROM fed_messages WHERE peer_id = ? ORDER BY created_at DESC LIMIT 200",
      ).all(peerId) as MessageRow[]).reverse();
      const transferIds = messages.map((m) => m.transfer_id).filter(Boolean) as string[];
      const transfers = Object.fromEntries(
        transferIds.map((id) => [id, getTransfer(id)]).filter(([, t]) => t).map(([id, t]) => [id, toApiTransfer(t as TransferRow)]),
      );
      return { messages: messages.map(toApiMessage), transfers };
    });

    app.post("/api/messages/:peerId/read", (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access?.memberId) return access ? { ok: true } : undefined;
      db.prepare(
        `INSERT INTO message_reads (member_id, peer_id, last_seen_at) VALUES (?, ?, ?)
         ON CONFLICT (member_id, peer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      ).run(access.memberId, (req.params as { peerId: string }).peerId, now());
      return { ok: true };
    });

    app.post("/api/messages/:peerId", async (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const body = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body, reply);
      if (!body) return;
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'active'")
        .get((req.params as { peerId: string }).peerId) as PeerRow | undefined;
      if (!peer) return reply.code(404).send({ error: "Family not found" });
      recordMessage(peer, "out", access.name, access.memberId, "text", body.text, null);
      await sendToPeer(peer, { type: "msg.text", text: body.text, from: access.name });
      return { ok: true };
    });

    // Offer a file: raw upload (application/octet-stream) + ?name=.
    app.put("/api/messages/:peerId/file", { bodyLimit: MAX_UPLOAD_BYTES + 1024 }, async (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const peer = db.prepare("SELECT * FROM peers WHERE id = ? AND status = 'active'")
        .get((req.params as { peerId: string }).peerId) as PeerRow | undefined;
      if (!peer) return reply.code(404).send({ error: "Family not found" });
      if (peer.transport !== "direct" || !peer.peer_url) {
        return reply.code(400).send({ error: "File transfers need a direct connection between the two families (not the relay)" });
      }
      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || data.length === 0) return reply.code(400).send({ error: "No file received" });
      const name = safeName(String((req.query as { name?: string }).name ?? "file"));
      const transferId = uid();
      const dir = path.join(appFilesRoot(), "outbox");
      fs.mkdirSync(dir, { recursive: true });
      const localPath = path.join(dir, `${transferId}-${name}`);
      fs.writeFileSync(localPath, data);
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");
      const chunks = Math.ceil(data.length / CHUNK_SIZE);
      db.prepare(
        `INSERT INTO fed_transfers (id, peer_id, direction, name, size, sha256, chunk_size, chunks, status, local_path, created_at, updated_at)
         VALUES (?, ?, 'out', ?, ?, ?, ?, ?, 'offered', ?, ?, ?)`,
      ).run(transferId, peer.id, name, data.length, sha256, CHUNK_SIZE, chunks, localPath, now(), now());
      recordMessage(peer, "out", access.name, access.memberId, "file", name, transferId);
      await sendToPeer(peer, {
        type: "file.offer", transferId, name, size: data.length, sha256, chunkSize: CHUNK_SIZE, chunks, from: access.name,
      });
      recordAudit(db, access.householdId, actorOf(access), "peer", peer.id, "update",
        `${access.name} sent "${name}" to ${peer.name}`);
      return { ok: true, transferId };
    });

    // Accept an incoming file: choose where it lands, then pull it.
    app.post("/api/messages/transfers/:id/accept", async (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const body = parse(z.object({ dest: z.enum(["nas", "app"]).default("app") }), req.body ?? {}, reply);
      if (!body) return;
      const t = getTransfer((req.params as { id: string }).id);
      if (!t || t.direction !== "in") return reply.code(404).send({ error: "Transfer not found" });
      if (!["offered", "failed"].includes(t.status)) return reply.code(400).send({ error: "Already handled" });
      const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(t.peer_id) as PeerRow | undefined;
      if (!peer) return reply.code(404).send({ error: "Family not found" });
      let baseDir: string;
      if (body.dest === "nas") {
        const nas = nasFilesRoot();
        if (!nas) return reply.code(400).send({ error: "No NAS folder is connected (Settings → Photos)" });
        baseDir = path.join(nas, `Shared from ${peer.name}`.replace(/[/\\]/g, " "));
      } else {
        baseDir = path.join(appFilesRoot(), `Shared from ${peer.name}`.replace(/[/\\]/g, " "));
      }
      fs.mkdirSync(baseDir, { recursive: true });
      setTransfer(t.id, { status: "receiving", progress: 0, dest: body.dest, local_path: uniquePath(baseDir, t.name), error: null });
      await sendToPeer(peer, { type: "file.accept", transferId: t.id });
      void pullTransfer(t.id);
      return { ok: true };
    });

    app.post("/api/messages/transfers/:id/decline", async (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const t = getTransfer((req.params as { id: string }).id);
      if (!t || t.direction !== "in") return reply.code(404).send({ error: "Transfer not found" });
      setTransfer(t.id, { status: "declined" });
      const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(t.peer_id) as PeerRow | undefined;
      if (peer) await sendToPeer(peer, { type: "file.decline", transferId: t.id });
      return { ok: true };
    });

    // Download a completed file to the device in hand.
    app.get("/api/messages/transfers/:id/download", async (req, reply) => {
      const access = requireMessenger(req, reply);
      if (!access) return;
      const t = getTransfer((req.params as { id: string }).id);
      if (!t || t.status !== "done" || !t.local_path || !fs.existsSync(t.local_path)) {
        return reply.code(404).send({ error: "File not available" });
      }
      reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="${t.name.replace(/"/g, "")}"`);
      return reply.send(fs.createReadStream(t.local_path));
    });
  },
};
