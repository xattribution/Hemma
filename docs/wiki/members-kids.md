# Members, roles & kid tiers

**Module:** `apps/server/src/modules/members.ts`, auth in `core/auth.ts`
**UI:** Settings → Family (MemberModal), LoginPage avatar grid,
SwitchPersonModal, PatternPad, KidApp.

## Roles & credentials

- **parent** — password (≥6 chars, scrypt). Full permissions.
- **child** — 4-digit PIN **or** picture pattern: 4 taps on the fixed 3×3
  animal grid (`PATTERN_ANIMALS`), stored as `pat:<4 digits>` and hashed
  like any credential. Kid passwords are parent-controlled (kids have no
  settings access at all).

Login page = avatar grid → tap yourself → password / PIN pad / pattern pad.
Sessions are long-lived cookies (`config.sessionDays`); avatar menu offers
Switch person / Sign out (logout uses `qc.resetQueries()` — invalidate alone
left stale "signed-in" data).

## Grants

Parents can grant kids extra capabilities (`event.manage`, `task.manage`,
`checklist.manage`) via checkboxes in MemberModal → stored in
`grants_json`, enforced by `can()` everywhere (UI + API + displays).

## Kid UI tiers (`ui_level`, schema v8)

Parent-chosen per kid in MemberModal ("Their app"):

- **`little`** (default for new kids) — Fisher-Price-scale dedicated app
  (`features/kid/KidApp.tsx`): three giant tabs (My jobs / My days /
  Lists), huge cards, giant tap targets, no drawers/menus/settings. My days
  is a today+tomorrow list, not a month grid. Routed in `App.tsx`:
  `role === "child" && uiLevel === "little"` → KidApp replaces the whole
  router.
- **`teen`** (or NULL, for kids created before v8) — the standard app minus
  History and Settings (tab list + route guards in Shell/App). Everything
  else identical to parents, gated by grants.

Kids only ever see: Calendar, Chores, Lists (their tier's presentation).

## Family management

CRUD parent-only (`member.manage`). Deleting a member soft-deletes and
kills their sessions. You can't remove yourself. Household rename:
`PATCH /api/household` (Settings → Our home).

## Pending / gaps

- No per-member notification preferences (push is per-device opt-in).
- No avatar image upload — emoji + color only (by design, for now).
