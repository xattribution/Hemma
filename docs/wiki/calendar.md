# Calendar

**Module:** `apps/server/src/modules/calendar/` (index + service + recurrence)
**UI:** `apps/web/src/features/calendar/` (CalendarPage, MonthView, WeekView,
EventModal, DayModal, dates.ts)

## What it does

Classic month/week/day calendar. Events have title/description/location,
category (8 fixed categories with shared muted colors in
`EVENT_CATEGORIES`), all-day flag, per-event IANA timezone, optional RRULE
recurrence, assignees (member ids — colored dots), optional reminder offset.

## Recurrence — the highest-risk logic

`recurrence.ts` expands RRULEs **in the event's wall-clock time** using the
rrule.js "fake UTC" pattern, then converts each occurrence to real UTC via
`core/tz.ts` (@date-fns/tz). Never expand in UTC directly — DST would shift
times. A 7am school run stays 7am across DST transitions (unit-tested in
`test/recurrence.test.ts`). rrule is CJS — import default and destructure
(`import pkg from "rrule"`), named imports break under tsx.

Edit semantics (`PATCH /api/events/:id` with `scope`):
- `single` → exception row in `event_exceptions` (cancelled or moved w/ override)
- `future` → set UNTIL on the original, clone with the patch from that point
- `all` → patch the master row

`GET /api/events?start&end` returns **expanded instances**
(`occurrenceStart/occurrenceEnd`, `isException`) — clients never expand.

## Visibility (v10)

Events carry `visibility: family | private`. Enforcement is server-side in
`canView` (calendar/service.ts): private = creator + parents + agents;
kids and displays never receive it (events list, dashboard, search).
Reminders for private items push to the creator only. UI: "Who sees it?"
in the event modal; parents get an eye toggle to reveal others' private
items; per-user member filter chips (localStorage) declutter the calendar
without hiding anything from the server's perspective.

## Subscriptions (v11) — imported ICS feeds

`modules/subscriptions.ts` (`core.calsync`): parents paste any ICS/webcal
link (Google "secret address", iCloud public calendar, Outlook published
calendar, TeamSnap/school "subscribe" links) in **Settings → Other
calendars**. A scheduler job re-fetches every feed every 30 minutes (plus
immediately on create/edit/"Update now"); each sync **atomically replaces**
that feed's events (`DELETE WHERE source_sub_id = ?` + reinsert, in one
transaction) with deterministic ids (`sub_<subid8>_<sha1(uid)>`), so resyncs
never duplicate. Parsing is node-ical (`ical.sync.parseICS` over our own
fetch — 15 s timeout, 10 MB cap, webcal://→https://).

Per-subscription mapping (all in the UI): target category, assignee (whose
color the events wear), visibility default (import a work calendar as
private), include/exclude title keywords, skip-all-day. One-off events
outside roughly [-60 d, +550 d] are skipped; recurring ones import whole
(RRULE string is lifted from node-ical's rrule and expanded by our own
recurrence engine; EXDATEs and modified occurrences become cancelled
`event_exceptions`, with each modified occurrence re-imported as its own
one-off). Cap: 500 events per feed (excess logged + surfaced in status).
The subscription label defaults to the feed's `X-WR-CALNAME`.

**Imported events are read-only**: rows carry `source_sub_id`, `toApiEvent`
exposes `sourceLabel`, and `updateEvent`/`deleteEvent` throw 400
(`rejectIfImported`). The event modal shows a "From \"Tigers U10\"" banner
instead of the edit form. Deleting a subscription sweeps all its events.
`last_status` on the row is always human-readable ("ok: 12 events" /
"That link doesn't work anymore…") — shown verbatim in Settings.
Tests: `test/subscriptions.test.ts` (fake ICS server over node:http).

## UI notes

- Month cells stretch to fill viewport height
  (`minHeight: max(5rem, calc((100dvh - 15rem)/weeks))`); the shell drops
  its width cap under `html:fullscreen` (wall-calendar mode).
- Day tap → `DayModal`: that day's events + dated/event-linked lists +
  chores summary; the day-centric hub.
- Event create/edit modal includes recurrence picker, category, assignees,
  reminder. Deleting recurring asks single/future/all.
- `dates.ts` wraps date-fns; `viewRange` computes the query window.

## Dependencies

rrule, @date-fns/tz, date-fns (web). Emits `event.*` bus events; reminders
module watches events for reminder offsets; checklists can link to events.

## Pending / gaps

- Drawable-calendar canvas overlay (`calendar.day-cell.overlay` slot is the
  reserved seam) — not started.
- Google/Outlook **2-way** sync — not started (ICS subscriptions cover
  read-only import; see `../integrations-plan.md` for the OAuth rungs).
- Week/day views are functional but plainer than month view (no drag-resize).
