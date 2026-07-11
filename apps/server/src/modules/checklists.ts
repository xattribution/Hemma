import { z } from "zod";
import { checklistInputSchema, deviceCan, type Checklist } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { requireCan, requireSession } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { parse } from "../core/http.js";
import type { Db } from "../core/db.js";
import { now, uid } from "../core/db.js";
import { recordAudit } from "../core/audit.js";
import { getHousehold } from "../core/household.js";

interface ChecklistRow {
  id: string;
  title: string;
  icon: string;
  kind: "shopping" | "checklist" | "packing";
  pinned_to_dashboard: number;
}

export function loadChecklists(db: Db, householdId: string, onlyPinned = false): Checklist[] {
  const rows = db
    .prepare(
      `SELECT id, title, icon, kind, pinned_to_dashboard FROM checklists
       WHERE household_id = ? AND deleted_at IS NULL ${onlyPinned ? "AND pinned_to_dashboard = 1" : ""}
       ORDER BY sort_order, created_at`,
    )
    .all(householdId) as ChecklistRow[];
  const itemsStmt = db.prepare(
    "SELECT id, text, checked, checked_by, quantity, sort_order FROM checklist_items WHERE checklist_id = ? ORDER BY checked, sort_order, created_at",
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    pinnedToDashboard: !!row.pinned_to_dashboard,
    items: (itemsStmt.all(row.id) as { id: string; text: string; checked: number; checked_by: string | null; quantity: string | null; sort_order: number }[]).map(
      (i) => ({
        id: i.id,
        text: i.text,
        checked: !!i.checked,
        checkedBy: i.checked_by,
        quantity: i.quantity,
        sortOrder: i.sort_order,
      }),
    ),
  }));
}

const itemInputSchema = z.object({
  text: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(40).nullable().default(null),
});

export const checklistsModule: CoreModule = {
  id: "core.checklists",
  name: "Lists",
  description: "Shopping lists, packing lists and checklists the whole family shares.",
  register({ app, db, bus, broadcast }) {
    const invalidateLists = () => broadcast({ type: "invalidate", keys: ["checklists", "dashboard"] });

    app.get("/api/checklists", (req, reply) => {
      if (!requireSession(db, req, reply)) return;
      const household = getHousehold(db)!;
      return { checklists: loadChecklists(db, household.id) };
    });

    app.post("/api/checklists", (req, reply) => {
      const member = requireCan(db, req, reply, "checklist.manage");
      if (!member) return;
      const input = parse(checklistInputSchema, req.body, reply);
      if (!input) return;
      const id = uid();
      db.prepare(
        "INSERT INTO checklists (id, household_id, title, icon, kind, pinned_to_dashboard, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, member.household_id, input.title, input.icon, input.kind, input.pinnedToDashboard ? 1 : 0, now());
      recordAudit(db, member.household_id, actorOf(member), "checklist", id, "create", `${member.name} started the "${input.title}" list`);
      invalidateLists();
      reply.code(201);
      return { id };
    });

    app.patch("/api/checklists/:id", (req, reply) => {
      const member = requireCan(db, req, reply, "checklist.manage");
      if (!member) return;
      const patch = parse(checklistInputSchema.partial(), req.body, reply);
      if (!patch) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as ChecklistRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      db.prepare("UPDATE checklists SET title = ?, icon = ?, kind = ?, pinned_to_dashboard = ? WHERE id = ?").run(
        patch.title ?? row.title,
        patch.icon ?? row.icon,
        patch.kind ?? row.kind,
        (patch.pinnedToDashboard ?? !!row.pinned_to_dashboard) ? 1 : 0,
        id,
      );
      invalidateLists();
      return { ok: true };
    });

    app.delete("/api/checklists/:id", (req, reply) => {
      const member = requireCan(db, req, reply, "checklist.manage");
      if (!member) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT title FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as { title: string } | undefined;
      if (!row) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      db.prepare("UPDATE checklists SET deleted_at = ? WHERE id = ?").run(now(), id);
      recordAudit(db, member.household_id, actorOf(member), "checklist", id, "delete", `${member.name} removed the "${row.title}" list`);
      invalidateLists();
      return { ok: true };
    });

    // Everyone — kids and the kitchen display included — can add and check items.
    app.post("/api/checklists/:id/items", (req, reply) => {
      const session = requireSession(db, req, reply);
      if (!session) return;
      if (session.kind === "device" && !deviceCan("checklist.check")) {
        reply.code(403).send({ error: "This display can't do that" });
        return;
      }
      const input = parse(itemInputSchema, req.body, reply);
      if (!input) return;
      const { id } = req.params as { id: string };
      const list = db.prepare("SELECT id FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id);
      if (!list) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      const itemId = uid();
      const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_items WHERE checklist_id = ?").get(id) as { m: number }).m;
      db.prepare(
        "INSERT INTO checklist_items (id, checklist_id, text, quantity, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(itemId, id, input.text, input.quantity, maxOrder + 1, now());
      invalidateLists();
      reply.code(201);
      return { id: itemId };
    });

    app.delete("/api/checklists/:id/items/:itemId", (req, reply) => {
      const session = requireSession(db, req, reply);
      if (!session || session.kind === "device") {
        if (session) reply.code(403).send({ error: "This display can't do that" });
        return;
      }
      const { id, itemId } = req.params as { id: string; itemId: string };
      db.prepare("DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?").run(itemId, id);
      invalidateLists();
      return { ok: true };
    });

    app.post("/api/checklists/:id/items/:itemId/toggle", (req, reply) => {
      const session = requireSession(db, req, reply);
      if (!session) return;
      if (session.kind === "device" && !deviceCan("checklist.check")) {
        reply.code(403).send({ error: "This display can't do that" });
        return;
      }
      const { id, itemId } = req.params as { id: string; itemId: string };
      const item = db
        .prepare("SELECT text, checked FROM checklist_items WHERE id = ? AND checklist_id = ?")
        .get(itemId, id) as { text: string; checked: number } | undefined;
      if (!item) {
        reply.code(404).send({ error: "Item not found" });
        return;
      }
      const actor = actorOf(session);
      const nowChecked = item.checked ? 0 : 1;
      db.prepare("UPDATE checklist_items SET checked = ?, checked_by = ?, checked_at = ? WHERE id = ?").run(
        nowChecked, nowChecked ? actor.memberId : null, nowChecked ? now() : null, itemId,
      );
      const household = getHousehold(db)!;
      if (nowChecked) {
        recordAudit(db, household.id, actor, "checklist", id, "check", `${actor.name} got "${item.text}"`);
      }
      bus.emit("checklist.item.checked", { checklistId: id, itemId, text: item.text, checked: !!nowChecked, actor });
      return { checked: !!nowChecked };
    });
  },
};
