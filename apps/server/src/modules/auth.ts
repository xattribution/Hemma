import crypto from "node:crypto";
import { z } from "zod";
import { loginInputSchema, setupInputSchema, type Me } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import {
  SESSION_COOKIE, clearLoginFailures, createSession, destroySession, hashCredential,
  loginAllowed, recordLoginFailure, requireCan, sessionOf, setSessionCookie, toMember,
  verifyCredential, type MemberRow,
} from "../core/auth.js";
import { getHousehold } from "../core/household.js";
import { parse } from "../core/http.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const authModule: CoreModule = {
  id: "core.auth",
  name: "Family & sign-in",
  description: "Household setup, member sign-in, kiosk device tokens.",
  register({ app, db }) {
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
      const me: Me =
        session.kind === "member"
          ? { kind: "member", member: toMember(session.member), household: { name: household.name, timezone: household.timezone } }
          : { kind: "device", label: session.label, household: { name: household.name, timezone: household.timezone } };
      return me;
    });

    // ---- Kiosk device tokens ----

    app.post("/api/devices", (req, reply) => {
      const member = requireCan(db, req, reply, "settings.manage");
      if (!member) return;
      const body = parse(z.object({ label: z.string().trim().min(1).max(60) }), req.body, reply);
      if (!body) return;
      const token = crypto.randomBytes(24).toString("base64url");
      db.prepare(
        "INSERT INTO device_tokens (id, token_hash, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(uid(), sha256(token), body.label, member.id, now());
      recordAudit(db, member.household_id, { memberId: member.id, name: member.name }, "device", body.label, "create",
        `${member.name} added display "${body.label}"`);
      reply.code(201);
      return { token }; // shown once; only the hash is stored
    });

    app.get("/api/devices", (req, reply) => {
      if (!requireCan(db, req, reply, "settings.manage")) return;
      const rows = db
        .prepare("SELECT id, label, created_at FROM device_tokens WHERE revoked_at IS NULL ORDER BY created_at")
        .all();
      return { devices: rows };
    });

    app.delete("/api/devices/:id", (req, reply) => {
      if (!requireCan(db, req, reply, "settings.manage")) return;
      const { id } = req.params as { id: string };
      db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(now(), id);
      return { ok: true };
    });

    // A kiosk exchanges its device token for a device session cookie.
    app.post("/api/auth/device", (req, reply) => {
      const body = parse(z.object({ token: z.string().min(10) }), req.body, reply);
      if (!body) return;
      const row = db
        .prepare("SELECT label FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL")
        .get(sha256(body.token)) as { label: string } | undefined;
      if (!row) {
        reply.code(401).send({ error: "Unknown display token" });
        return;
      }
      setSessionCookie(reply, createSession(db, null, "device", row.label));
      return { label: row.label };
    });
  },
};
