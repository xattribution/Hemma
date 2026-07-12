import { z } from "zod";
import type { Checklist } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
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
  | { type: "peer.remove" };

export const federationModule: CoreModule = {
  id: "core.federation",
  name: "Family connections",
  description: "Share chosen lists and events with extended family — end-to-end encrypted.",
  register({ app, db, bus, scheduler, settings, broadcast, log }) {
    const keys = ensureKeyPair(settings);
    const relayUrl = () => settings.get<string>("relayUrl", DEFAULT_RELAY).replace(/\/$/, "");
    const relayEnabled = () => settings.get<boolean>("relayEnabled", false);
    const allowPairing = () => settings.get<boolean>("allowPairing", true);
    const ourName = () => getHousehold(db)?.name ?? "A Coord family";

    /** Open pairing offers we created: code -> {mailbox, expires} (RAM only). */
    const offers = new Map<string, { mailbox: string; expires: number }>();
    const lastSent = new Map<string, string>(); // shareKey -> payload hash

    const invalidate = () => broadcast({ type: "invalidate", keys: ["checklists", "dashboard"] });

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
      const envelope = { pk: keys.publicKey, body: seal(peer.shared_key, message) };
      try {
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
          recordAudit(db, getHousehold(db)!.id, { memberId: null, name: "Coord" }, "peer", peer.id, "create",
            `Connected with ${message.name} 🎉`);
          invalidate();
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
        case "peer.remove": {
          removePeerLocal(peer.id);
          break;
        }
      }
    }

    function removePeerLocal(peerId: string) {
      db.prepare("DELETE FROM federated_lists WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM peer_shares WHERE peer_id = ?").run(peerId);
      db.prepare("DELETE FROM peers WHERE id = ?").run(peerId);
      invalidate();
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
      const offer = offers.get(body.code.toUpperCase());
      if (!offer || offer.expires < now()) {
        recordLoginFailure(key);
        reply.code(404).send({ error: "Unknown or expired code" });
        return;
      }
      offers.delete(body.code.toUpperCase());
      db.prepare(
        `INSERT INTO peers (id, name, pubkey, shared_key, transport, peer_url, status, created_at)
         VALUES (?, ?, ?, ?, 'direct', ?, 'request', ?)`,
      ).run(uid(), body.name, body.pubkey, deriveSharedKey(keys.privateKey, body.pubkey), body.replyUrl, now());
      broadcast({ type: "invalidate", keys: ["members"] }); // nudge settings screens
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
        await relayPost("/pair/offer", { code, pubkey: keys.publicKey, mailbox });
        // Watch that mailbox for the incoming request.
        db.prepare(
          `INSERT INTO peers (id, name, pubkey, shared_key, transport, inbox, status, created_at)
           VALUES (?, '(waiting…)', ?, ?, 'relay', ?, 'pending', ?)`,
        ).run(uid(), `offer:${code}`, "-", mailbox, now());
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
        if (!res?.ok) {
          reply.code(400).send({ error: "Couldn't reach that family — check the address and code" });
          return;
        }
        const { pubkey } = (await res.json()) as { pubkey: string };
        db.prepare(
          `INSERT INTO peers (id, name, pubkey, shared_key, transport, peer_url, status, created_at)
           VALUES (?, '(waiting for approval…)', ?, ?, 'direct', ?, 'pending', ?)`,
        ).run(uid(), pubkey, deriveSharedKey(keys.privateKey, pubkey), body.url, now());
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
        reply.code(404).send({ error: "Unknown or expired code" });
        return;
      }
      const sharedKey = deriveSharedKey(keys.privateKey, claim.pubkey);
      const inbox = mailboxId();
      const peerId = uid();
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
      return { ok: true, waiting: true };
    });

    // Relay pairing requests arrive in offer mailboxes — surface them.
    scheduler.every("federation.offers", 10, async () => {
      if (!relayEnabled()) return;
      const waiting = db
        .prepare("SELECT * FROM peers WHERE status = 'pending' AND pubkey = '-' AND transport = 'relay'")
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
            broadcast({ type: "invalidate", keys: ["members"] });
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
  },
};
