import { checklistInputSchema, checklistItemInputSchema, STORE_COLORS, type Checklist, type StoreTag } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
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
  need_by: number | null;
  linked_event_id: string | null;
  linked_event_title: string | null;
}

export function loadChecklists(db: Db, householdId: string, onlyPinned = false): Checklist[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.icon, c.kind, c.pinned_to_dashboard, c.need_by, c.linked_event_id,
              e.title AS linked_event_title
       FROM checklists c LEFT JOIN events e ON e.id = c.linked_event_id AND e.deleted_at IS NULL
       WHERE c.household_id = ? AND c.deleted_at IS NULL ${onlyPinned ? "AND c.pinned_to_dashboard = 1" : ""}
       ORDER BY c.sort_order, c.created_at`,
    )
    .all(householdId) as ChecklistRow[];
  // Stable order — checked items keep their place (a strikethrough, not a
  // jump to the bottom, which read as "it unchecked itself").
  const itemsStmt = db.prepare(
    "SELECT id, text, checked, checked_by, quantity, store, sort_order FROM checklist_items WHERE checklist_id = ? ORDER BY sort_order, created_at",
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    pinnedToDashboard: !!row.pinned_to_dashboard,
    needBy: row.need_by,
    linkedEventId: row.linked_event_id,
    linkedEventTitle: row.linked_event_title,
    items: (itemsStmt.all(row.id) as {
      id: string; text: string; checked: number; checked_by: string | null;
      quantity: string | null; store: string | null; sort_order: number;
    }[]).map((i) => ({
      id: i.id,
      text: i.text,
      checked: !!i.checked,
      checkedBy: i.checked_by,
      quantity: i.quantity,
      store: i.store,
      sortOrder: i.sort_order,
    })),
  }));
}

export const checklistsModule: CoreModule = {
  id: "core.checklists",
  name: "Lists",
  description: "Shopping lists, packing lists and checklists the whole family shares.",
  register({ app, db, bus, broadcast, settings }) {
    const invalidateLists = () => broadcast({ type: "invalidate", keys: ["checklists", "dashboard"] });

    // ---- Store quick-tags: auto-registered on first use, stable colors ----
    const registerStore = (name: string | null | undefined) => {
      if (!name) return;
      const stores = settings.get<StoreTag[]>("stores", []);
      if (stores.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
      const hash = [...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      // Prefer an unused color; fall back to the hash pick when all are taken.
      const used = new Set(stores.map((s) => s.color));
      const color = STORE_COLORS.find((c) => !used.has(c)) ?? STORE_COLORS[hash % STORE_COLORS.length]!;
      settings.set("stores", [...stores, { name, color }]);
      invalidateLists();
    };

    app.get("/api/stores", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      // Self-heal: pick up stores already used on items (pre-registry data).
      const known = new Set(settings.get<StoreTag[]>("stores", []).map((s) => s.name.toLowerCase()));
      const used = db
        .prepare("SELECT DISTINCT store FROM checklist_items WHERE store IS NOT NULL AND store != ''")
        .all() as { store: string }[];
      for (const { store } of used) {
        if (!known.has(store.toLowerCase())) registerStore(store);
      }
      return { stores: settings.get<StoreTag[]>("stores", []) };
    });

    app.delete("/api/stores/:name", (req, reply) => {
      if (!requireActor(db, req, reply, "checklist.manage")) return;
      const { name } = req.params as { name: string };
      const stores = settings.get<StoreTag[]>("stores", []);
      settings.set("stores", stores.filter((s) => s.name.toLowerCase() !== name.toLowerCase()));
      invalidateLists();
      return { ok: true };
    });

    app.get("/api/checklists", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const household = getHousehold(db)!;
      return { checklists: loadChecklists(db, household.id) };
    });

    app.post("/api/checklists", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.manage");
      if (!access) return;
      const input = parse(checklistInputSchema, req.body, reply);
      if (!input) return;
      const id = uid();
      db.prepare(
        "INSERT INTO checklists (id, household_id, title, icon, kind, pinned_to_dashboard, need_by, linked_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, access.householdId, input.title, input.icon, input.kind, input.pinnedToDashboard ? 1 : 0, input.needBy, input.linkedEventId, now());
      recordAudit(db, access.householdId, actorOf(access), "checklist", id, "create",
        `${access.name} started the "${input.title}" list`);
      invalidateLists();
      reply.code(201);
      return { id };
    });

    app.patch("/api/checklists/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.manage");
      if (!access) return;
      const patch = parse(checklistInputSchema.partial(), req.body, reply);
      if (!patch) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT * FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as ChecklistRow | undefined;
      if (!row) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      db.prepare("UPDATE checklists SET title = ?, icon = ?, kind = ?, pinned_to_dashboard = ?, need_by = ?, linked_event_id = ? WHERE id = ?").run(
        patch.title ?? row.title,
        patch.icon ?? row.icon,
        patch.kind ?? row.kind,
        (patch.pinnedToDashboard ?? !!row.pinned_to_dashboard) ? 1 : 0,
        patch.needBy !== undefined ? patch.needBy : row.need_by,
        patch.linkedEventId !== undefined ? patch.linkedEventId : row.linked_event_id,
        id,
      );
      invalidateLists();
      return { ok: true };
    });

    app.delete("/api/checklists/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.manage");
      if (!access) return;
      const { id } = req.params as { id: string };
      const row = db.prepare("SELECT title FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as { title: string } | undefined;
      if (!row) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      db.prepare("UPDATE checklists SET deleted_at = ? WHERE id = ?").run(now(), id);
      recordAudit(db, access.householdId, actorOf(access), "checklist", id, "delete",
        `${access.name} removed the "${row.title}" list`);
      invalidateLists();
      return { ok: true };
    });

    // Everyone — kids, displays and connected AIs — can add and check items.
    app.post("/api/checklists/:id/items", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      const input = parse(checklistItemInputSchema, req.body, reply);
      if (!input) return;
      const { id } = req.params as { id: string };
      const list = db.prepare("SELECT title FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as { title: string } | undefined;
      if (!list) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      const itemId = uid();
      const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_items WHERE checklist_id = ?").get(id) as { m: number }).m;
      db.prepare(
        "INSERT INTO checklist_items (id, checklist_id, text, quantity, store, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(itemId, id, input.text, input.quantity, input.store, maxOrder + 1, now());
      registerStore(input.store);
      if (input.alsoGrocery) {
        // Meal planning: mirror the ingredient onto the default grocery list
        // (first pinned shopping list, else any shopping list).
        const grocery = db.prepare(
          `SELECT id FROM checklists WHERE household_id = ? AND deleted_at IS NULL AND kind = 'shopping' AND id != ?
           ORDER BY pinned_to_dashboard DESC, created_at LIMIT 1`,
        ).get(access.householdId, id) as { id: string } | undefined;
        if (grocery) {
          const gOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_items WHERE checklist_id = ?").get(grocery.id) as { m: number }).m;
          db.prepare(
            "INSERT INTO checklist_items (id, checklist_id, text, quantity, store, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(uid(), grocery.id, input.text, input.quantity, input.store, gOrder + 1, now());
        }
      }
      recordAudit(db, access.householdId, actorOf(access), "checklist", id, "create",
        `${access.name} added "${input.text}"${input.store ? ` (${input.store})` : ""} to ${list.title}`);
      invalidateLists();
      reply.code(201);
      return { id: itemId };
    });

    // Edit an item — change text, quantity, or which store it's from.
    app.patch("/api/checklists/:id/items/:itemId", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      const patch = parse(checklistItemInputSchema.partial(), req.body, reply);
      if (!patch) return;
      const { id, itemId } = req.params as { id: string; itemId: string };
      const item = db
        .prepare("SELECT text, quantity, store FROM checklist_items WHERE id = ? AND checklist_id = ?")
        .get(itemId, id) as { text: string; quantity: string | null; store: string | null } | undefined;
      if (!item) {
        reply.code(404).send({ error: "Item not found" });
        return;
      }
      db.prepare("UPDATE checklist_items SET text = ?, quantity = ?, store = ? WHERE id = ?").run(
        patch.text ?? item.text,
        patch.quantity !== undefined ? patch.quantity : item.quantity,
        patch.store !== undefined ? patch.store : item.store,
        itemId,
      );
      if (patch.store) registerStore(patch.store);
      invalidateLists();
      return { ok: true };
    });

    app.delete("/api/checklists/:id/items/:itemId", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      if (access.kind === "device") {
        reply.code(403).send({ error: "This display can't do that" });
        return;
      }
      const { id, itemId } = req.params as { id: string; itemId: string };
      db.prepare("DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?").run(itemId, id);
      invalidateLists();
      return { ok: true };
    });

    // Running lists (groceries): sweep away everything already bought.
    app.post("/api/checklists/:id/clear-checked", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      if (access.kind === "device") {
        reply.code(403).send({ error: "This display can't do that" });
        return;
      }
      const { id } = req.params as { id: string };
      const list = db.prepare("SELECT title FROM checklists WHERE id = ? AND deleted_at IS NULL").get(id) as { title: string } | undefined;
      if (!list) {
        reply.code(404).send({ error: "List not found" });
        return;
      }
      const removed = db.prepare("DELETE FROM checklist_items WHERE checklist_id = ? AND checked = 1").run(id).changes;
      if (removed > 0) {
        recordAudit(db, access.householdId, actorOf(access), "checklist", id, "update",
          `${access.name} cleared ${removed} done item${removed === 1 ? "" : "s"} off ${list.title}`);
      }
      invalidateLists();
      return { removed };
    });

    app.post("/api/checklists/:id/items/:itemId/toggle", (req, reply) => {
      const access = requireActor(db, req, reply, "checklist.check");
      if (!access) return;
      const { id, itemId } = req.params as { id: string; itemId: string };
      const item = db
        .prepare("SELECT text, checked FROM checklist_items WHERE id = ? AND checklist_id = ?")
        .get(itemId, id) as { text: string; checked: number } | undefined;
      if (!item) {
        reply.code(404).send({ error: "Item not found" });
        return;
      }
      const actor = actorOf(access);
      const nowChecked = item.checked ? 0 : 1;
      db.prepare("UPDATE checklist_items SET checked = ?, checked_by = ?, checked_at = ? WHERE id = ?").run(
        nowChecked, nowChecked ? actor.memberId : null, nowChecked ? now() : null, itemId,
      );
      if (nowChecked) {
        recordAudit(db, access.householdId, actor, "checklist", id, "check", `${actor.name} got "${item.text}"`);
      }
      bus.emit("checklist.item.checked", { checklistId: id, itemId, text: item.text, checked: !!nowChecked, actor });
      return { checked: !!nowChecked };
    });
  },
};
