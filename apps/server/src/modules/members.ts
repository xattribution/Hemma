import { memberInputSchema, PATTERN_REGEX, type CredentialType, type Role } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { hashCredential, requireAccess, requireActor, toMember, type MemberRow } from "../core/auth.js";
import { parse } from "../core/http.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";

const memberPatchSchema = memberInputSchema.partial();

/** Kids use a 4-digit PIN or a picture pattern; parents use a password. */
function credentialError(role: Role, type: CredentialType, credential: string): string | null {
  if (role === "parent") {
    return type === "password" && credential.length >= 6 ? null : "Parents sign in with a password (6+ characters)";
  }
  if (type === "pin") return /^\d{4}$/.test(credential) ? null : "PINs are 4 digits";
  if (type === "pattern") return PATTERN_REGEX.test(credential) ? null : "Patterns are 4 taps on the picture grid";
  return "Kids sign in with a PIN or a picture pattern";
}

function resolveCredentialType(role: Role, requested: CredentialType | undefined): CredentialType {
  if (role === "parent") return "password";
  return requested === "pattern" ? "pattern" : "pin";
}

export const membersModule: CoreModule = {
  id: "core.members",
  name: "Family members",
  description: "Who's in the family — names, colors, avatars, roles.",
  register({ app, db, bus }) {
    app.get("/api/members", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const rows = db
        .prepare("SELECT * FROM members WHERE deleted_at IS NULL ORDER BY sort_order, created_at")
        .all() as MemberRow[];
      return { members: rows.map(toMember) };
    });

    app.post("/api/members", (req, reply) => {
      const actor = requireActor(db, req, reply, "member.manage");
      if (!actor) return;
      const input = parse(memberInputSchema, req.body, reply);
      if (!input) return;
      const credentialType = resolveCredentialType(input.role, input.credentialType);
      const problem = credentialError(input.role, credentialType, input.credential);
      if (problem) {
        reply.code(400).send({ error: problem });
        return;
      }
      const id = uid();
      const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM members").get() as { m: number }).m;
      db.prepare(
        `INSERT INTO members (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, grants_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, actor.householdId, input.name, input.role, input.color, input.avatar,
        hashCredential(input.credential), credentialType,
        maxOrder + 1, input.grants ? JSON.stringify(input.grants) : null, now(),
      );
      recordAudit(db, actor.householdId, actor, "member", id, "create",
        `${actor.name} added ${input.name} to the family`);
      bus.emit("member.updated", { memberId: id, actor: actor });
      reply.code(201);
      return { id };
    });

    app.patch("/api/members/:id", (req, reply) => {
      const actor = requireActor(db, req, reply, "member.manage");
      if (!actor) return;
      const patch = parse(memberPatchSchema, req.body, reply);
      if (!patch) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL").get(id) as MemberRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "Member not found" });
        return;
      }
      db.prepare("UPDATE members SET name = ?, role = ?, color = ?, avatar = ?, grants_json = ? WHERE id = ?").run(
        patch.name ?? row.name, patch.role ?? row.role, patch.color ?? row.color, patch.avatar ?? row.avatar,
        patch.grants !== undefined ? JSON.stringify(patch.grants) : row.grants_json, id,
      );
      if (patch.credential) {
        const role = patch.role ?? row.role;
        const credentialType = resolveCredentialType(role, patch.credentialType ?? (row.credential_type === "password" ? undefined : row.credential_type));
        const problem = credentialError(role, credentialType, patch.credential);
        if (problem) {
          reply.code(400).send({ error: problem });
          return;
        }
        db.prepare("UPDATE members SET credential_hash = ?, credential_type = ? WHERE id = ?").run(
          hashCredential(patch.credential), credentialType, id,
        );
      }
      recordAudit(db, actor.householdId, actor, "member", id, "update",
        `${actor.name} updated ${patch.name ?? row.name}`);
      bus.emit("member.updated", { memberId: id, actor: actor });
      return { ok: true };
    });

    app.delete("/api/members/:id", (req, reply) => {
      const actor = requireActor(db, req, reply, "member.manage");
      if (!actor) return;
      const { id } = req.params as { id: string };
      if (id === actor.memberId) {
        reply.code(400).send({ error: "You can't remove yourself" });
        return;
      }
      const row = db.prepare("SELECT name FROM members WHERE id = ? AND deleted_at IS NULL").get(id) as { name: string } | undefined;
      if (!row) {
        reply.code(404).send({ error: "Member not found" });
        return;
      }
      db.prepare("UPDATE members SET deleted_at = ? WHERE id = ?").run(now(), id);
      db.prepare("DELETE FROM sessions WHERE member_id = ?").run(id);
      recordAudit(db, actor.householdId, actor, "member", id, "delete",
        `${actor.name} removed ${row.name} from the family`);
      bus.emit("member.updated", { memberId: id, actor: actor });
      return { ok: true };
    });
  },
};
