# Points & goals

**Module:** `apps/server/src/modules/points.ts` (+ award logic in
`modules/tasks.ts`)
**UI:** `features/points/PointsPage.tsx` (everyone; parent controls gated),
KidApp "My stars" tab, per-column "★ today" chips on the chore board.

## Design: a ledger, not a counter

`points_ledger` rows are the single source of truth:
`(member_id, delta ±, reason, source task|step|manual, task_id?,
occurrence_date?, created_by, created_at)`. Totals, goal progress and the
"Recent" feed are all reads over it. That makes every award auditable
("why does Leo have 40?"), reversible, and open to future schemes without
new storage.

## Award rules (in `tasks.ts`)

- Points land **only when the whole task completes** — never on individual
  step checks. Reopening a task (unchecking a step, or toggling complete)
  deletes exactly the rows that completion wrote.
- **Step points** → the step's assignee if it has one, else whoever checked
  it (`step_checks.checked_by`), else the task assignee, else the completer.
- **Task-level points** → the task's assignee, else the completer. (So a
  parent tapping a kid's chore still credits the kid.)
- **Manual adjustments** (`POST /api/points/adjust`, parents/agents only):
  any ± delta with a required reason — bonuses and bad-behavior deductions.
  Audited ("Sam took 2 points from Mia: Left the bike out").

## Goals (`point_goals`)

Primitives kept deliberately few — **window + target + participants +
mode** — so future reward schemes reuse the plumbing:

- `mode: "target"` — everyone fills their own bar to `target`
- `mode: "race"` — first past the post; `reachedAt` = ledger timestamp of
  the crossing entry (deductions can un-cross), winner = earliest
- `repeat: "monthly"` — the measured window becomes the current calendar
  month (rolling reset); otherwise `startsAt`..`endsAt?` ("50 by the 30th")
- `memberIds: null` = every kid; explicit ids may include adults
- `reward` — display-only text ("movie pick", "$10")

`GET /api/points/summary` returns totals + each goal's window and
per-member standings + recent ledger; `standingsFor`/`goalWindow` are
exported for reuse.

## UI

- **PointsPage** (`/points`, tab for all members incl. teen-tier kids):
  your total, family totals, one card per goal — fillable bar per
  participant (member-colored, quarter milestone ticks, 👑 for race
  winners, 🎉 on reach), recent ledger with ± coloring. Parents get
  Adjust (give/take + reason) and Goal create/edit/delete modals.
- **KidApp → My stars**: giant total, giant bars, simplified "Lately" list.
- WS key `points` invalidates all of it live (task completion bridges via
  plugin-host).

## Family chores tie-in (steps v2)

Steps are `{text, assigneeId?, points?}` (bare strings from pre-v9 data
upgrade on read). A task whose steps carry assignees is a family chore:
it lives in the "Family & up for grabs" column, **has no main done button**
(a progress ring shows n/N; the chore greens when the last step lands),
kids can only check their own/unassigned steps (server-enforced 403), and
each step shows its owner's avatar + ★points.

## Pending / gaps

- No redemption flow (spending points) — reward text is informational.
- No streaks/allowance modes yet — both are ledger reads away.
- Race winners aren't frozen when a goal ends; standings recompute live.
