# Frontend (apps/web)

React 19 + Vite + Tailwind v4 PWA. TanStack Query for all data;
WebSocket invalidation for real-time; vite-plugin-pwa (Workbox) for
install/offline shell.

## Structure

```
src/
├── App.tsx                 # setup → login → (KidApp | device dashboard | Shell routes)
├── api/ (client, queries, ws)   # fetch wrapper, all hooks, WsProvider
├── layout/Shell.tsx        # header, tabs (role-aware), avatar menu, bottom nav
├── components/             # Avatar, Modal (+inputCls/btn styles), Toast,
│                           #  PatternPad, SwitchPersonModal, FullscreenButton, ThemeToggle
├── features/
│   ├── auth/ (SetupPage, LoginPage)
│   ├── calendar/ (CalendarPage, MonthView, WeekView, EventModal, DayModal, dates)
│   ├── tasks/ (TasksPage)          # adult/teen chore board
│   ├── kid/ (KidApp)               # little-tier app (jobs/days/lists)
│   ├── lists/ (ListsPage)
│   ├── dashboard/ (DashboardPage, elevation)   # display layouts incl. photos
│   ├── history/ (HistoryPage)
│   └── settings/ (SettingsPage + Displays/Families/Photos/AiAccess sections)
├── plugins/registry.tsx    # PluginSlot: settings.section, dashboard.card,
│                           #  calendar.toolbar, calendar.day-cell.overlay, event.detail.section
└── theme/global.css        # tokens + 4 themes + fullscreen rule
```

## Routing rules (App.tsx)

1. Setup needed → SetupPage. 2. No session → LoginPage (avatar grid).
3. Device session → DashboardPage only. 4. Child with `uiLevel:"little"`
→ KidApp (whole app replaced). 5. Otherwise Shell routes; History/Settings
routes exist only for non-child members (KID_TABS mirrors this).

## Data & realtime

- `api/queries.ts` holds every hook; query keys match `QueryKeyPattern`
  (first element) so WS invalidation lands. When adding a query, keep the
  key's head aligned with a server broadcast key.
- Optimistic updates: list item toggle only (rollback on error).
- Kiosk boot: `?device=` exchange gates `useMe` (deviceAuthPending) to
  avoid the 401 race.
- Logout resets the cache (`qc.resetQueries()`).

## Design language & themes

Rules (from the owner's design pass — keep them):
- **Color roles, not color variety**: `coral` = the ONE action color
  (rust in light), `sky` = where-you-are (selection, active tab, today),
  `leaf` = done-states only, `sun` = points only. Never introduce sibling
  hues of an existing accent.
- **Squared structure, soft controls**: global radius tokens are small
  (~5-8px); panels are flat with a hairline outline (the `--shadow-card`
  token IS the 1px line — no floating drop shadows). Rows divide with
  `divide-line` hairlines instead of per-row boxes; steps indent behind a
  straight left rule. The **kid app and PatternPad opt back into big radii**
  via arbitrary values (`rounded-[1.75rem]`) — keep them round and playful.
- **No explainer copy on use pages** (Calendar/Chores/Lists/Points);
  tooltips (`title=`) on icon-only buttons instead. Settings may explain.
- **Calendar events** render as ink text with a 3px category color bar,
  not solid pastel pills.
- **Mobile**: one wrapping toolbar per page; the bottom bar carries only
  the daily four tabs (History/Settings live in the avatar menu on phones).

Themes on `:root[data-theme=…]`: **light** (cream + rust + slate blue,
default), **paper** (near-mono ink + one red), **earth** (forest leads,
rust seconds), **midnight** (one blue), **forest**, **plum** (dark).
ThemeToggle = popover picker (☀️📄🌾🌙🌲🍇), persisted at `coord.theme`.
Avatars: emoji on a cream circle with member-color ring.

## PWA

Manifest + generated icons (`public/icons/`), NetworkFirst API caching,
installable on iOS (Add to Home Screen) and Android. Push requires HTTPS +
(on iOS) installed-to-home-screen; usePush handles the states.

## Verification pattern

Playwright-core scripts (executablePath `/opt/pw-browsers/chromium`)
driving the dev server, screenshots per feature batch; e2e golden flows in
`/e2e`. Gotchas: 403 (not 401) for unelevated display writes; scope modal
clicks with `.animate-slide-up`; `text=SUN` matches "Sunscreen".
