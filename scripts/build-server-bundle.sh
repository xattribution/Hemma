#!/usr/bin/env bash
# Build a standalone Hemma server bundle — no Node, no Docker, no pnpm needed
# on the target machine. The bundle is: an official portable Node runtime,
# the server compiled to one file (esbuild), the built web app, and
# better-sqlite3 (the only native module) with the right prebuilt binary.
#
#   scripts/build-server-bundle.sh linux-x64 [outdir]
#   scripts/build-server-bundle.sh win-x64   [outdir]
#
# Run from the repo root on a Linux machine (cross-builds the Windows zip).
# Produces hemma-server-<version>-<platform>.tar.gz / .zip in <outdir>
# (default: release/).
set -euo pipefail

PLATFORM="${1:?usage: build-server-bundle.sh <linux-x64|win-x64> [outdir]}"
mkdir -p "${2:-release}"
OUT="$(cd "${2:-release}" && pwd)"
NODE_VERSION="${NODE_VERSION:-22.12.0}"   # ABI 127 — matches better-sqlite3 prebuilds below
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version || '0.0.0'")"
CACHE="$ROOT/.cache/runtimes"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
mkdir -p "$OUT" "$CACHE"

say() { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }

# fail before doing any work if a required tool is missing
NEEDED="node curl tar"
[ "$PLATFORM" = "win-x64" ] && NEEDED="$NEEDED unzip zip"
for tool in $NEEDED; do
  command -v "$tool" >/dev/null || { echo "!! '$tool' is required — on Debian/Ubuntu: sudo apt install -y $tool"; exit 1; }
done

# ---------- 1. web app + single-file server ----------
if [ ! -d apps/web/dist ]; then
  say "building the web app"
  pnpm --filter @coord/web build
fi

say "bundling the server (esbuild → one file)"
node_modules/.bin/esbuild apps/server/src/index.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$STAGE/server.mjs" \
  --external:better-sqlite3 \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --log-level=warning

# ---------- 2. the one native module, with the right prebuild ----------
say "packing better-sqlite3 for $PLATFORM"
mkdir -p "$STAGE/node_modules"
bs3_src="$(ls -d node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 | head -1)"
cp -rL "$bs3_src" "$STAGE/node_modules/better-sqlite3"
cp -rL "$(ls -d node_modules/.pnpm/bindings@*/node_modules/bindings | head -1)" "$STAGE/node_modules/bindings"
cp -rL "$(ls -d node_modules/.pnpm/file-uri-to-path@*/node_modules/file-uri-to-path | head -1)" "$STAGE/node_modules/file-uri-to-path"
# strip build junk; keep only the compiled binding
find "$STAGE/node_modules/better-sqlite3/build" -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} +
find "$STAGE/node_modules/better-sqlite3/build/Release" -mindepth 1 ! -name better_sqlite3.node -exec rm -rf {} +
rm -rf "$STAGE/node_modules/better-sqlite3/deps" "$STAGE/node_modules/better-sqlite3/src"

if [ "$PLATFORM" = "win-x64" ]; then
  # replace the Linux binding with the official Windows prebuild that
  # better-sqlite3's own CI publishes on every release
  bs3_version="$(node -p "require('$STAGE/node_modules/better-sqlite3/package.json').version")"
  node_abi="$(node -p "process.versions.modules")"   # 127 for Node 22
  prebuild="better-sqlite3-v$bs3_version-node-v$node_abi-win32-x64.tar.gz"
  say "fetching the Windows better-sqlite3 prebuild ($prebuild)"
  rm -f "$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  curl -fL --retry 3 -o "$STAGE/prebuild.tar.gz" \
    "https://github.com/WiseLibs/better-sqlite3/releases/download/v$bs3_version/$prebuild" \
    || { echo "!! Couldn't download $prebuild — check https://github.com/WiseLibs/better-sqlite3/releases/tag/v$bs3_version"; exit 1; }
  tar -xzf "$STAGE/prebuild.tar.gz" -C "$STAGE/node_modules/better-sqlite3"
  rm -f "$STAGE/prebuild.tar.gz"
  [ -f "$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ] \
    || { echo "!! Windows prebuild extracted to an unexpected layout"; exit 1; }
fi

# ---------- 3. portable Node runtime ----------
case "$PLATFORM" in
  linux-x64)
    dist="node-v$NODE_VERSION-linux-x64"
    [ -f "$CACHE/$dist.tar.xz" ] || { say "downloading Node $NODE_VERSION (linux)"; curl -fL --retry 3 -o "$CACHE/$dist.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/$dist.tar.xz"; }
    tar -xJf "$CACHE/$dist.tar.xz" -C "$STAGE" "$dist/bin/node"
    mv "$STAGE/$dist/bin/node" "$STAGE/node"; rm -rf "$STAGE/$dist"
    ;;
  win-x64)
    dist="node-v$NODE_VERSION-win-x64"
    [ -f "$CACHE/$dist.zip" ] || { say "downloading Node $NODE_VERSION (windows)"; curl -fL --retry 3 -o "$CACHE/$dist.zip" "https://nodejs.org/dist/v$NODE_VERSION/$dist.zip"; }
    unzip -q -j "$CACHE/$dist.zip" "$dist/node.exe" -d "$STAGE"
    ;;
  *) echo "unknown platform: $PLATFORM"; exit 1 ;;
