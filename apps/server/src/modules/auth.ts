import crypto from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_DISPLAY_CONFIG, displayConfigSchema, loginInputSchema, setupInputSchema,
  type DisplayConfig, type DisplayInfo, type Me,
} from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import {
  SESSION_COOKIE, clearLoginFailures, createSession, destroySession, hashCredential,
  loginAllowed, lookupSession, recordLoginFailure, requireActor, sessionOf, setElevation,
  setSessionCookie, toMember, verifyCredential, type MemberRow,
} from "../core/auth.js";
import { getHousehold } from "../core/household.js";
import { parse } from "../core/http.js";
import { now, uid, type Db } from "../core/db.js";
import { recordAudit } from "../core/audit.js";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

interface DeviceRow {
  id: string;
  token: string | null;
  label: string;
  config_json: string | null;
  created_at: number;
}

function deviceConfig(row: Pick<DeviceRow, "config_json">): DisplayConfig {
  if (!row.config_json) return DEFAULT_DISPLAY_CONFIG;
  return displayConfigSchema.parse(JSON.parse(row.config_json));
}

export const authModule: CoreModule = {
  id: "core.auth",
  name: "Family & sign-in",
  description: "Household setup, member sign-in, shared display links.",
  register({ app, db, broadcast }) {
    app.get("/api/setup/status", () => ({ needed: !getHousehold(db) }));

    app.post("/api/setup", (req, reply) => {
      if (getHousehold(db)) {
        reply.code(409).send({ error: "Already set up" });
        return;
      }
      const input = parse(setupInputSchema, req.body, reply);
      if (!input) return;
      const householdId = uid();
      const memberId = uid();
      db.transaction(() => {
        db.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run(
          householdId, input.householdName, input.timezone, now(),
        );
        db.prepare(
          `INSERT INTO members (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, created_at)
           VALUES (?, ?, ?, 'parent', ?, ?, ?, 'password', 0, ?)`,
        ).run(memberId, householdId, input.owner.name, input.owner.color, input.owner.avatar,
          hashCredential(input.owner.credential), now());
      })();
      setSessionCookie(reply, createSession(db, memberId, "member"));
      reply.code(201);
      return { ok: true };
    });

    // Public-ish: the login screen's avatar grid (no credentials exposed).
    app.get("/api/auth/members", () => {
      const rows = db
        .prepare("SELECT * FROM members WHERE deleted_at IS NULL ORDER BY sort_order, created_at")
        .all() as MemberRow[];
      return { members: rows.map(toMember) };
    });

    app.post("/api/auth/login", (req, reply) => {
      const input = parse(loginInputSchema, req.body, reply);
      if (!input) return;
      const key = `${req.ip}:${input.memberId}`;
      if (!loginAllowed(key)) {
        reply.code(429).send({ error: "Too many tries — take a break and try again in a bit" });
        return;
      }
      const member = db
        .prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL")
        .get(input.memberId) as (MemberRow & { credential_hash: string }) | undefined;
      if (!member || !verifyCredential(input.credential, member.credential_hash)) {
        recordLoginFailure(key);
        reply.code(401).send({ error: "That didn't match — try again" });
        return;
      }
      clearLoginFailures(key);
      setSessionCookie(reply, createSession(db, member.id, "member"));
      return { member: toMember(member) };
    });

    app.post("/api/auth/logout", (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) destroySession(db, token);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    app.get("/api/auth/me", (req, reply) => {
      const session = sessionOf(db, req);
      const household = getHousehold(db);
      if (!session || !household) {
        reply.code(401).send({ error: "Not signed in" });
        return;
      }
      const householdInfo = { name: household.name, timezone: household.timezone };
      if (session.kind === "member") {
        const me: Me = { kind: "member", member: toMember(session.member), household: householdInfo };
        return me;
      }
      // Devices and agents both get the device shape; agents rarely call this.
      let config = DEFAULT_DISPLAY_CONFIG;
      let elevation: Extract<Me, { kind: "device" }>["elevation"] = null;
      if (session.kind === "device") {
        if (session.deviceTokenId) {
          const row = db
            .prepare("SELECT config_json FROM device_tokens WHERE id = ?")
            .get(session.deviceTokenId) as { config_json: string | null } | undefined;
          if (row) config = deviceConfig(row);
        }
        if (session.elevatedMember && session.elevatedUntil) {
          elevation = { member: toMember(session.elevatedMember), until: session.elevatedUntil };
        }
      }
      const me: Me = { kind: "device", label: session.label, config, elevation, household: householdInfo };
      return me;
    });

    // ---- Household ----
    app.patch("/api/household", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(
        z.object({ name: z.string().trim().min(1).max(60).optional(), timezone: z.string().min(1).optional() }),
        req.body, reply,
      );
      if (!body) return;
      const household = getHousehold(db)!;
      db.prepare("UPDATE households SET name = ?, timezone = ? WHERE id = ?").run(
        body.name ?? household.name, body.timezone ?? household.timezone, household.id,
      );
      recordAudit(db, household.id, { memberId: access.memberId, name: access.name }, "household", household.id,
        "update", `${access.name} renamed the family to "${body.name ?? household.name}"`);
      broadcast({ type: "invalidate", keys: ["me", "dashboard"] });
      return { ok: true };
    });

    // ---- Display elevation: "who's changing things?" ----

    app.post("/api/auth/device/elevate", (req, reply) => {
      const cookieToken = req.cookies[SESSION_COOKIE];
      const session = cookieToken ? lookupSession(db, cookieToken) : null;
      if (session?.kind !== "device") {
        reply.code(400).send({ error: "Only displays elevate" });
        return;
      }
      const body = parse(z.object({ memberId: z.string(), credential: z.string().min(1).max(72) }), req.body, reply);
      if (!body) return;
      const key = `${req.ip}:elevate:${body.memberId}`;
      if (!loginAllowed(key)) {
        reply.code(429).send({ error: "Too many tries — take a break and try again in a bit" });
        return;
      }
      const member = db
        .prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL")
        .get(body.memberId) as (MemberRow & { credential_hash: string }) | undefined;
      if (!member || !verifyCredential(body.credential, member.credential_hash)) {
        recordLoginFailure(key);
        reply.code(401).send({ error: "That didn't match — try again" });
        return;
      }
      clearLoginFailures(key);
      const until = setElevation(db, cookieToken!, member.id);
      return { member: toMember(member), until };
    });

    app.post("/api/auth/device/deelevate", (req, reply) => {
      const cookieToken = req.cookies[SESSION_COOKIE];
      const session = cookieToken ? lookupSession(db, cookieToken) : null;
      if (session?.kind !== "device") {
        reply.code(400).send({ error: "Only displays elevate" });
        return;
      }
      setElevation(db, cookieToken!, null);
      return { ok: true };
    });

    // ---- Shared display links (kitchen, living room, bedroom…) ----

    const listDisplays = (): DisplayInfo[] =>
      (db
        .prepare("SELECT id, token, label, config_json, created_at FROM device_tokens WHERE revoked_at IS NULL ORDER BY created_at")
        .all() as DeviceRow[]).map((row) => ({
        id: row.id,
        label: row.label,
        token: row.token, // retrievable & shareable — family-trust model
        config: deviceConfig(row),
        createdAt: row.created_at,
      }));

    app.post("/api/devices", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(
        z.object({ label: z.string().trim().min(1).max(60), config: displayConfigSchema.optional() }),
        req.body, reply,
      );
      if (!body) return;
      const token = crypto.randomBytes(24).toString("base64url");
      const id = uid();
      db.prepare(
        "INSERT INTO device_tokens (id, token_hash, token, label, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, sha256(token), token, body.label,
        JSON.stringify(body.config ?? DEFAULT_DISPLAY_CONFIG), access.memberId, now());
      recordAudit(db, access.householdId, { memberId: access.memberId, name: access.name }, "device", id, "create",
        `${access.name} added display "${body.label}"`);
      reply.code(201);
      return { id, token };
    });

    app.get("/api/devices", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      return { devices: listDisplays() };
    });

    app.patch("/api/devices/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(
        z.object({ label: z.string().trim().min(1).max(60).optional(), config: displayConfigSchema.optional() }),
        req.body, reply,
      );
      if (!body) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM device_tokens WHERE id = ? AND revoked_at IS NULL").get(id) as DeviceRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Display not found" });
        return;
      }
      db.prepare("UPDATE device_tokens SET label = ?, config_json = ? WHERE id = ?").run(
        body.label ?? row.label,
        body.config ? JSON.stringify(body.config) : row.config_json,
        id,
      );
      // Signed-in kiosks pick up their new settings over the socket.
      broadcast({ type: "invalidate", keys: ["me", "dashboard"] });
      return { ok: true };
    });

    app.delete("/api/devices/:id", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const { id } = req.params as { id: string };
      db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(now(), id);
      db.prepare("DELETE FROM sessions WHERE device_token_id = ?").run(id); // sign the display out
      broadcast({ type: "invalidate", keys: ["me"] });
      return { ok: true };
    });

    // A display exchanges its link token for a session cookie.
    app.post("/api/auth/device", (req, reply) => {
      const body = parse(z.object({ token: z.string().min(10) }), req.body, reply);
      if (!body) return;
      const row = db
        .prepare("SELECT id, label FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL")
        .get(sha256(body.token)) as { id: string; label: string } | undefined;
      if (!row) {
        reply.code(401).send({ error: "Unknown display token" });
        return;
      }
      setSessionCookie(reply, createSession(db, null, "device", row.label, row.id));
      return { label: row.label };
    });
  },
};
