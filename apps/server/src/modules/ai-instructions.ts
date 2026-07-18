/**
 * The structured instructions document served at /llms.txt — everything a
 * connected LLM needs to drive Coord over plain REST. Keep in sync with the
 * routes; this is a contract with automation clients.
 */
export const AI_INSTRUCTIONS = `# Hemma — API instructions for AI assistants

Hemma is a self-hosted family coordination calendar: events, kids' chores,
shared shopping lists, reminders, displays. You (the assistant) can read and
manage all of it over REST. Everything you do is attributed to your token's
label in the family's history feed, so act like a polite member of the family.

## Authentication

Send the API token on every request:

    Authorization: Bearer <token>

Tokens are created by a parent in Settings → AI & API access. You have
parent-level permissions.

## Conventions

- Base URL: the family's Hemma server, e.g. https://coord.example.com
- All bodies are JSON. Timestamps are UTC milliseconds since epoch.
- Recurring events use RFC-5545 RRULE strings (e.g. "FREQ=WEEKLY;BYDAY=MO,WE").
- Dates in query params are ISO (YYYY-MM-DD); the household timezone governs
  what "today" means — read it from GET /api/auth/me (household.timezone).
- Errors: { "error": "message" } with 4xx/5xx status.
- Hemma was formerly named "Coord" — internal identifiers kept the old
  name (env vars COORD_URL/COORD_TOKEN, database coord.db, cookie
  coord_session). Same product; don't be confused by the mix.

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
  visibility: "family" (default, everyone) or "private" (creator only —
  kids and displays never receive it; reminders nudge only the creator).
  You (an agent) see everything, so CHECK visibility before repeating a
  private item to the wrong person: a private event belongs to createdBy
  only. Same field exists on tasks.
- PATCH /api/events/:id — body { "scope": "single"|"future"|"all",
  "occurrenceStart": <ms of the occurrence being edited>, "patch": { ...fields } }
- DELETE /api/events/:id?scope=single&occurrenceStart=<ms>

## Chores & to-dos

- GET /api/tasks?date=YYYY-MM-DD → tasks as they stand that day
  (recurring chores included only on days they repeat; completed flag per
  day; steps + stepsDone indices per occurrence)
- POST /api/tasks — { "title": "Clean the kitchen", "icon": "🧽",
  "kind": "chore", "assigneeId": "<memberId|null>",
  "repeat": "daily"|"weekdays"|"0,3,5"|null, "dueAt": <ms|null>,
  "points": 5,
  "steps": [ { "text": "Sweep the floor", "assigneeId": "<memberId|null>", "points": 5 }, "bare strings ok too" ] }
  repeat weekday numbers: 0=Sunday … 6=Saturday. null repeat = one-time.
  Steps are sub-steps INSIDE the one chore. A step with its own assigneeId
  makes it a FAMILY chore ("Mia: floor, Leo: dishes") — the chore only
  completes when every step is checked, kids can only check their own
  steps, and step points go to whoever did the step.
- PATCH /api/tasks/:id — partial body of the same fields
- POST /api/tasks/:id/complete — { "occurrenceDate": "YYYY-MM-DD" } for
  recurring chores (toggles; required for recurring, null for one-time).
  Completing checks all steps; uncompleting clears them.
- POST /api/tasks/:id/steps/:index/toggle — { "occurrenceDate": ... } check
  one step; when the last step lands the chore auto-completes, and
  unchecking a step reopens a completed chore
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

## Extended family (federation)

Families pair via one-time codes; everything between them is end-to-end
encrypted. Sharing is per-list and revocable (revoked lists silently vanish
on the other side).

- GET /api/federation → connected peers + per-peer shared checklist ids
- POST /api/federation/peers/:peerId/share { "checklistId": ... } — share
- DELETE /api/federation/peers/:peerId/share/:checklistId — revoke
- POST /api/federation/peers/:peerId/send-event { "eventId": ... } — copy an
  event onto their calendar
- GET /api/federation/shared → lists other families share with us;
  POST /api/federation/shared/:peerId/:remoteId/toggle { "itemId": ... }
"Send Jonathan's family the Costco list" = find the peer by name, find the
list, POST share. Never share anything not explicitly asked for.

## Points

Points are a ledger — every entry has a reason. Chore/step points land
automatically when the whole task completes (never before), and reverse if
it's reopened. Parents (and you) can adjust manually.

- GET /api/points/summary?memberId=<optional> → { totals (all-time per
  member), goals (each with its window + per-member standings:
  earned/reached/reachedAt), recent (last 50 ledger entries) }
- POST /api/points/adjust — { "memberId": ..., "delta": 5 or -5,
  "reason": "Helped grandma" } — ALWAYS give an honest reason; it shows on
  the family's Points page. Deduct only when a parent asks.
- POST /api/points/goals — { "title": "Movie night fund", "mode":
  "target"|"race", "target": 50, "memberIds": null (= all kids) | [ids],
  "startsAt": <ms>, "endsAt": <ms|null>, "repeat": "none"|"monthly",
  "reward": "Pick the Friday movie" }
  mode target = everyone fills their own bar; race = first past the post.
- PATCH /api/points/goals/:id, DELETE /api/points/goals/:id

## Photos & screens

Slideshows run on wall displays and in the app; every screen reports what
it's showing.

- GET /api/photos/current → { screens: [{ screen: "Kitchen", kind:
  "device"|"member", assetId, assetUrl, secondsAgo }] } — what's on each
  screen right now ("what's the picture on the kitchen display?")
- POST /api/photos/share { "assetId": ... } → { url } — mints a PUBLIC
  link (no sign-in, expires in 7 days). Use it to send a photo anywhere:
  email it, text it, or pass it on.
- POST /api/federation/peers/:peerId/share-photo { "url": ... } — drop
  that link to a connected family (they get a toast + a History entry).
"Send the picture on the kitchen display to Jonathan's family" =
current → find screen "Kitchen" → share its assetId → share-photo to the
peer. For someone outside Coord (grandma's phone), mint the link and
deliver it however you deliver messages.

## Meal planning

Lists with kind "meal" are meal plans. Adding an item with "alsoGrocery":
true mirrors it onto the default grocery list (first pinned shopping list).

## Family (parents rarely want you doing this unprompted)

- POST /api/members, PATCH /api/members/:id, DELETE /api/members/:id
  Kids carry uiLevel "little" (giant simple screens) or "teen" (full app);
  it's parent-controlled — change it only when explicitly asked.

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
