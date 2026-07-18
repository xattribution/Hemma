# 🏡 Coord — the family coordination calendar

A self-hosted, family-friendly hub that organizes your family's life: a classic
light-mode calendar, kids' chores with points and swapping, shared shopping
lists, reminders, and an always-on kitchen-tablet dashboard — all syncing in
real time to every phone, tablet and browser in the house.

Your data lives on **your** server (a NAS, mini-PC or Raspberry-class box).
One codebase, every platform: Coord is a PWA, so it installs to the home
screen on iPhone and Android alike and runs full-screen on a kitchen display.

![Coord](apps/web/public/icons/icon-192.png)

## What's inside (Phase 1)

- **Calendar** — month / week / day views, recurring events (RFC-5545 RRULE),
  "just this one / this and following / whole series" edits, per-member colors,
  categories, DST-safe timezone handling
- **Family & roles** — parents sign in with a password, kids with a big-button
  4-digit PIN from an avatar picker; parents manage, kids do
- **Chores & to-dos** — daily/weekday/weekend repeats, points, tap-to-complete,
  and one-tap **swap** ("you take dishes, I'll walk the dog")
- **Lists** — three flavors: **running** (groceries — add, check off, "clear
  done", repeat), **dated** (need-by deadline, surfaces in that day's
  summary), and **event-linked** (a packing list that rides along with the
  beach trip). Structured quick-add (item / qty / store), **colored store
  quick-tags** that auto-save the first time you use a store, per-store
  filters, and one-tap **sharing** (phone share sheet, clipboard, email, or a
  QR code any camera can scan)
- **Day summary hub** — tap any date for that day's events, chores and dated
  lists in one panel, and add events right from it; today's chores live on
  the calendar page too (collapsible)
- **Reminders** — server-side scheduler with web-push notifications
  (iOS ≥ 16.4 installed PWA, Android, desktop) plus in-app toasts
- **Displays** — kitchen, living room, bedroom: shareable links (copy button
  + QR code to scan on the device), each display individually configured —
  card dashboard or fullscreen interactive calendar, with events/chores/lists
  toggles; signs in once and survives weeks unattended
- **AI & API access** — bearer tokens for assistants and automations, a
  bundled **MCP server** ([apps/mcp](apps/mcp/README.md)) for Claude and
  other MCP clients, LLM-readable API docs at `/llms.txt`, and a
  cross-entity search endpoint; everything an AI does shows up in History
  under its name ("HAL added Eggs (Costco) to Groceries")
- **History** — a searchable "what's been happening" feed (who completed,
  swapped, added, changed what — and when)
- **Real-time everywhere** — WebSocket-driven updates land on every screen
  in under a second
- **Plugin architecture** — the seams for what's next (see roadmap) are built
  and already used by the core features themselves

## Get the code

The app currently lives on the `claude/family-coordination-calendar-bs4zqo` branch:

```bash
git clone -b claude/family-coordination-calendar-bs4zqo https://github.com/xattribution/coord.git
cd coord
```

