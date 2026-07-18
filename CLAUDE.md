# Sett — context for AI/dev sessions

**The app is named Sett** (a sett is a badger family's den — the owner's
domain is tinbadger.com). **It was originally called Coord, then briefly
Hemma** (dropped after a name collision with a Home Assistant tool), and
every *internal* identifier still uses the FIRST name on purpose:

- packages `@coord/*` (`@coord/server`, `@coord/web`, `@coord/shared`,
  `@coord/shell`, `@coord/mcp`, `@coord/plugin-sdk`)
  (the GitHub repo itself WAS renamed — it's `xattribution/Sett` now, old
  `xattribution/coord` URLs redirect; the container image is
  `ghcr.io/xattribution/sett`)
- database file `coord.db`, Docker volume `coord-data`
- session cookie `coord_session`, browser storage keys `coord.*`
- env vars `COORD_URL` / `COORD_TOKEN` (MCP), Rust crate `coord-shell`

Do NOT "helpfully" rename these when applying updates — renaming them logs
families out, orphans their data, or breaks their MCP configs. Only
**user-visible surfaces** carry the Sett name (PWA title/manifest, UI copy,
native shell productName/identifier, /llms.txt, README, docs). If you see
"Coord" in an internal identifier, that is correct and intentional; if you
see it in user-facing copy, it's a leftover — rebrand it to Sett.

## Start here

- `docs/wiki/README.md` — full architecture handoff (written so a fresh
  agent can work with zero prior context), one page per module, plus
  `docs/wiki/gaps.md` (the honest register of unfinished work).
- Working branch: `claude/family-coordination-calendar-bs4zqo`.
- Tests: `pnpm --filter @coord/server test` · typecheck: `pnpm -r typecheck`
  · seed demo data: `pnpm --filter @coord/server seed`.
- Design rules (color roles, squared structure, kid-app exemptions) live in
  `docs/wiki/frontend.md` — follow them for any UI change.