esac

# ---------- 4. web app + version stamp + launchers + README ----------
cp -r apps/web/dist "$STAGE/web"
# the server reads its displayed version from the package.json beside it
printf '{ "name": "hemma-server", "private": true, "version": "%s" }\n' "$VERSION" > "$STAGE/package.json"

if [ "$PLATFORM" = "win-x64" ]; then
  # CRLF so Notepad users can read them
  printf '@echo off\r\ncd /d "%%~dp0"\r\nset "WEB_DIST=%%~dp0web"\r\nset "DATABASE_PATH=%%~dp0data\\coord.db"\r\necho Hemma is starting ... leave this window open.\r\necho Open http://localhost:49733 in a browser on this computer,\r\necho or http://THIS-COMPUTERS-IP:49733 from phones and tablets.\r\n.\\node.exe server.mjs\r\npause\r\n' > "$STAGE/Start Hemma.bat"
  printf 'HEMMA — your family server (Windows)\r\n=====================================\r\n\r\n1. Unzip this folder anywhere (Documents is fine).\r\n2. Double-click "Start Hemma.bat". Windows may ask about the network:\r\n   choose Allow (private networks) so phones in the house can reach it.\r\n3. On this computer, open http://localhost:49733 and finish setup.\r\n4. On phones/tablets, use http://<this computer'"'"'s IP>:49733 —\r\n   find the IP with: Settings > Network > Properties (IPv4 address).\r\n\r\nEverything lives in the "data" folder next to this file. Back up your\r\nfamily = copy data\\coord.db somewhere safe (or use Settings > Backup\r\nin the app). To update Hemma: download the new zip, unzip it, and move\r\nyour old "data" folder into it.\r\n\r\nTip: to start Hemma automatically when the computer turns on, put a\r\nshortcut to "Start Hemma.bat" in shell:startup (press Win+R, type\r\nshell:startup, press Enter, drag the shortcut in).\r\n' > "$STAGE/README.txt"
  out_name="hemma-server-$VERSION-windows-x64"
  say "zipping $out_name"
  (cd "$STAGE" && zip -qr9 "$OUT/$out_name.zip" .)
else
  cat > "$STAGE/start.sh" <<'SH'
#!/usr/bin/env bash
cd "$(dirname "$0")"
export WEB_DIST="$PWD/web"
export DATABASE_PATH="$PWD/data/coord.db"
echo "Hemma is starting — open http://localhost:49733 (or this machine's IP from phones)."
exec ./node server.mjs
SH
  chmod +x "$STAGE/start.sh" "$STAGE/node"
  cat > "$STAGE/hemma.service" <<'UNIT'
# Run Hemma at boot (Linux with systemd):
#   1. Edit the two paths below to where you unpacked this folder.
#   2. sudo cp hemma.service /etc/systemd/system/
#   3. sudo systemctl enable --now hemma
[Unit]
Description=Hemma family server
After=network.target

[Service]
WorkingDirectory=/home/YOU/hemma-server
ExecStart=/home/YOU/hemma-server/start.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
  cat > "$STAGE/README.txt" <<'TXT'
HEMMA — your family server (Linux)
==================================

1. Unpack this folder anywhere.
2. Run ./start.sh
3. On this computer, open http://localhost:49733 and finish setup.
4. On phones/tablets, use http://<this machine's IP>:49733.

Everything lives in the "data" folder next to this file. Back up your
family = copy data/coord.db somewhere safe (or use Settings > Backup in
the app). To update: unpack the new release and move your old "data"
folder into it.

To start at boot, see hemma.service (instructions inside the file).
TXT
  out_name="hemma-server-$VERSION-linux-x64"
  say "packing $out_name"
  tar -C "$STAGE" -czf "$OUT/$out_name.tar.gz" .
fi

say "done → $OUT/$out_name.*"
