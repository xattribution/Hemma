# @coord/plugin-sdk

The small, stable surface Coord plugins build against. Core features are
registered through the same interface, so nothing here is speculative.

## Anatomy of a plugin

A plugin is an object implementing `CoordPlugin`:

```ts
import type { CoordPlugin } from "@coord/plugin-sdk";

export const myPlugin: CoordPlugin = {
  id: "daily-quote",
  name: "Daily Quote",
  description: "A cheerful quote on the dashboard every day.",
  register(ctx) {
    // 1. Routes — namespaced under /api/p/<id>/
    ctx.app.get("/api/p/daily-quote/today", () => ({ quote: "..." }));

    // 2. React to family activity via the typed event bus
    ctx.bus.on("task.completed", ({ title, actor }) => {
      ctx.log(`${actor.name} finished ${title}`);
    });

    // 3. Background work
    ctx.scheduler.every("daily-quote.refresh", 3600, () => { /* ... */ });

    // 4. Persistent, namespaced settings
    ctx.settings.set("lastQuote", "...");

    // 5. Push real-time messages to connected clients
    ctx.broadcast({ type: "invalidate", keys: ["dashboard"] });
  },
};
```

Server plugins are listed in `apps/server/src/core/plugin-host.ts`.

## Frontend slots

The web app renders plugin UI through typed slots (`SlotId`):

- `dashboard.card` — a card on the kiosk dashboard
- `settings.section` — a panel in Settings
- `calendar.toolbar` — extra calendar controls
- `calendar.day-cell.overlay` — overlay per day cell (reserved for the drawable layer)
- `event.detail.section` — extra content in the event modal

Register components in `apps/web/src/plugins/registry.tsx`. Users can enable
or disable plugins from Settings → Plugins; disabled plugins render nothing.

## Where future capabilities plug in

| Capability | How it lands |
| --- | --- |
| AI assistant (local/API) | subscribes to bus, calls the same service functions core routes use, adds a `dashboard.card` + chat UI |
| Voice control | frontend capture → plugin route → intent parse → core services |
| Email → events | `scheduler.every` IMAP poll → AI extraction → creates events (parent approves) |
| Federation | bus events → outbound queue → paired instance's `/api/p/federation/inbox` |
| Google/Outlook sync | scheduler poll + bus subscribe, two-way mapping table in plugin settings |
| Drawable calendar | `calendar.day-cell.overlay` canvas keyed to the owned grid geometry |
