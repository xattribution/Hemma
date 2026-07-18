import crypto from "node:crypto";
import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { parse } from "../core/http.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";
import { AI_INSTRUCTIONS } from "./ai-instructions.js";

/**
 * The machine side of Sett: bearer API tokens for AI/automation clients
 * (the MCP server, scripts, HAL…), a cross-entity search endpoint, and a
 * structured instructions document LLMs can be pointed at.
 */
export const integrationsModule: CoreModule = {
  id: "core.integrations",
  name: "AI & API access",
  description: "API tokens, search, and LLM-readable instructions for connected assistants.",
  register({ app, db }) {
    // ---- API tokens (parent-managed, retrievable — home-server trust model) ----

    app.post("/api/tokens", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(z.object({ label: z.string().trim().min(1).max(60) }), req.body, reply);
      if (!body) return;
      const id = uid();
      const token = `coord_${crypto.randomBytes(24).toString("base64url")}`;
      db.prepare("INSERT INTO api_tokens (id, token, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, token, body.label, access.memberId, now(),
      );
      recordAudit(db, access.householdId, { memberId: access.memberId, name: access.name }, "token", id, "create",
        `${access.name} connected "${body.label}" to the API`);
      reply.code(201);
      return { id, token };
    });

    app.get("/api/tokens", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const rows = db
        .prepare("SELECT id, token, label, created_at AS createdAt FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at")
        .all();
      return { tokens: rows };
    });

    app.delete("/api/tokens/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(now(), id);
      return { ok: true };
    });

    // ---- Search: one query across events, tasks, lists and history ----

    app.get("/api/search", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const query = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query, reply);
      if (!query) return;
      const like = `%${query.q}%`;
      const hh = access.householdId;
      // Private items surface only for their creator, parents and agents.
      const privileged = access.kind === "agent" || access.role === "parent" ? 1 : 0;
      const seePrivate = "(visibility != 'private' OR ? = 1 OR created_by = ?)";
      const me = access.memberId ?? "";
      return {
        events: db.prepare(
          `SELECT id, title, location, category, start_at AS startAt, end_at AS endAt, rrule
           FROM events WHERE household_id = ? AND deleted_at IS NULL AND (title LIKE ? OR description LIKE ? OR location LIKE ?)
           AND ${seePrivate}
           ORDER BY start_at DESC LIMIT 25`,
        ).all(hh, like, like, like, privileged, me),
        tasks: db.prepare(
          `SELECT id, title, kind, assignee_id AS assigneeId, repeat, due_at AS dueAt
           FROM tasks WHERE household_id = ? AND deleted_at IS NULL AND title LIKE ? AND ${seePrivate} LIMIT 25`,
        ).all(hh, like, privileged, me),
        checklistItems: db.prepare(
          `SELECT i.id, i.text, i.quantity, i.store, i.checked, c.id AS checklistId, c.title AS checklistTitle
           FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id
           WHERE c.household_id = ? AND c.deleted_at IS NULL AND (i.text LIKE ? OR i.store LIKE ?) LIMIT 50`,
        ).all(hh, like, like),
        history: db.prepare(
          `SELECT id, actor_name AS actorName, entity_type AS entityType, action, summary, created_at AS createdAt
           FROM audit_log WHERE household_id = ? AND summary LIKE ? ORDER BY created_at DESC LIMIT 25`,
        ).all(hh, like),
      };
    });

    // ---- LLM-readable API instructions (also at the conventional llms.txt) ----
    const serveDocs = (_req: unknown, reply: { type: (t: string) => { send: (s: string) => void } }) => {
      reply.type("text/markdown; charset=utf-8").send(AI_INSTRUCTIONS);
    };
    app.get("/api/llms.txt", serveDocs);
    app.get("/llms.txt", serveDocs);
  },
};
