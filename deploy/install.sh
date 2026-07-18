#!/usr/bin/env bash
# Sett — guided Docker setup for the family's home server.
#
#   curl -fsSL https://raw.githubusercontent.com/xattribution/Sett/HEAD/deploy/install.sh | bash
#   (or download it, look inside, and run: bash install.sh)
#
# Asks a few questions in plain language, writes a docker-compose.yml, and
# starts Sett. Re-run it any time: it finds your existing setup and offers
# an update instead (your family's data always stays put in a Docker volume).
#
#   --build   build the image from source instead of pulling the published one
set -euo pipefail

IMAGE="ghcr.io/xattribution/sett:latest"
REPO="https://github.com/xattribution/Sett"
BUILD_FROM_SOURCE=0
[ "${1:-}" = "--build" ] && BUILD_FROM_SOURCE=1

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
say()   { printf '%s\n' "$*"; }
ask()   { # ask "question" "default" -> REPLY  (reads /dev/tty so `curl | bash` works)
  local q="$1" d="${2:-}" src="/dev/stdin"
  [ -r /dev/tty ] && [ "${SETT_NO_TTY:-}" != 1 ] && src="/dev/tty"
  if [ -n "$d" ]; then read -rp "$q [$d]: " REPLY < "$src" || true; REPLY="${REPLY:-$d}";
  else read -rp "$q: " REPLY < "$src" || true; fi
}
lan_ip() { hostname -I 2>/dev/null | awk '{print $1}' || echo "<this machine's IP>"; }

bold "Sett setup"
say  "A few questions and your family server is running. Press ENTER to accept"
say  "the suggestion in [brackets]. Nothing leaves this machine."
echo

# ---------- prerequisites ----------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker isn't installed yet. It's the one thing Sett needs."
  say "Easiest install (official script):  curl -fsSL https://get.docker.com | sh"
  say "Then run me again."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  say "Your Docker is missing the 'compose' plugin — install docker-compose-plugin"
  say "with your package manager (e.g. sudo apt install docker-compose-plugin), then re-run."
  exit 1
fi

# ---------- where ----------
ask "Where should Sett's setup files live?" "$HOME/sett"
DIR="$REPLY"; mkdir -p "$DIR"

if [ -f "$DIR/docker-compose.yml" ] && docker compose -f "$DIR/docker-compose.yml" ps --quiet app >/dev/null 2>&1; then
  echo
  bold "Sett is already set up in $DIR."
  ask "Update it to the latest version now? (y/n)" "y"
  if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    (cd "$DIR" && docker compose pull && docker compose up -d)
    bold "✔ Updated. Your data was untouched."
  fi
  exit 0
fi

# ---------- questions ----------
ask "Which port should Sett answer on? (fine to keep the default)" "49733"
PORT="$REPLY"

DEFAULT_TZ="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo America/New_York)"
ask "Your family's timezone" "$DEFAULT_TZ"
TZ_VAL="$REPLY"

echo
say "Optional: a NAS folder for photos & family files. If your NAS share is"
say "already mounted on this machine (e.g. /mnt/nas), point me at a folder on"
say "it and Sett will keep photos/ and files/ inside. Leave empty to skip —"
say "you can add it later by re-running me."
ask "NAS folder on this machine (empty = skip)" ""
NAS="$REPLY"
if [ -n "$NAS" ] && [ ! -d "$NAS" ]; then
  say "  ⚠ $NAS doesn't exist yet — I'll still write the config, but mount the"
  say "    share there before using Photos → NAS folder in Settings."
  say "    (NFS example for /etc/fstab:  nas.local:/volume1/family  $NAS  nfs  defaults,nofail  0 0)"
fi

echo
say "Optional: a public web address (like sett.yourfamily.com). Only needed if"
say "you want to reach Sett from OUTSIDE the house without a VPN. You'd point"
say "a reverse proxy (Nginx Proxy Manager, Caddy…) at this machine, port $PORT,"
say "with WebSocket support on. Inside the house, the plain address always works."
ask "Public address (empty = home use only)" ""
PUBLIC_HOST="$REPLY"

echo
say "Optional: restoring a family? If you have a Sett backup file"
say "(coord-backup-….db from Settings → Backup), give me its path and this"
say "server starts as that family. Leave empty for a fresh start."
ask "Backup file to restore (empty = fresh start)" ""
RESTORE="$REPLY"
if [ -n "$RESTORE" ] && [ ! -f "$RESTORE" ]; then
  say "  ✗ Can't find $RESTORE — starting fresh instead."; RESTORE=""
fi

# ---------- compose file ----------
if [ "$BUILD_FROM_SOURCE" = 1 ]; then
  if [ ! -f "$DIR/src/Dockerfile" ]; then
    say "Fetching the source code…"
    command -v git >/dev/null 2>&1 || { say "git is needed for --build"; exit 1; }
    git clone --depth 1 "$REPO" "$DIR/src"
  fi
  APP_IMAGE_LINES="build: ./src"
else
  APP_IMAGE_LINES="image: $IMAGE"
fi

NAS_LINE=""
[ -n "$NAS" ] && NAS_LINE="      - $NAS:/nas"

cat > "$DIR/docker-compose.yml" <<YML
# Sett family server — written by install.sh $(date +%F)
# Update any time: re-run install.sh, or: docker compose pull && docker compose up -d
name: sett
services:
  app:
    $APP_IMAGE_LINES
    restart: unless-stopped
    environment:
      - TZ=$TZ_VAL
    ports:
      - "$PORT:49733"
    volumes:
      - coord-data:/data # the whole family lives in this volume — it survives updates
$NAS_LINE

volumes:
  coord-data:
YML
# tidy the empty NAS line if skipped
[ -z "$NAS" ] && sed -i '/^$/d' "$DIR/docker-compose.yml"

# ---------- restore, pull, start ----------
if [ -n "$RESTORE" ]; then
  say "Restoring your family from $(basename "$RESTORE")…"
  docker volume create sett_coord-data >/dev/null
  docker run --rm -v sett_coord-data:/data -v "$(cd "$(dirname "$RESTORE")" && pwd)":/src:ro \
    alpine sh -c "cp /src/$(basename "$RESTORE") /data/coord.db && rm -f /data/coord.db-wal /data/coord.db-shm"
fi

say ""
say "Starting Sett (first time can take a few minutes)…"
(cd "$DIR" && docker compose up -d)

# ---------- wait for health ----------
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 2
done

echo
if [ "${HEALTHY:-0}" = 1 ]; then
  IP="$(lan_ip)"
  bold "✔ Sett is running!"
  say  ""
  say  "  On this machine:        http://localhost:$PORT"
  say  "  Phones & tablets here:  http://$IP:$PORT"
  [ -n "$PUBLIC_HOST" ] && say "  From outside (once your proxy points here):  https://$PUBLIC_HOST"
  say  ""
  say  "Open it in a browser and the setup wizard takes it from there."
  say  "Afterwards, Settings → Phones & tablets has a QR code for the Android app."
  [ -n "$NAS" ] && say "For NAS photos: Settings → Photos → NAS folder → /nas"
else
  say "Sett started but isn't answering yet. Check with:"
  say "  cd $DIR && docker compose logs -f app"
fi
