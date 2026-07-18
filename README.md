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
- **Chores & to-dos** — daily/weekday/weekend repeats, tap-to-complete,
  one-tap **swap** ("you take dishes, I'll walk the dog"), and **family
  chores**: one job, per-person steps ("Clean the kitchen — Mia: floor,
  Leo: dishes") that only greens up when every step is checked
- **Points** — an auditable ledger: per-step and per-chore points that land
  only when the whole job is done, parent bonuses & deductions (with
  reasons), and parent-defined **goals** — fillable milestone bars,
  first-past-the-post races, deadlines, monthly resets, optional rewards —
  on a Points page for everyone (giant "My stars" tab in the little-kid app)
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

## The three pieces of Coord

Coord is deliberately split into three separate things. Know which one
you're touching:

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  1. HOME SERVER          │  E2E   │  1. ANOTHER FAMILY'S      │
│  (your box, Docker)      │◄──────►│     HOME SERVER           │
│  ALL your data lives     │ sealed │                           │
│  here: coord.db          │ blobs  └──────────────────────────┘
└───────────▲─────────────┘    ▲
            │                  │ (only when families can't
            │ LAN or HTTPS     │  reach each other directly)
            │                  ▼
┌───────────┴─────────────┐   ┌──────────────────────────┐
│  3. UI CLIENTS           │   │  2. RELAY (web server)    │
│  browser / PWA / .exe /  │   │  a small VPS; RAM-only,   │
│  .apk — a pane of glass, │   │  zero-knowledge, stores   │
│  stores NOTHING          │   │  and logs NOTHING         │
└─────────────────────────┘   └──────────────────────────┘
```

**1. The home server** is the product: one Docker container (or `pnpm dev`)
on a box the family owns. Every event, chore, list, point, member, setting
and photo credential lives in **one SQLite file** on that box and nowhere
else. → [setup / update / backup](#1-the-home-server)

**2. The relay web server** exists only for **federation between families
that can't reach each other directly**. It is optional, stateless and
zero-knowledge: RAM-only mailboxes of end-to-end-encrypted blobs, no
accounts, no logs, no database. One relay can serve many families; local
pairing never touches it. → [setup / update](#2-the-relay-federation-web-server)

**3. The UI layer** is a pane of glass. The web app is served by the home
server itself (so it's always in sync); the native shells (.exe, .deb,
.AppImage, .dmg, .apk — iOS via installed PWA for now) are thin windows
that remember your server's address and render the same UI. Clients hold
no data — sign in and everything is there. → [setup / update](#3-the-ui-clients-pane-of-glass)

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

## 1. The home server

The family's system of record. Runs as one Docker container on any Linux
box/NAS/mini-PC (or as `pnpm dev` while developing).

**Set up**

```bash
docker compose up -d --build
```

One container: API + web UI on port **49733**, everything stored in the
`coord-data` volume as a single SQLite file (`coord.db`). Browse
`http://<server-ip>:49733` and the setup wizard creates your household and
parent account; add everyone else in **Settings → Family**.

**HTTPS (required for home-screen install & push):** put your reverse proxy
in front — Nginx Proxy Manager, Caddy, Traefik, whatever you already run —
and proxy your domain to `http://<host>:49733` with **WebSocket support
enabled** (live sync runs on `/api/ws`). On Nginx Proxy Manager: new proxy
host → forward to the host IP, port 49733, toggle WebSockets Support, request
a certificate, Force SSL. If idle wall displays ever stall, add
`proxy_read_timeout 3600s;` in the Advanced tab.

**Update**

```bash
git pull
docker compose up -d --build     # data survives — it's in the volume
```

Database migrations run automatically on boot. Clients need nothing:
browsers/PWAs/native shells load the UI from the server, so updating the
server updates every screen in the house.

**Backup — your data is ONE file**

Data *and* configuration (members, tokens, federation keys, plugin
settings) are all inside `coord.db`. Three ways to keep it safe:

1. **From any device** — Settings → **Backup → Download backup** saves a
   snapshot right onto the phone/laptop you're holding (parents only,
   logged in History).
2. **Onto a NAS** — point the data volume at a NAS-backed path in
   `docker-compose.yml`:
   ```yaml
   volumes:
     - /mnt/nas/coord-data:/data     # instead of the named volume
   ```
   or keep the named volume and pull a nightly snapshot over the API
   (create a token under Settings → AI & API access):
   ```bash
   # host crontab — rolling 7-day snapshots onto the NAS at 3:30 every night
   30 3 * * * curl -s -H "Authorization: Bearer <api-token>" \
     http://localhost:49733/api/backup -o /mnt/nas/coord/coord-$(date +\%a).db
   ```
3. **Restore** — stop the server, place the backup file back as
   `/data/coord.db` (delete stale `coord.db-wal`/`-shm`), start the server.

## 2. The relay (federation web server)

**Only needed if** your family pairs with another family that can't reach
your home server directly. It's a zero-knowledge rendezvous: RAM-only
mailboxes of sealed, end-to-end-encrypted blobs. No accounts, no database,
no logs — nothing to back up, nothing to leak. One relay serves many
families; each family opts in under **Settings → Family connections** and
can point at any relay URL (default `coord.tinbadger.com`).

**Set up** (on a small VPS, [full guide](apps/relay/README.md)):

```bash
git clone -b claude/family-coordination-calendar-bs4zqo https://github.com/xattribution/coord.git
cd coord/deploy/relay
docker compose up -d --build          # relay on port 8790
# then proxy https://your-relay-domain → http://<vps>:8790
# (no proxy on the box? RELAY_DOMAIN=your-domain docker compose --profile caddy up -d --build)
```

**Update**

```bash
git pull && docker compose up -d --build   # stateless: safe at any moment
```

## 3. The UI clients (pane of glass)

All clients are windows onto the home server — they store nothing.

- **Web app** — just browse to the server. It's a PWA:
  **iPhone/iPad:** Safari → Share → **Add to Home Screen** (this is the iOS
  app path for now — required for push). **Android:** Chrome prompts to
  install, or ⋮ → Add to Home screen.
- **Native apps** — Windows `.exe`, Linux `.deb`/`.AppImage`, macOS `.dmg`,
  Android `.apk`: thin shells that ask for your server address once, then
  open the same UI ([install guide](docs/apps.md)). Build a release with
  `git tag vX.Y.Z && git push --tags` — GitHub Actions attaches all
  installers to the release. A dedicated iOS app is future work; the
  installed PWA covers iPhones today.
- **Updating clients:** browsers/PWAs update automatically from the server.
  Native shells almost never need updating (the UI they show *is* the
  server's) — only grab a new release when the shell itself changes.
- **Displays:** Settings → Displays → create a display, then open its link
  (or scan its QR code) once on the tablet. It stays signed in, updates
  live, and refreshes itself nightly. Pick per display what it shows —
  dashboard cards, fullscreen calendar, lists, or an Immich photo frame.
  Recommended: Fully Kiosk Browser (Android) / Guided Access (iPad).
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
