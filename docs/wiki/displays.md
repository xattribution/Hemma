# Displays (kiosks)

**Modules:** device endpoints in `modules/integrations.ts` + elevation in
`modules/auth.ts`/`core/auth.ts`
**UI:** Settings → Displays (DisplaysSection), `features/dashboard/`
(DashboardPage + elevation.tsx).

## Trust model

Displays are **always-on and freely readable**; changing anything asks
"who's doing this?" — an avatar + credential check (password/PIN/pattern)
that elevates the display session to that member for **60 seconds**
(`ELEVATION_MS`). API returns 403 `{code:"elevate"}` → ElevationProvider
opens the ElevateModal, retries after verification, shows an acting-as
banner with countdown. Per-display `requireAuthToChange:false` allows
anonymous `task.complete`/`checklist.check` attributed to the display name.

## Provisioning

Settings → Displays → Create → a **retrievable, shareable** link
`https://coord…/dashboard?device=<token>` + QR. Open once on the tablet:
`App.tsx` exchanges the token (`POST /api/auth/device`) for a ~10-year
session cookie and strips the token from the URL. Device sessions render
ONLY DashboardPage regardless of route.

## Per-display config (`displayConfigSchema`)

- `layout`: `dashboard` (cards: today/tomorrow events, per-kid chores with
  checkable step chips, pinned lists) | `calendar` (fullscreen interactive
  month; tap a day → DayModal) | `lists` (big list boards) | `photos`
  (Immich slideshow — see immich.md)
- `showEvents/showChores/showLists` toggles (dashboard layout)
- `requireAuthToChange`

Config edits broadcast `me` invalidation so live kiosks re-render.

## Longevity

30s clock tick; nightly ~4am `location.reload()`; WS reconnect with
catch-up invalidation; hourly dashboard refetch as fallback. Recommend
Fully Kiosk Browser (Android) / Guided Access (iPad).

## Pending / gaps

- No idle screensaver mode (photos-after-N-minutes-idle); photos is a
  dedicated layout instead. Natural follow-up.
- Display link is plain http on LAN unless proxied — document says use NPM
  for HTTPS when exposing beyond the LAN.
