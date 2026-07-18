# Server core

Everything in `apps/server/src/core/` — the substrate every feature module
stands on.

## Database (`core/db.ts`)

- better-sqlite3, WAL mode, `busy_timeout 5000`, foreign keys ON.
- Migrations: sequential `if (version < N)` blocks against
  `PRAGMA user_version`. **Current version: 8.**
  - v1 base schema (households, members, sessions, device_tokens, events,
    event_exceptions, event_assignees, tasks, task_completions, checklists,
    checklist_items, reminders, reminder_fires, push_subscriptions,
    audit_log, plugin_settings)
  - v2 display links (retrievable token + config_json), sessions.device_token_id,
    checklists.need_by, checklist_items.store, api_tokens
  - v3 members rebuild: `pattern` credential type, grants_json, session
    elevation columns
  - v4 checklists.linked_event_id
  - v5 federation: peers, peer_shares, federated_lists
  - v6 tasks.steps_json
  - v7 step_checks (per-occurrence step progress)
  - v8 members.ui_level (`little` | `teen` | NULL)
  - v9 points: step_checks.checked_by, points_ledger, point_goals
- Soft deletes (`deleted_at`) on events/tasks/checklists/members so history
  can still reference them.
- `uid()` = randomUUID, `now()` = Date.now (UTC ms everywhere).

## Auth & permissions (`core/auth.ts` + `shared/permissions.ts`)

Three principal kinds, one guard:

- **member** — session cookie (`coord_session`, httpOnly). Parents:
  password (scrypt). Kids: 4-digit PIN or picture pattern (`pat:0403` over
  the fixed 3×3 animal grid in `PATTERN_ANIMALS`). Login rate-limited
  (10 tries / 15 min per key).
- **device** — a display. Created from a `device_token` (retrievable,
  shareable link `/dashboard?device=<token>`); its session ~never expires.
  Read-only by default; **elevation** = someone taps their avatar on the
  display and verifies → the session acts as that member for
  `ELEVATION_MS` (60s). 403 with `{code:"elevate"}` tells the UI to open
  the who-are-you modal. Displays with `requireAuthToChange:false` get a
  small anonymous allowlist (`task.complete`, `checklist.check`).
- **agent** — `Authorization: Bearer <api_token>`. Full parent-level
  authority, attributed by token label in the audit log.

`can(role, action, grants)`: parents → everything; kids →
`task.complete/reassign`, `checklist.check` + whatever grants a parent gave
(`event.manage`, `task.manage`, `checklist.manage`); `settings.manage`,
`member.manage` are parent-only. Keep new actions in the `Action` union.

`requireActor(db, req, reply, action)` returns
`Access { kind, memberId, householdId, name, role }` or replies 401/403
itself. Audit writes take `actorOf(access)`.

## Event bus (`core/bus.ts`, types in plugin-sdk)

Typed emitter: `event.created/updated/deleted`, `task.created/completed/
reassigned`, `checklist.item.checked`, `member.updated`, `reminder.fired`.
Handlers are isolated (a throwing handler logs, never crashes the emitter).
The plugin host bridges bus events → WS `invalidate` broadcasts.

## WS protocol (`shared/ws-protocol.ts`, `core/ws.ts`)

Notify-only. `QueryKeyPattern` = `events | tasks | checklists | members |
federation | points | dashboard | audit | me`. Client invalidates
`queryKey: [key]` on receipt. Socket auth = session cookie at upgrade.
When adding a feature with its own query key, add it to the union — the
type keeps server and client honest.

## Scheduler (`core/scheduler.ts`)

`scheduler.every(name, seconds, fn)` — coarse in-process intervals. Used by
reminders (60s), federation sync (15s), federation offer collection (10s).
No persistence; idempotency comes from ledgers (e.g. `reminder_fires`).

## Settings (`core/settings.ts`)

`settingsFor(db, pluginId)` → namespaced JSON KV over `plugin_settings`.
Used for plugin enable flags (`core.plugin-host.enabled.<id>`), federation
keys/relay config, Immich credentials.

## HTTP helper (`core/http.ts`)

`parse(schema, data, reply)` → validated value or `null` after replying 400
with a friendly message. Every handler uses it; don't hand-roll validation.

## Crypto (`core/fedcrypto.ts`)

x25519 keypair (persisted via settings) → ECDH → HKDF-SHA256 →
AES-256-GCM. `seal/open` produce/consume base64 `iv‖tag‖ciphertext`.
`pairingCode()` = WORD-NN (speakable), `mailboxId()` = 24 random hex.

## App assembly (`app.ts`)

`buildApp({ dbPath, webDist?, logger? })` → `{ app, db }`. Registers
cookie/websocket plugins, error handler (statusCode-aware), health, WS
route, all modules via `registerModules`, `/api/plugins` toggles, then
static PWA serving with SPA fallback. `trustProxy: true` — required for
correct `req.protocol` behind Nginx Proxy Manager (federation reply URLs).
Tests call `buildApp` with `:memory:` and use `app.inject`.
`GET /api/backup` (core.backup module) streams `db.serialize()` — the
whole household as one file — to parents/agents; see the README's
three-tier section for the NAS/cron backup patterns.
