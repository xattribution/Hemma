# Photos, screensaver & NAS plan

Goal: the wall display becomes a family photo frame when idle, photos come
from uploads, a NAS folder, or Immich — and photo folders can be shared
between federated families. The VPS (coord.tinbadger.com) stays exactly what
it is today: a zero-knowledge rendezvous/relay for peer-to-peer connections —
it never hosts or sees photos.

## Phase A — Uploads + screensaver (build first)
- `photo_albums` + `photos` tables; originals under `/data/photos/` (inside
  the existing backed-up volume); server-side thumbnailing via `sharp`.
- Settings → Photos: parent uploads (multi-file, phone camera roll works via
  PWA file input), creates albums, marks albums "screensaver".
- Display config gains `screensaver: { enabled, idleMinutes, albumIds }`.
  Kiosk shows a slow crossfade slideshow after N idle minutes; any tap
  returns to the dashboard/calendar. Clock overlay stays visible.

## Phase B — Sources: NAS folder + Immich (connector plugins)
Both are `CoordPlugin`s feeding the same albums model as "external sources"
(scanned on a schedule, thumbnails cached locally):
- **NAS/folder source**: a mounted path (SMB/NFS mounted by the host OS,
  bind-mounted into the container — documented) or WebDAV URL + credentials.
  Read-only scan → album per subfolder.
- **Immich source**: server URL + API key, pick albums to mirror. Immich
  remains the photo manager; Coord only displays.

## Phase C — Sharing photos between families
Reuses federation exactly like lists: share an *album* with a peer;
thumbnails/originals stream through the same sealed channel (chunked
AES-GCM envelopes; large payloads go peer-to-peer when reachable directly).
When only the relay path exists, the relay forwards sealed chunks with the
same RAM-only/no-log guarantees — or the share is deferred until a direct
connection is available (setting per pair). NAS sources shared this way
share the *scanned album*, not the NAS credentials. Revoke = album vanishes
on the other side, same as lists.

Order: A (a weekend of work, huge visible win) → B-NAS → B-Immich → C.
