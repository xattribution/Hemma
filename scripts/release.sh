#!/usr/bin/env bash
# Cut a Hemma release from a Linux machine with git + gh (GitHub CLI) set up.
#
#   scripts/release.sh 0.2.0                # everything except pushing the Docker image
#   scripts/release.sh 0.2.0 --push-image   # also push ghcr.io/xattribution/hemma (needs `docker login ghcr.io`)
#
# What it does, in order:
#   1. gate: clean tree, tests + typecheck pass
#   2. stamps the version, commits, tags v<version>
#   3. builds the web app + standalone server bundles (Linux tar.gz, Windows zip)
#   4. builds the Docker image (multi-arch when pushing, so Pis work too)
#   5. pushes branch + tag  →  GitHub Actions (apps.yml) starts building the
#      desktop apps (.exe/.dmg/.deb/.AppImage) and the Android APK
#   6. creates the GitHub release and uploads the server bundles, install.sh
#      and checksums. CI attaches the client apps to the SAME release when it
#      finishes (~30 min) — no second step for you.
set -euo pipefail

say() { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] \
  || die "usage: release.sh <version> [--push-image] — version looks like 0.2.0 (got: '${VERSION:-nothing}')"
PUSH_IMAGE=0; [ "${2:-}" = "--push-image" ] && PUSH_IMAGE=1
TAG="v$VERSION"
IMAGE="ghcr.io/xattribution/hemma"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------- 1. gates (nothing is modified until all of these pass) ----------
for tool in git gh node pnpm curl tar zip unzip sha256sum; do
  command -v "$tool" >/dev/null || die "'$tool' is required — on Debian/Ubuntu: sudo apt install -y $tool"
done
gh auth status >/dev/null 2>&1 || die "gh isn't logged in — run: gh auth login"
[ -z "$(git status --porcelain)" ] || die "working tree isn't clean — commit or stash first"
git rev-parse "$TAG" >/dev/null 2>&1 && die "tag $TAG already exists"
# don't start a 10-minute build that can't be pushed at the end
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BRANCH" 2>/dev/null || true
if git rev-parse -q --verify "origin/$BRANCH" >/dev/null 2>&1 \
   && [ "$(git rev-list --count "HEAD..origin/$BRANCH")" != 0 ]; then
  die "your branch is behind origin/$BRANCH — run: git pull, then re-run"
fi

say "installing deps + running the release gate (tests, typecheck)"
pnpm install --frozen-lockfile
pnpm --filter @coord/server test
pnpm --filter @coord/server exec tsc --noEmit
pnpm --filter @coord/web exec tsc --noEmit

# ---------- 2. version stamp ----------
say "stamping version $VERSION"
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
# keep the native shell's displayed version in step
node -e "
  const fs = require('fs');
  const f = 'apps/shell/src-tauri/tauri.conf.json';
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
" 2>/dev/null || true
# NOTE: no commit/tag yet — that happens only after every build succeeds,
# so a failed build leaves nothing to clean up beyond `git checkout .`

# ---------- 3. server bundles ----------
rm -rf release apps/web/dist
say "building the web app"
pnpm --filter @coord/web build
scripts/build-server-bundle.sh linux-x64 release
scripts/build-server-bundle.sh win-x64 release
cp deploy/install.sh release/install.sh

# ---------- 4. docker image ----------
if command -v docker >/dev/null 2>&1; then
  if [ "$PUSH_IMAGE" = 1 ]; then
    # arm64 builds run under QEMU on x86 hosts and are SLOW (~15 min first
    # time; cached after). Skip ARM with: HEMMA_PLATFORMS=linux/amd64
    PLATFORMS="${HEMMA_PLATFORMS:-linux/amd64,linux/arm64}"
    say "building + pushing $IMAGE:$VERSION ($PLATFORMS)"
    docker buildx create --use --name hemma-builder >/dev/null 2>&1 || true
    docker buildx build --platform "$PLATFORMS" \
      -t "$IMAGE:$VERSION" -t "$IMAGE:latest" --push .
  else
    say "building the Docker image locally (add --push-image to publish to ghcr)"
    docker build -t "$IMAGE:$VERSION" -t "$IMAGE:latest" .
  fi
else
  say "docker not found — skipping the container image"
fi

# ---------- 5. checksums, commit + tag, push, release ----------
(cd release && sha256sum ./* > SHA256SUMS.txt)

say "committing the version stamp + tagging $TAG"
git add -A && git commit -m "Release $TAG"
git tag "$TAG"

say "pushing branch + tag (this kicks off the desktop/Android builds in CI)"
git push origin HEAD
git push origin "$TAG" || { sleep 3; git push origin "$TAG"; }

say "creating the GitHub release"
gh release create "$TAG" \
  --title "Hemma $TAG" \
  --notes "$(cat <<NOTES
## Hemma $VERSION

**Easy install (pick one):**
- 🐳 **Docker (any Linux box/NAS):** \`curl -fsSL https://raw.githubusercontent.com/xattribution/Hemma/HEAD/deploy/install.sh | bash\`
- 🪟 **Windows server:** download \`hemma-server-$VERSION-windows-x64.zip\`, unzip, double-click **Start Hemma.bat**
- 🐧 **Linux server:** download \`hemma-server-$VERSION-linux-x64.tar.gz\`, unpack, run \`./start.sh\`

**Apps** (attached below by CI within ~30 min of this release appearing):
- 📱 Android: \`coord-android.apk\` — sideload it, open, type your server address (Settings → Phones & tablets shows a QR + the address)
- 💻 Windows/macOS/Linux desktop clients: the .exe / .dmg / .deb / .AppImage files
- iPhone: use the web app → Share → Add to Home Screen (App Store build is on the roadmap)

Checksums: \`SHA256SUMS.txt\`
NOTES
)" \
  release/hemma-server-"$VERSION"-linux-x64.tar.gz \
  release/hemma-server-"$VERSION"-windows-x64.zip \
  release/install.sh \
  release/SHA256SUMS.txt

say "done — release $TAG is live. CI is now building the desktop apps + APK"
say "and will attach them to the same release: watch with"
say "  gh run watch  (or: gh run list --workflow=apps.yml)"
