# Native apps, relay & deployment

## Native shell (`apps/shell`)

Tauri 2. One tiny bundled page (`ui/index.html`, no build step) asks for
the family's server address once (normalizes scheme, probes reachability
with a no-cors fetch, offers connect-anyway), stores it in localStorage,
then navigates the webview to the server's PWA — the apps can't go stale
because all real UI ships from the server. Rust side is boilerplate
(`lib.rs` with mobile entry point; `crate-type = staticlib/cdylib/rlib`
for Android). Icons generated from the PWA icon via `tauri icon`.

**CI** (`.github/workflows/apps.yml`): tag `v*` → tauri-action builds
Windows (.exe/.msi), macOS (.dmg), Linux (.deb/.AppImage) and attaches to
the release; a second job builds the Android APK (tauri android init →
manifest patched with `usesCleartextTraffic` for plain-http LAN → debug-
signed APK for sideloading) and uploads it. Manual dispatch → workflow
artifacts only. iPhone path = PWA (no Apple dev account).
Verified locally (Linux): compile, run under Xvfb, .deb bundling.
See `docs/apps.md` for the family-facing install guide.

## Relay (`apps/relay` + `deploy/relay`)

Zero-dependency Node HTTP server, RAM only: `/health`, `/pair/offer`,
`/pair/claim` (one-time burn), `/mail/send`, `/mail/collect` (drain).
No logs, no disk, sealed blobs only. Port 8790.
`cd deploy/relay && docker compose up -d --build` behind the user's proxy;
`--profile caddy` bundles auto-HTTPS if there's no proxy on the box.

## App deployment (root `docker-compose.yml`)

Single `app` service, port **49733**, `/data` volume (SQLite + VAPID keys
= the entire backup). The image runs the server from TypeScript via tsx
(`pnpm start`); reseed with `docker compose exec app pnpm seed` (wipe =
`docker compose down -v` first). Reverse proxy: user runs Nginx Proxy
Manager — forward to :49733 with WebSockets Support ON
(`proxy_read_timeout 3600s` if kiosks stall). `trustProxy` is enabled;
X-Forwarded-Proto must be passed for federation reply URLs.

## Pending / gaps

- Server-in-a-box tiers (one-line installer w/ GHCR image; desktop app
  bundling the server; tablet-as-server APK) — `docs/packaging-plan.md`.
- APK release signing (currently debug-signed; fine for sideloading).
- First real CI run of the apps workflow will happen on the first tag push
  — Android job is the most likely to need a tweak.
