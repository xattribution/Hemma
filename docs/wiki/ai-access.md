# AI & API access

**Module:** `apps/server/src/modules/integrations.ts` (tokens, search,
devices) + `modules/ai-instructions.ts` (/llms.txt)
**MCP:** `apps/mcp` — @modelcontextprotocol/sdk server wrapping REST
**UI:** Settings → AI & API access (AiAccessSection).

## Model

Bearer tokens (`api_tokens` table) created by parents; each has a label
("HAL", "Home Assistant") used for attribution in the audit log. Agents act
with **full parent-level authority** — the trust decision is made when a
parent mints the token. Tokens are retrievable in settings and revocable.

## The contract: /llms.txt

`GET /llms.txt` (and `/api/llms.txt`) serves `AI_INSTRUCTIONS` — the
complete REST how-to tailored for LLM clients: auth, conventions
(UTC ms, RRULE, household timezone), discovery endpoints, calendar CRUD
with scoped recurring edits, chores incl. **steps** and per-occurrence
completion, lists (running/dated/event-linked/meal + stores + alsoGrocery),
federation share/revoke/send-event, and behavior rules (resolve names→ids,
dedupe before adding, read-before-answer, destructive ops only on request).
**Keep it in sync when routes change — it is a contract, not documentation
prose.** It intentionally omits builder-facing internals (this wiki's job)
and irrelevant surfaces (photos slideshow).

## MCP server

`apps/mcp` exposes ~25 tools (get_today, search, list/create/update/delete
events incl. scope, complete/reassign tasks, toggle steps, list CRUD,
clear_checked_items, stores, federation share/revoke/send_event, members,
audit). Config: `COORD_URL` + `COORD_TOKEN` env. Claude Desktop snippet in
`apps/mcp/README.md`. Tools call the same REST API — no privileged path.

## Search

`GET /api/search?q=` spans events (incl. recurring titles), tasks, list
items (text OR store tag), audit summaries — the "does this exist already"
primitive for agents.

## Pending / gaps

- MCP has no Immich/photos tools (deliberate — nothing an agent needs).
- No per-token permission scoping (all tokens are parent-level; scoping is
  a future need if families want read-only agents).
- No webhook/event push for agents; they poll or use MCP interactively.
