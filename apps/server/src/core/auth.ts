import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Member, Role } from "@coord/shared";
import { can, type Action } from "@coord/shared";
import type { Db } from "./db.js";
import { now, uid } from "./db.js";
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

// ---------- Sessions ----------

export type SessionInfo =
  | { kind: "member"; member: MemberRow }
  | { kind: "device"; label: string };

export interface MemberRow {
  id: string;
  household_id: string;
  name: string;
  role: Role;
  color: string;
  avatar: string;
  sort_order: number;
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

export function createSession(db: Db, memberId: string | null, kind: "member" | "device", label = ""): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = now() + config.sessionDays * 24 * 3600_000;
  db.prepare(
    "INSERT INTO sessions (token_hash, member_id, kind, label, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(sha256(token), memberId, kind, label, now(), expires, now());
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
    | { member_id: string | null; kind: "member" | "device"; label: string }
    | undefined;
  if (!session) return null;
  if (session.kind === "device") return { kind: "device", label: session.label || "Display" };
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

// ---------- Request guards ----------

export function sessionOf(db: Db, req: FastifyRequest): SessionInfo | null {
  return lookupSession(db, req.cookies[SESSION_COOKIE]);
}

/** Any logged-in family member (not a device). */
export function requireMember(db: Db, req: FastifyRequest, reply: FastifyReply): MemberRow | null {
  const session = sessionOf(db, req);
  if (session?.kind !== "member") {
    reply.code(401).send({ error: "Please sign in" });
    return null;
  }
  return session.member;
}

/** Member or kiosk device — read access + the few device-allowed actions. */
export function requireSession(db: Db, req: FastifyRequest, reply: FastifyReply): SessionInfo | null {
  const session = sessionOf(db, req);
  if (!session) {
    reply.code(401).send({ error: "Please sign in" });
    return null;
  }
  return session;
}

export function requireCan(db: Db, req: FastifyRequest, reply: FastifyReply, action: Action): MemberRow | null {
  const member = requireMember(db, req, reply);
  if (!member) return null;
  if (!can(member.role, action)) {
    reply.code(403).send({ error: "Ask a parent to do that" });
    return null;
  }
  return member;
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
