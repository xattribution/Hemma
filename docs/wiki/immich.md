# Photos: sources, slideshows & screensaver

Three layers:
1. **Source plugins** (optional, toggled under Plugins): `immich`
   (`apps/server/src/plugins/immich.ts`) and `nas`
   (`apps/server/src/plugins/nas.ts`). Google Photos is planned alongside
   Google Calendar sync.
2. **The unified tap** — `core.photos` (`modules/photos.ts`): a parent picks
   the household source (Settings → Photos); `GET /api/photos/random` and
   `GET /api/photos/asset/:id` 307-redirect to the chosen backend so
   consumers never care which one it is.
3. **Consumers** — the `photos` display layout (DisplayPhotos) and the
   in-app slideshow/screensaver (`features/photos/Slideshow.tsx`): avatar
   menu → Slideshow → start now / start once in N minutes / screensaver
   after N idle minutes. Per-device prefs (localStorage): idleMinutes,
   speedSec (3-600), order shuffle|seq ("in order" follows folder/album
   order; pure-random sources fall back to shuffle). Shared engine
   `usePhotoRotation` + `PhotoStage`: near-transparent ‹ › edge arrows,
   tap photo = exit (overlay) / share (displays), subtle share button.

## The conversational layer

- Every rotation POSTs `/api/photos/current`; `GET /api/photos/current`
  answers "what's on the kitchen display?" (screen name, kind, assetId,
  fresh <3 min). Exposed to agents via /llms.txt + MCP `get_screen_photos`.
- `POST /api/photos/share {assetId}` mints a PUBLIC 7-day link
  (`/shared/photo/<128-bit token>`, RAM-only — dies at restart); streamed
  by an internal self-call using the per-boot `x-coord-internal` service
  token (core/internal.ts). UI share panel: QR + copy + native share +
  "send to a family" (federation `photo.link` message → toast + History
  on the other side). MCP `share_photo` composes mint+send.
- Voice pick of the share target: future (Whisper phase).

## NAS folder plugin

Mounting is the HOST's job: mount the NFS/SMB share and bind it into the
container (`- /mnt/family-nas/coord:/nas` in docker-compose.yml), then set
the path in Settings → Photos. On connect Coord creates `<root>/photos`
(scanned recursively, 1-min cache, jpg/png/webp/gif/avif) and
`<root>/files` (reserved for cross-family file sharing over the federation
channel — future). Asset ids are base64url relative paths resolved
strictly inside photos/ (traversal rejected). Tests: `test/nas.test.ts`.

## Immich plugin (below)

**Plugin:** `apps/server/src/plugins/immich.ts` (optional — toggle in
Settings → Plugins, id `immich`)
**UI:** Settings → Photos (PhotosSection, renders only while the plugin is
enabled) + the `photos` display layout (DisplayPhotos in DashboardPage).

## Design

The server **proxies** the family's Immich server: the API key is stored in
plugin settings, never returned to any browser (`GET settings` reports only
`configured: true`), and displays — which hold no member credentials — can
still pull photos. Every Immich call tries current-then-legacy endpoint
shapes (`firstOk` helper) because Immich's API has drifted across versions
(`/server/ping` vs `/server-info/ping`, `POST /search/random` vs
`GET /assets/random`, `/assets/:id/thumbnail` vs `/asset/thumbnail/:id`).

## Endpoints

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET /api/p/immich/settings` | settings.manage | `{url, albumId, configured}` — never the key |
| `POST /api/p/immich/settings` | settings.manage | set url / apiKey (write-only) / albumId |
| `POST /api/p/immich/test` | settings.manage | ping + Immich version |
| `GET /api/p/immich/albums` | settings.manage | album picker source |
| `GET /api/p/immich/random?count=` | any signed-in principal | `{assets:[{id}]}` — album-scoped if albumId set, else server-random |
| `GET /api/p/immich/asset/:id` | any signed-in principal | streams preview-size image bytes (1h private cache) |

All Immich-touching routes 400 with a setup hint until url+key are saved.

## Display slideshow

`layout: "photos"` (displayConfigSchema) → DisplayPhotos: fetches a batch
of 30 random ids, crossfades every 20s, refetches a fresh batch each lap,
shows a friendly "Set up Immich under Settings → Photos" panel on error
and self-recovers once configured (the interval keeps retrying).

## Setup for the family

Immich → Account settings → API keys → create; paste address + key in
Settings → Photos; Test connection; optionally pick an album; set any
display's Screen to 🖼️ Photos.

## Tests

`test/immich.test.ts` — fake Immich via node:http: refuses unconfigured,
never echoes the key, version test, random→asset byte-stream round trip,
parent-only settings.

## Pending / gaps

- `files/` sharing between families is NOT built (folder reserved; will
  ride the federation channel).
- Google Photos + Google Calendar sync: future integration (source picker
  already lists it as "soon").
- No video assets (IMAGE filter only), no multi-album mix, no upload.
