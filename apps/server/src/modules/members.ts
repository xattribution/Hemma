import { z } from "zod";
import { memberInputSchema } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { hashCredential, requireAccess, requireActor, toMember, type MemberRow } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { parse } from "../core/http.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";

const memberPatchSchema = memberInputSchema.partial();

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
      if (input.role === "child" && !/^\d{4}$/.test(input.credential)) {
        reply.code(400).send({ error: "Kids sign in with a 4-digit PIN" });
        return;
      }
      const id = uid();
      const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM members").get() as { m: number }).m;
      db.prepare(
        `INSERT INTO members (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, actor.householdId, input.name, input.role, input.color, input.avatar,
        hashCredential(input.credential), input.role === "child" ? "pin" : "password",
        maxOrder + 1, now(),
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
      db.prepare("UPDATE members SET name = ?, role = ?, color = ?, avatar = ? WHERE id = ?").run(
        patch.name ?? row.name, patch.role ?? row.role, patch.color ?? row.color, patch.avatar ?? row.avatar, id,
      );
      if (patch.credential) {
        db.prepare("UPDATE members SET credential_hash = ?, credential_type = ? WHERE id = ?").run(
          hashCredential(patch.credential), (patch.role ?? row.role) === "child" ? "pin" : "password", id,
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
