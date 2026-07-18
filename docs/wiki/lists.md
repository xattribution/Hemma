# Lists

**Module:** `apps/server/src/modules/checklists.ts` (exports `loadChecklists`)
**UI:** `apps/web/src/features/lists/ListsPage.tsx` (+ StoreChip export),
dashboard pinned-list cards, KidApp Lists tab.

## Kinds & lifecycle

`kind`: `shopping` | `checklist` | `packing` | `meal`.
Three lifecycle flavors (orthogonal to kind):
- **running** — no dates (groceries): add, check, then
  `POST /:id/clear-checked` sweeps checked items after the run
- **dated** — `needBy` (UTC ms): surfaces in that day's summary/DayModal
- **event-linked** — `linkedEventId`: rides along with the event's days;
  server resolves `linkedEventTitle` for display

## Items

`text`, `quantity` (free text, shown as ×2 gal), `store` (tag), `checked`,
`checkedBy`, stable `sort_order` (**always ORDER BY sort_order** — an
earlier bug re-sorted checked items to the bottom which made a just-tapped
row "uncheck itself" when the refetch landed).

Structured add UI: item / qty / store fields (the user explicitly rejected
`x2`/`@store` inline syntax). Store quick-tags are colored chips.

## Store registry

`GET /api/stores` → `[{name, color}]` from settings, **self-healing**: it
scans distinct item stores and registers any missing ones (covers seeded
data). Colors assigned deterministically from `STORE_COLORS` on first use.
`DELETE /api/stores/:name` removes a quick-tag.

## Meal plans

`kind: "meal"` lists are meal plans. Adding an item with
`alsoGrocery: true` mirrors it onto the **first pinned shopping list**
(the "default grocery list"). Mirroring is per-item and optional.

## Sharing (see federation.md for the pipe)

Per-list, explicit, revocable. Lists shared *with* us are merged into the
Lists page read-mostly (toggle items only) from `GET /api/federation/shared`.
Local share sheet: share-sheet/clipboard/email/QR export of a list's text.

## Permissions

`checklist.check` (toggle) — everyone incl. kids/displays;
`checklist.manage` (create/edit/delete/clear) — parents or granted kids.

## Pending / gaps

- Remote families can only *toggle* items on lists shared with them — they
  cannot add/edit/remove items (owner-side is source of truth; extending
  `list.op` with add/remove ops is the natural next step).
- No per-item assignee ("who's buying this") — store tags cover the
  deconfliction use-case for now.
