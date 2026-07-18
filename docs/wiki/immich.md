# Photos (Immich plugin)

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

- **NAS folder connector is NOT built** — this plugin covers the Immich
  path only. The photos/screensaver/NAS plan (incl. cross-family folder
  sharing via the relay's PTP connection) lives in `docs/photos-plan.md`.
- No idle screensaver (photos is an explicit layout, not an idle state).
- No video assets (IMAGE filter only), no multi-album mix, no upload.
