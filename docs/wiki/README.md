# Hemma wiki — the full context handoff

**Product name: Hemma** (Swedish: "at home"). Repo + internal identifiers
stay `coord` deliberately (sessions, storage keys, package names, env vars
— renaming breaks live deployments). Brand only user-visible surfaces.

This wiki exists so that a **new engineer or AI agent can pick up the project
with zero prior conversation**. It documents what each module does, what it
depends on, which UI surfaces it needs, and what is deliberately unfinished.
(The agent-facing runtime contract is separate: `/llms.txt`, served by the
app itself — that one is for AIs *driving* a live Coord, this wiki is for
anyone *building* Coord.)

## What Hemma is

A self-hosted family coordination hub: classic calendar, kids' chores with
checkable steps, shared shopping/packing/meal lists, always-on wall displays,
reminders, per-person themes, and end-to-end-encrypted sharing with other
families ("federation"). One household per instance; everything lives in one
SQLite file on the family's own box. AI/automation is first-class via bearer
tokens + an MCP server.

## Repo map

| Path | What | Wiki page |
| --- | --- | --- |
| `apps/server` | Fastify 5 API + WS + scheduler; serves the built PWA | [server-core](server-core.md) |
| `apps/server/src/modules/*` | Feature modules (all use the plugin interface) | per-feature pages below |
| `apps/server/src/plugins/*` | Optional (toggleable) plugins: daily-quote, immich | [immich](immich.md) |
| `apps/web` | React 19 + Vite PWA (Tailwind 4, TanStack Query) | [frontend](frontend.md) |
| `apps/relay` | Zero-knowledge federation relay (zero-dep Node) | [federation](federation.md) |
| `apps/mcp` | MCP server wrapping the REST API (~28 tools) | [ai-access](ai-access.md) |
| `apps/shell` | Tauri 2 native shell (exe/deb/AppImage/dmg/apk) | [apps-shell](apps-shell.md) |
| `packages/shared` | Zod schemas — THE source of truth for types both sides | [server-core](server-core.md) |
| `packages/plugin-sdk` | Stable plugin surface (bus, context, slots) | [server-core](server-core.md) |
| `deploy/relay` | Relay docker-compose | [federation](federation.md) |
| `e2e/` | Playwright golden flows | [frontend](frontend.md) |

## Feature pages

- [server-core.md](server-core.md) — DB & migrations, auth/permission model, bus/scheduler/settings, WS protocol
- [calendar.md](calendar.md) — events, recurrence, exceptions, day summaries
- [chores.md](chores.md) — tasks, steps, points, completion semantics, swapping
- [lists.md](lists.md) — list kinds, store tags, meal plans, clear/share
- [points.md](points.md) — the ledger, goals, family-chore awards
- [members-kids.md](members-kids.md) — roles, credentials (password/PIN/pattern), grants, kid UI tiers
- [displays.md](displays.md) — device tokens, elevation, layouts (incl. photos)
- [federation.md](federation.md) — pairing, crypto, message protocol, relay
- [immich.md](immich.md) — the Photos plugin
- [ai-access.md](ai-access.md) — API tokens, /llms.txt, MCP
- [frontend.md](frontend.md) — app structure, themes, kid app, plugin slots
- [apps-shell.md](apps-shell.md) — native apps + release CI, Docker deploy
- [gaps.md](gaps.md) — **the honest register of pending / incomplete work**

## Architecture in five paragraphs

**One process, one file.** The server is a single Fastify process over one
better-sqlite3 database (WAL). Migrations are plain SQL steps keyed by
`PRAGMA user_version` (currently **9**) in `core/db.ts`. There is no ORM.
Modules run raw SQL against tables they own; cross-module reads go through
exported service functions (`loadChecklists`, `createEvent`, …).

**Schemas are shared, not duplicated.** Every request body/response shape is
a Zod schema in `packages/shared/src/schemas.ts`; the server `parse()`s with
it and the web app imports the inferred types. Shared packages export
TypeScript *source* — tsx runs it server-side, Vite bundles it client-side;
there is no build step for shared code.

**Everything is a plugin.** Core features implement the same `CoreModule`
interface optional plugins use: `register({ app, db, bus, scheduler,
settings, broadcast, log })`. The typed event bus (`task.completed`,
`event.created`…) is the hook surface; a bridge in `plugin-host.ts` turns
bus events into WebSocket cache-invalidation broadcasts.

**Real-time is notify-only.** Clients mutate over REST; the server broadcasts
`{type:"invalidate", keys:["tasks",…]}`; TanStack Query refetches. No
operational transform, no sync protocol. Optimistic updates only where UX
demands it (list check-off).

**Access is one guard.** Every principal — family member, wall display, AI
token — resolves through `requireAccess`/`requireActor(db, req, reply,
action)` in `core/auth.ts` into a uniform `Access` record used for
permissions and audit attribution. Details in [server-core.md](server-core.md).

## Conventions a newcomer must know

- Port **49733** (host user runs Obsidian on 3000). Relay: **8790**.
- `pnpm dev` runs server (tsx watch) + web (Vite:5173, proxying /api).
- Tests: `pnpm --filter @coord/server test` (Vitest, ~59 tests incl. a
  two-instance federation suite over real HTTP + real crypto, points/group
  chores, and a fake-Immich proxy suite).
- Seed demo data: `pnpm --filter @coord/server seed` (Jared/Sam `family123`,
  Mia PIN `1111` teen-tier, Leo pattern cat→horse→cat→goat little-tier).
- Browser verification: playwright-core with
  `executablePath: "/opt/pw-browsers/chromium"` (don't `playwright install`).
- Frontend imports between local files are **extensionless** (Vite can't map
  `.js` → `.tsx`); server files import with `.js` extensions (NodeNext).
- Commit style: plain descriptive messages; never put model IDs in committed
  artifacts.
- The user's deployment: single home server behind **Nginx Proxy Manager**
  (WebSockets Support ON), app on 49733, relay planned for a VPS at
  `coord.tinbadger.com`. `trustProxy: true` is set on Fastify — federation
  reply URLs depend on `X-Forwarded-Proto`.
