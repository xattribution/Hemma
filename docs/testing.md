# Testing

## Automated

```bash
pnpm test        # Vitest: recurrence (incl. DST boundary), bus, API flows, kiosk auth
pnpm typecheck   # all packages
```

An end-to-end browser pass (login → event create → chore complete → shared
list → kiosk live-update via WebSocket → kid PIN login) is scripted with
Playwright against the production build; see `apps/server` seed data for the
demo family it expects.

## Manual device checklist (per release)

- [ ] **iPhone**: Add to Home Screen → app opens standalone, light theme, icon correct
- [ ] **iPhone**: Settings → enable reminders → OS notification arrives for a 5-min event reminder
- [ ] **Android**: install prompt → standalone app, push notification arrives
- [ ] **Tablet kiosk**: open display link once → dashboard loads; complete a chore from a phone → tablet updates < 1 s
- [ ] **Kiosk overnight soak**: still live next morning (WS reconnect + 4 am self-reload)
- [ ] **Kid flow**: PIN login on a phone, complete own chore, swap a chore to a sibling
- [ ] **Offline blip**: airplane-mode a phone, reopen app → last-known day renders; disable airplane mode → data refreshes
- [ ] **DST sanity**: weekly event shows same local time on the weeks either side of a DST change
