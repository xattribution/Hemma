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
- Google/Outlook 2-way sync — not started (Phase 5 in the plan).
- Week/day views are functional but plainer than month view (no drag-resize).
