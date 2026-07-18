# Chores & to-dos

**Module:** `apps/server/src/modules/tasks.ts`
**UI:** `apps/web/src/features/tasks/TasksPage.tsx` (adult/teen board),
`apps/web/src/features/kid/KidApp.tsx` (little-kid "My jobs")

## Model

`tasks` row: title, notes, icon (emoji), kind (`chore|todo`), assignee
(member or NULL = "up for grabs"), optional dueAt, `repeat`
(`daily` | `weekdays` | comma list of weekday numbers, `0`=Sun), optional
points, `steps_json` (≤20 strings — sub-steps of ONE chore, not separate
assignments).

Completion is **per occurrence**: `task_completions (task_id,
occurrence_date)` where occurrence_date is the household-timezone ISO date
for recurring chores and `''` for one-offs. `GET /api/tasks?date=` computes
each task's `dueToday`, `completed`, `stepsDone` for that date.

## Steps semantics (grouped & checkable)

`step_checks (task_id, occurrence_date, step_index)`.
`POST /api/tasks/:id/steps/:index/toggle`:
- checking the last unchecked step → auto-completes the chore
  (via `completeTask`, which also back-fills all step checks on manual
  complete)
- unchecking a step of a completed chore → reopens it
`POST /api/tasks/:id/complete` **toggles** (complete ↔ uncomplete) and
syncs step_checks both ways.

## Permissions

`task.complete` and `task.reassign` — everyone including kids and
(elevated or open) displays; `task.manage` (create/edit/delete) — parents
or kids with the grant. Agents: everything.

## UI

- Board: one column per member (the signed-in member's column first),
  plus "Up for grabs". Each row: **explicit round checkbox** (empty ring →
  green ✓; hover previews the check), then icon, title, steps (each a
  tappable row with its own small checkbox), repeat/points meta.
- Anything completed **today stays on the board struck-through** (so a
  check-off never makes the row vanish mid-tap, and mistakes can be
  unticked). Filter logic in TasksPage.
- Points: per-column "★ N today" chip sums completed points.
- Swap: ⇄ button → member picker ("who takes it?"); kids may swap.
- Little-kid tier gets giant cards in KidApp (see members-kids.md).

## Pending / gaps

- Reward *modes* (competition / goal / allowance) from the original vision:
  only raw points exist; no tally page, no redemption. Design decision was
  "optional enabled features; default is completion & satisfaction".
- No drag-and-drop swapping (button-based swap shipped instead; @dnd-kit
  was considered).
- `todo` kind exists in schema but the UI treats everything as chores.
