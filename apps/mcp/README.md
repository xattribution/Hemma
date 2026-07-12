# @coord/mcp — the HAL hookup

An MCP (Model Context Protocol) server that lets AI assistants — Claude
Desktop, Claude Code, or anything MCP-compatible — read and manage your
family's Coord instance: events, chores (including swapping them), shopping
lists with store tags and need-by dates, search, and the history feed.

Everything the assistant does is attributed to its token label in History
("HAL added Eggs (Costco) to Groceries").

## Setup

1. In Coord: **Settings → AI & API access → Connect** (e.g. label it `HAL`),
   copy the token.
2. Register the server with your MCP client. For Claude Code:

```bash
claude mcp add coord \
  --env COORD_URL=https://your-coord-server \
  --env COORD_TOKEN=coord_xxxxxxxx \
  -- pnpm --dir /path/to/coord/apps/mcp start
```

For Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "coord": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/coord/apps/mcp", "start"],
      "env": {
        "COORD_URL": "https://your-coord-server",
        "COORD_TOKEN": "coord_xxxxxxxx"
      }
    }
  }
}
```

3. Ask things like:
   - "Add soccer practice every Wednesday at 5pm for Leo, remind us an hour before"
   - "I need to get eggs from Costco tomorrow"
   - "Swap Mia's dishes chore to Leo"
   - "What's on the family calendar this weekend?"
   - "Is milk already on the grocery list?"

## Not using MCP?

Any HTTP client works — the same bearer token drives the plain REST API,
documented for LLMs at `GET /llms.txt` on your Coord server. Point a custom
agent, a Home Assistant automation, or a shell script at it.

## Tools

`get_overview`, `search`, `get_history`, `list_events`, `create_event`,
`update_event`, `delete_event`, `list_tasks`, `create_task`, `complete_task`,
`reassign_task`, `list_checklists`, `create_checklist`, `update_checklist`,
`add_list_item`, `update_list_item`, `toggle_list_item`.