To just **run** Coord on a server, skip straight to [Production (Docker)](#production-docker) —
no Node or pnpm needed on the host.

## Quick start (development)

Prerequisites: **Node 22+** and **pnpm 10** (the `npm`/`node` from apt are too old):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
corepack enable && corepack prepare pnpm@10 --activate
```

Then:

```bash
pnpm install
pnpm seed        # demo family: Jared/Sam (password family123), Mia (PIN 1111), Leo (PIN 2222)
pnpm dev         # API :49733 + web :5173 (proxied; open :5173)
```

Open http://localhost:5173. Tests and typechecks:

```bash
pnpm test        # Vitest: recurrence/DST, scheduler idempotency, API flows
pnpm typecheck
```

## Production (Docker)

```bash
docker compose up -d --build
```

One container: the app (API + web UI) on port **49733**, SQLite in the
`coord-data` volume. Browse `http://<server-ip>:49733` to run the setup
wizard.

**HTTPS (required for home-screen install & push):** put your reverse proxy
in front — Nginx Proxy Manager, Caddy, Traefik, whatever you already run —
and proxy your domain to `http://<host>:49733` with **WebSocket support
enabled** (live sync runs on `/api/ws`). On Nginx Proxy Manager: new proxy
host → forward to the host IP, port 49733, toggle WebSockets Support, request
a certificate, Force SSL. If idle wall displays ever stall, add
`proxy_read_timeout 3600s;` in the Advanced tab.

**Relay (federation rendezvous):** see [apps/relay](apps/relay/README.md) —
`cd deploy/relay && docker compose up -d --build` publishes it on port
8790 for your reverse proxy (or `--profile caddy` for bundled auto-HTTPS).

**Backup:** copy the `coord-data` volume (a single SQLite file + WAL). That's
the whole family database.

### First run

Visit your Coord URL — a setup wizard creates your household and your parent
account. Add everyone else in **Settings → Family**.

### Phones & tablets

- **iPhone/iPad:** Safari → Share → **Add to Home Screen**. Then open the app
  and enable reminders in Settings (iOS only allows push for installed PWAs).
- **Android:** Chrome prompts to install, or ⋮ → Add to Home screen.
- **Native apps** (Windows .exe, Linux .deb/.AppImage, macOS .dmg, Android
  .apk): thin shells that remember your server address and open the same app —
  built from [apps/shell](docs/apps.md) via `git tag vX.Y.Z && git push --tags`.
- **Displays:** Settings → Displays → create a display, then open its link
  (or scan its QR code) once on the tablet. It stays signed in, updates
  live, and refreshes itself nightly. Pick per display what it shows —
  dashboard cards or a fullscreen calendar. Recommended: Fully Kiosk Browser
  (Android) or Guided Access (iPad) to keep the screen on.
- **AI assistant:** Settings → AI & API access → create a token, then hook up
  the [MCP server](apps/mcp/README.md) or point any agent at the REST API
  (instructions at `/llms.txt`).

## Tech

**Full architecture & per-module docs live in [docs/wiki/](docs/wiki/README.md)**
— written so a fresh engineer (or AI agent) can pick the project up cold.
The pending-work register is [docs/wiki/gaps.md](docs/wiki/gaps.md).

TypeScript monorepo (pnpm workspaces):

| Package | What |
| --- | --- |
| `apps/server` | Fastify 5 + better-sqlite3 (WAL), rrule, web-push; REST + notify-only WebSocket |
| `apps/web` | React 19 + Vite PWA, Tailwind 4, TanStack Query with WS invalidation, custom-built calendar views |
| `apps/shell` | Tauri 2 native shell (exe/deb/AppImage/dmg/apk) that connects to your server — see [docs/apps.md](docs/apps.md) |
| `packages/shared` | Zod schemas = one source of truth for validation + types on both sides |
| `packages/plugin-sdk` | The stable plugin surface (event bus, plugin context, UI slots) — see its README |

Design choices worth knowing:

- **SQLite on purpose** — one file to back up, zero DB administration; the
  single-process synchronous driver serializes writes. The schema is plain SQL,
  portable to Postgres if a household ever outgrows it.
- **Recurrence is expanded server-side** in the event's own wall-clock
  timezone, then converted per-occurrence to UTC — a 7am school run stays 7am
  across DST (unit-tested).
- **The WebSocket carries no data**, only "something changed" keys; clients
  refetch via TanStack Query. Simple, debuggable, and impossible to de-sync.
- **Core features are plugins** — calendar, chores, lists, reminders and the
  dashboard all register through the same `CoordPlugin` interface future
  plugins use, so the extension seams are real, not speculative.

## Roadmap

Each of these lands as a plugin on the seams that exist today (design
decisions for them are pinned in [docs/design-decisions.md](docs/design-decisions.md)):

1. **AI assistant** — natural-language event/task management ("add soccer
   every Wednesday at 5"), grounded recall from the history log; local-first
   providers (Ollama-style server), hosted APIs only by explicit opt-in
2. **Voice** — wake word + speech-to-text (Whisper preferred, locally hosted)
   feeding the same intent parser; microphone mode for the kitchen display
3. **Cross-family federation** — pair with grandma's or your brother's Coord
   instance (QR/invite code); parents choose exactly which categories/lists
   to share; conflicts resolve by write order, with the full trail in history
4. **Email → calendar** — an AI-assisted inbox watcher that adds events from
   school newsletters and appointment emails directly to the calendar
   (optional approval-tray mode for cautious households)
5. **Google / Outlook two-way sync**
6. **Drawable calendar** — a pen/finger annotation layer over the calendar
   grid (the `calendar.day-cell.overlay` slot is reserved for it)
7. **Home Assistant** — bus events out to MQTT, HA entities in
8. **Points modes** — optional competition / goal / allowance modes on top of
   the default keep-it-simple completion experience

## Docs

- [Plugin SDK](packages/plugin-sdk/README.md)
- [Manual device test checklist](docs/testing.md)
