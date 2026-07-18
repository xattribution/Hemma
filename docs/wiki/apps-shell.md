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

## Packaging & releases (`scripts/`, `deploy/install.sh`)

Three "soccer-mom" install paths for the home server, all built by
`scripts/release.sh <version> [--push-image]` on a Linux machine with `gh`:

1. **Guided Docker installer** — `deploy/install.sh` (curl-able). Prompts:
   install dir, port, timezone, optional NAS bind (`/nas`), optional public
   hostname (prints proxy instructions only), optional restore-from-backup
   (copies the .db into the `hemma_coord-data` volume via a throwaway
   alpine container before first start). Writes `docker-compose.yml`
   (project name `hemma`), starts, waits on `/api/health`, prints LAN
   addresses. Re-running = update (pull + up). Reads prompts from
   `/dev/tty` so `curl | bash` works. Default image
   `ghcr.io/xattribution/hemma:latest` (pushed by release.sh with
   `--push-image`, multi-arch amd64+arm64 via buildx); `--build` builds
   from a source clone instead.
2. **Standalone server bundles** — `scripts/build-server-bundle.sh
   <linux-x64|win-x64>`: esbuild bundles the whole server to one
   `server.mjs` (ESM, better-sqlite3 external), ships it with an official
   portable Node runtime (pinned `NODE_VERSION`, ABI 127), the built web
   dist, and `node_modules/better-sqlite3` (+bindings) carrying the right
   prebuilt binding — the Windows zip swaps in the official win32-x64
   prebuild from better-sqlite3's releases. Launchers: `Start Hemma.bat` /
   `start.sh` set `WEB_DIST`/`DATABASE_PATH` next to themselves (data/
   folder = the backup); Linux bundle includes a `hemma.service` template.
   Verified end-to-end on Linux (unpack → start.sh → health + setup).
3. **Client apps** — the existing tag-triggered CI (`apps.yml`).

`release.sh` order matters: it creates the GitHub release *before* CI
finishes, so tauri-action attaches the desktop/APK bundles to the same
release (~30 min later). Release assets: both server bundles, install.sh,
SHA256SUMS.txt. The web app's **Settings → Phones & tablets**
(`AppsSection.tsx`) shows the server address + a QR pointing at
`releases/latest/download/hemma-android.apk` — that asset name is stable,
so the QR never goes stale.

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

- APK release signing (currently debug-signed; fine for sideloading —
  Play Store submission will need a real keystore + versionCode bumps).
- First real CI run of the apps workflow will happen on the first tag push
  — Android job is the most likely to need a tweak.
- ghcr.io image doesn't exist until the first `release.sh --push-image`;
  until then `install.sh` needs `--build`.
- Desktop app bundling the server ("app that IS the server") and
  tablet-as-server APK remain future ideas; a dedicated iOS/App Store
  client is on the user's roadmap alongside Google Play.
