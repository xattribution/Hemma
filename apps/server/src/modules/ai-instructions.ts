/**
 * The structured instructions document served at /llms.txt — everything a
 * connected LLM needs to drive Coord over plain REST. Keep in sync with the
 * routes; this is a contract with automation clients.
 */
export const AI_INSTRUCTIONS = `# Coord — API instructions for AI assistants

Coord is a self-hosted family coordination calendar: events, kids' chores,
shared shopping lists, reminders, displays. You (the assistant) can read and
manage all of it over REST. Everything you do is attributed to your token's
label in the family's history feed, so act like a polite member of the family.

## Authentication

Send the API token on every request:

    Authorization: Bearer <token>

Tokens are created by a parent in Settings → AI & API access. You have
parent-level permissions.

## Conventions

- Base URL: the family's Coord server, e.g. https://coord.example.com
- All bodies are JSON. Timestamps are UTC milliseconds since epoch.
- Recurring events use RFC-5545 RRULE strings (e.g. "FREQ=WEEKLY;BYDAY=MO,WE").
- Dates in query params are ISO (YYYY-MM-DD); the household timezone governs
  what "today" means — read it from GET /api/auth/me (household.timezone).
- Errors: { "error": "message" } with 4xx/5xx status.

## Discover state

- GET /api/auth/me → who you are + household name/timezone
- GET /api/members → family members: id, name, role (parent|child), color, avatar
- GET /api/dashboard/today → one call: today's + tomorrow's events, each
  member's chores today, pinned lists
- GET /api/search?q=soccer → matches across events, tasks, list items
  (text OR store tag), and history — use this before assuming something
  doesn't exist
- GET /api/audit?limit=50&q=dishes → history feed ("Mia swapped 'Dishes' to Leo")

## Calendar

- GET /api/events?start=<ms>&end=<ms> → expanded occurrences in the window,
  each with occurrenceStart/occurrenceEnd (recurring events appear once per
  occurrence; edit/delete of one occurrence needs its occurrenceStart)
- POST /api/events — body:
  { "title": "Soccer practice", "startAt": 1783890000000, "endAt": 1783895400000,
    "timezone": "America/New_York", "allDay": false, "category": "sports",
    "rrule": "FREQ=WEEKLY", "assigneeIds": ["<memberId>"], "reminderMinutes": 60,
    "location": "Riverside Park", "description": "" }
  Categories: family, school, sports, work, appointment, birthday, holiday, other.
- PATCH /api/events/:id — body { "scope": "single"|"future"|"all",
  "occurrenceStart": <ms of the occurrence being edited>, "patch": { ...fields } }
- DELETE /api/events/:id?scope=single&occurrenceStart=<ms>

## Chores & to-dos

- GET /api/tasks?date=YYYY-MM-DD → tasks as they stand that day
  (recurring chores included only on days they repeat; completed flag per day)
- POST /api/tasks — { "title": "Feed the dog", "icon": "🐶", "kind": "chore",
  "assigneeId": "<memberId|null>", "repeat": "daily"|"weekdays"|"0,3,5"|null,
  "dueAt": <ms|null>, "points": 5 }
  repeat weekday numbers: 0=Sunday … 6=Saturday. null repeat = one-time.
- PATCH /api/tasks/:id — partial body of the same fields
- POST /api/tasks/:id/complete — { "occurrenceDate": "YYYY-MM-DD" } for
  recurring chores (toggles; required for recurring, null for one-time)
- POST /api/tasks/:id/reassign — { "toMemberId": "<memberId|null>" }
  (null = up for grabs). Use this to swap chores between kids.
- POST /api/tasks/:id/reminder — { "offsetMinutes": 30 } (null clears)
- DELETE /api/tasks/:id

## Lists (shopping, packing, checklists)

Lists come in three flavors: **running** (no dates — groceries, constantly
added to and cleared), **dated** (needBy deadline — appears in that day's
summary), and **event-linked** (linkedEventId — rides along with an event's
days, e.g. a packing list for the beach trip).

- GET /api/checklists → all lists with items
  (item: text, quantity, store, checked; list: needBy nullable ms deadline,
  linkedEventId + linkedEventTitle nullable)
- GET /api/stores → the household's store quick-tags [{name, color}];
  stores auto-register the first time an item uses them
- POST /api/checklists — { "title": "Groceries", "icon": "🛒",
  "kind": "shopping"|"packing"|"checklist", "pinnedToDashboard": true,
  "needBy": <ms|null>, "linkedEventId": <eventId|null> }
- PATCH /api/checklists/:id — partial (set needBy to give it a deadline;
  the list then appears in that day's summary)
- POST /api/checklists/:id/clear-checked — remove all checked items
  (the running-list sweep after a shopping run)
- POST /api/checklists/:id/items — { "text": "Eggs", "quantity": "1 dozen",
  "store": "Costco" }
  → "I need eggs from Costco tomorrow" = add item with store "Costco" AND
  PATCH the list's needBy to tomorrow (or use an existing dated list).
- PATCH /api/checklists/:id/items/:itemId — change text/quantity/store
  (e.g. moving eggs from Costco to Walmart = { "store": "Walmart" })
- POST /api/checklists/:id/items/:itemId/toggle — check/uncheck (buying it)
- DELETE /api/checklists/:id/items/:itemId

## Family (parents rarely want you doing this unprompted)

- POST /api/members, PATCH /api/members/:id, DELETE /api/members/:id

## Good behavior

1. Resolve names to ids via GET /api/members; match case-insensitively.
2. Before adding an item, check the list for it (GET /api/checklists) to
   avoid duplicates — if it exists unchecked, update quantity/store instead.
3. When asked "are we both getting eggs?" style questions, read the relevant
   list(s) and answer from data; don't mutate.
4. Prefer store tags on items over creating one list per store.
5. Deleting events/tasks/lists is destructive: only when clearly asked.
6. Times you receive from users are in the household timezone unless stated.
`;
