import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess } from "../core/auth.js";
import { parse } from "../core/http.js";

export const auditModule: CoreModule = {
  id: "core.audit",
  name: "Family history",
  description: "Remembers what happened — who did what, and when.",
  register({ app, db }) {
    app.get("/api/audit", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const query = parse(
        z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
          entityType: z.string().optional(),
          q: z.string().max(100).optional(),
        }),
        req.query,
        reply,
      );
      if (!query) return;
      const where = ["household_id = ?"];
      const params: unknown[] = [access.householdId];
      if (query.entityType) {
        where.push("entity_type = ?");
        params.push(query.entityType);
      }
      if (query.q) {
        where.push("summary LIKE ?");
        params.push(`%${query.q}%`);
      }
      const rows = db
        .prepare(
          `SELECT id, actor_member_id AS actorId, actor_name AS actorName, entity_type AS entityType,
                  entity_id AS entityId, action, summary, created_at AS createdAt
           FROM audit_log WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...params, query.limit);
      return { entries: rows };
    });
  },
};
