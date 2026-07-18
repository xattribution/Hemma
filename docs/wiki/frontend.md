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

## Theme system

Tokens in `@theme` (Tailwind v4) + per-theme overrides on
`:root[data-theme=…]`: light (default), midnight (black/blue), forest,
plum. **One muted palette shared across themes** — `sun/leaf/sky` never
change per theme; only surfaces (cream/card/line) and the primary accent
(`coral`) do. Member/category colors come from shared constants and match.
ThemeToggle = popover picker (☀️🌙🌲🍇), persisted at `coord.theme`
(legacy "dark" migrates to midnight). Avatars: emoji on a **cream** circle
with member-color ring.

## PWA

Manifest + generated icons (`public/icons/`), NetworkFirst API caching,
installable on iOS (Add to Home Screen) and Android. Push requires HTTPS +
(on iOS) installed-to-home-screen; usePush handles the states.

## Verification pattern

Playwright-core scripts (executablePath `/opt/pw-browsers/chromium`)
driving the dev server, screenshots per feature batch; e2e golden flows in
`/e2e`. Gotchas: 403 (not 401) for unelevated display writes; scope modal
clicks with `.animate-slide-up`; `text=SUN` matches "Sunscreen".
