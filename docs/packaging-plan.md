# Packaging plan — Coord for non-technical families

Goal: grandma's household runs Coord without knowing what Docker is.

> **Shipped so far:** native *client* shells — Windows .exe, Linux
> .deb/.AppImage, macOS .dmg and an Android .apk (`apps/shell`, built by the
> `apps` GitHub workflow — see [apps.md](./apps.md)). They connect to an
> existing family server, which is the "someone techy set it up once" model.
> The tiers below cover making the *server* itself normie-installable.

Three tiers, built in this order (each reuses the previous):

## Tier 1 — One-line installer (near-term, days of work)
A `get.coord.sh` script + a prebuilt multi-arch Docker image on GHCR
(`ghcr.io/xattribution/coord`). The script checks for Docker, installs it if
missing, writes the compose file, prompts for a family name, and prints the
URL + QR code. Works on any Linux box/NAS/Pi. This also becomes the base for
"a techy relative sets it up once" — the realistic path for most families.

## Tier 2 — Desktop app (Windows .exe / macOS .dmg) (mid-term, ~1-2 weeks)
**Tauri** wrapper (Rust shell, tiny binaries) that bundles the Node server as
a sidecar binary (`pkg`/`node --experimental-sea` single-file build; SQLite +
data in the OS app-data folder). Launch = tray icon + local server on 49733 +
opens the app window. Auto-start on login, auto-update via Tauri updater.
The family's phones connect to the PC's LAN address (shown as a QR in the
tray menu). Caveat documented: the PC must be on for phones to sync; push
needs the DuckDNS wizard (Tier 2.5: bundle a guided tunnel like
cloudflared for one-click HTTPS).

## Tier 3 — Android APK "server in your pocket / on the wall tablet"
The wall tablet IS the server: Tauri v2 Android build (or Capacitor +
nodejs-mobile) running the same server + webview. One device, always on,
plugged in — perfectly matches the kitchen-display use case. Phones connect
to the tablet over LAN. This is the true "normie bundle": install APK,
name your family, scan QRs on everyone's phones.

## Shared work all tiers need
1. Single-binary server build (drop tsx-in-prod: esbuild-bundle server to
   one JS file, then Node SEA/pkg) — also shrinks the Docker image.
2. First-run wizard already exists; add a "connect your phone" screen with
   the LAN QR (reuse display-link QR plumbing).
3. Written-for-humans guide (docs/family-guide.md) with screenshots:
   setup, adding kids, displays, patterns, sharing with grandma.
4. Auto-backup: nightly copy of the SQLite file to a chosen folder.

Recommendation: ship Tier 1 next (it's mostly packaging), start Tier 3
before Tier 2 — the always-on Android tablet is closer to how families
actually deploy Coord than a Windows PC.
