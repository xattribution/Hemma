# External photo & calendar integrations — difficulty map

Researched July 2026. Ordered by effort-to-value; the ladder is designed so
each rung reuses the previous one's plumbing (the unified photo source and
the calendar import pipeline).

## Calendars

| Rung | What | Difficulty | Notes |
| --- | --- | --- | --- |
| 1 | **ICS subscription URLs** (read-only) | **Done** | Shipped: Settings → Other calendars. Paste any ICS/webcal link (Google secret address, iCloud public link, Outlook published, TeamSnap/school "subscribe"); 30-min poller, per-subscription category/assignee/visibility mapping + include/exclude keywords + skip-all-day; imported events are read-only with a source badge; non-technical link-finding walkthroughs built into the UI. |
| 2 | **iCloud via CalDAV** (read-only → 2-way later) | **Medium** | Apple officially supports CalDAV (`caldav.icloud.com`) with **app-specific passwords** — no developer account, no OAuth. Read-only import is a well-trodden path; 2-way needs etag conflict care. |
| 3 | **Google Calendar API** (2-way) | **Medium-high** | Clean API (syncTokens for incremental pulls), but each self-hosted family must create their own Google Cloud OAuth client (the Home Assistant pattern) — clunky one-time setup we'd have to document carefully; verification warnings otherwise. Do read-only first, then push. |

**Filters** (rung 1 onward): per-subscription — target category, include/
exclude keyword lists, all-day yes/no, visibility default (e.g. import work
calendar as **private to me** — pairs with the visibility system).

## Photos

| Rung | What | Difficulty | Notes |
| --- | --- | --- | --- |
| — | Immich | **Done** | Shipped (search/random + album filter, current API). |
| — | NAS folder | **Done** | Shipped (bind-mount, photos/ + files/). |
| 1 | **iCloud Shared Album** (public website link) | **Medium** | Apple has **no photos API at all**. The one workable path: a Shared Album with "Public Website" on exposes a JSON feed that many tools consume. Unofficial but long-stable; read-only; fits the source-plugin interface exactly. Full-library iCloud (icloudpd-style reverse-engineered auth + 2FA) is fragile and not something to bundle. |
| 2 | **Google Photos** | **Medium, capped by policy** | Since **March 2025 Google removed third-party full-library read** from the Library API — apps can only read content they created or content the user hands over via the **Picker API**. So "slideshow from my whole Google Photos" is impossible for ANY third-party app now. What we can build: user picks an album/photos via Google's Picker (or a shared album), Sett mirrors that selection. Needs per-family OAuth client like Google Calendar. |

## Recommended order

1. ICS subscriptions (biggest calendar win, zero auth pain)
2. iCloud CalDAV read-only (app-specific password)
3. iCloud Shared Album photo source
4. Google Calendar OAuth (read-only → 2-way)
5. Google Photos Picker-based album mirror (same OAuth client as 4)

All five plug into seams that already exist: source plugins behind
`/api/photos/*`, and imported events land through `createEvent` with a
`source` marker, a mapped category, and a visibility default.
