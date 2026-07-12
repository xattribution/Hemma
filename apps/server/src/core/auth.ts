import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Member, Role } from "@coord/shared";
import { can, deviceCan, type Action } from "@coord/shared";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { getHousehold } from "./household.js";
import { config } from "../config.js";

export const SESSION_COOKIE = "coord_session";

// ---------- Credential hashing (scrypt — no native deps) ----------

export function hashCredential(credential: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(credential, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyCredential(credential: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(credential, Buffer.from(saltHex, "hex"), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// ---------- Principals ----------

export interface MemberRow {
  id: string;
  household_id: string;
  name: string;
  role: Role;
  color: string;
  avatar: string;
  sort_order: number;
}

export type SessionInfo =
  | { kind: "member"; member: MemberRow }
  | { kind: "device"; label: string; deviceTokenId: string | null }
  /** An AI/automation client authenticated with a bearer API token. */
  | { kind: "agent"; label: string };

/** A permission-checked principal, uniform across members, displays and agents. */
export interface Access {
  kind: "member" | "device" | "agent";
  memberId: string | null;
  householdId: string;
  /** Display name for attribution ("Mia", "Kitchen display", "HAL"). */
  name: string;
  role: Role | null;
}

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    avatar: row.avatar,
    sortOrder: row.sort_order,
  };
}

// ---------- Sessions ----------

export function createSession(
  db: Db,
  memberId: string | null,
  kind: "member" | "device",
  label = "",
  deviceTokenId: string | null = null,
): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = now() + config.sessionDays * 24 * 3600_000;
  db.prepare(
    `INSERT INTO sessions (token_hash, member_id, kind, label, device_token_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), memberId, kind, label, deviceTokenId, now(), expires, now());
  return token;
}

export function destroySession(db: Db, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function lookupSession(db: Db, token: string | undefined): SessionInfo | null {
  if (!token) return null;
  const session = db
    .prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(sha256(token), now()) as
    | { member_id: string | null; kind: "member" | "device"; label: string; device_token_id: string | null }
    | undefined;
  if (!session) return null;
  if (session.kind === "device") {
    return { kind: "device", label: session.label || "Display", deviceTokenId: session.device_token_id };
  }
  const member = db
    .prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL")
    .get(session.member_id) as MemberRow | undefined;
  return member ? { kind: "member", member } : null;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: "auto",
    maxAge: config.sessionDays * 24 * 3600,
  });
}

/** Resolve the caller: bearer API token (AI/automation) first, then cookie. */
export function sessionOf(db: Db, req: FastifyRequest): SessionInfo | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const row = db
      .prepare("SELECT label FROM api_tokens WHERE token = ? AND revoked_at IS NULL")
      .get(header.slice(7)) as { label: string } | undefined;
    return row ? { kind: "agent", label: row.label } : null;
  }
  return lookupSession(db, req.cookies[SESSION_COOKIE]);
}

// ---------- Guards ----------

function accessOf(db: Db, session: SessionInfo): Access {
  if (session.kind === "member") {
    return {
      kind: "member",
      memberId: session.member.id,
      householdId: session.member.household_id,
      name: session.member.name,
      role: session.member.role,
    };
  }
  const household = getHousehold(db);
  return {
    kind: session.kind,
    memberId: null,
    householdId: household?.id ?? "",
    name: session.label,
    role: null,
  };
}

/** Any signed-in principal (member, display or agent). */
export function requireAccess(db: Db, req: FastifyRequest, reply: FastifyReply): Access | null {
  const session = sessionOf(db, req);
  if (!session) {
    reply.code(401).send({ error: "Please sign in" });
    return null;
  }
  return accessOf(db, session);
}

/**
 * A principal allowed to perform `action`: members per their role, displays
 * per the small device allowlist, agents (API tokens) unrestricted — a
 * connected AI acts with full parent-level authority, attributed by label.
 */
export function requireActor(db: Db, req: FastifyRequest, reply: FastifyReply, action: Action): Access | null {
  const session = sessionOf(db, req);
  if (!session) {
    reply.code(401).send({ error: "Please sign in" });
    return null;
  }
  const allowed =
    session.kind === "agent" ||
    (session.kind === "member" && can(session.member.role, action)) ||
    (session.kind === "device" && deviceCan(action));
  if (!allowed) {
    reply.code(403).send({ error: session.kind === "member" ? "Ask a parent to do that" : "This display can't do that" });
    return null;
  }
  return accessOf(db, session);
}

/** A real family member only (used where a member identity is required, e.g. push subscriptions). */
export function requireMember(db: Db, req: FastifyRequest, reply: FastifyReply): MemberRow | null {
  const session = sessionOf(db, req);
  if (session?.kind !== "member") {
    reply.code(401).send({ error: "Please sign in" });
    return null;
  }
  return session.member;
}

// ---------- Login rate limiting (PIN brute-force protection) ----------

const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginAllowed(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now()) return true;
  return entry.count < 10;
}

export function recordLoginFailure(key: string) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now()) {
    attempts.set(key, { count: 1, resetAt: now() + 15 * 60_000 });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
