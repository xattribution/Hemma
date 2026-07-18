import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { openDb, type Db } from "./core/db.js";
import { createBus } from "./core/bus.js";
import { createScheduler } from "./core/scheduler.js";
import { createWsHub } from "./core/ws.js";
import { registerModules, type CoreModule } from "./core/plugin-host.js";
import { requireAccess, requireActor, sessionOf, SESSION_COOKIE, lookupSession } from "./core/auth.js";
import { parse } from "./core/http.js";
import { authModule } from "./modules/auth.js";
import { membersModule } from "./modules/members.js";
import { calendarModule } from "./modules/calendar/index.js";
import { tasksModule } from "./modules/tasks.js";
import { checklistsModule } from "./modules/checklists.js";
import { remindersModule } from "./modules/reminders.js";
import { dashboardModule } from "./modules/dashboard.js";
import { auditModule } from "./modules/audit.js";
import { integrationsModule } from "./modules/integrations.js";
import { federationModule } from "./modules/federation.js";
import { pointsModule } from "./modules/points.js";
import { backupModule } from "./modules/backup.js";
import { subscriptionsModule } from "./modules/subscriptions.js";
import { photosModule } from "./modules/photos.js";
import { nasPlugin } from "./plugins/nas.js";
import { dailyQuotePlugin } from "./plugins/daily-quote.js";
import { immichPlugin } from "./plugins/immich.js";

export interface BuildOptions {
  dbPath: string;
  webDist?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildOptions): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(options.dbPath);
  // trustProxy: honour X-Forwarded-Proto/Host from the family's reverse proxy
  // (Nginx Proxy Manager etc.) — federation builds its reply URLs from them.
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });
  await app.register(cookie);
  await app.register(websocket);
  // Raw uploads (family-to-family file sends) arrive as octet-stream buffers.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  const log = (msg: string) => app.log.info(msg);
  const bus = createBus((event, err) => app.log.error({ err }, `bus handler for ${event} failed`));
  const scheduler = createScheduler(log);
  const hub = createWsHub();

  app.addHook("onClose", async () => {
    scheduler.stop();
    db.close();
  });

  // Service-thrown errors carry statusCode; everything else is a 500.
  app.setErrorHandler((err, _req, reply) => {
    const error = err as { statusCode?: number; message?: string };
    const status = error.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: status >= 500 ? "Something went wrong" : (error.message ?? "Error") });
  });

  app.get("/api/health", () => ({ ok: true, version: config.version }));

  app.get("/api/ws", { websocket: true }, (socket, req) => {
    if (!lookupSession(db, req.cookies[SESSION_COOKIE])) {
      socket.close(4001, "unauthorized");
      return;
    }
    hub.add(socket);
    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") socket.send(JSON.stringify({ type: "hello", onlineCount: hub.size }));
      } catch {
        // ignore malformed frames
      }
    });
  });

  const modules: CoreModule[] = [
    authModule,
    membersModule,
    calendarModule,
    tasksModule,
    checklistsModule,
    remindersModule,
    dashboardModule,
    auditModule,
    integrationsModule,
    federationModule,
    pointsModule,
    backupModule,
    subscriptionsModule,
    photosModule,
    dailyQuotePlugin,
    immichPlugin,
    nasPlugin,
  ];
  const host = await registerModules(
    { app, db, bus, scheduler, broadcast: (msg) => hub.broadcast(msg), log },
    modules,
  );

  app.get("/api/plugins", (req, reply) => {
    if (!requireAccess(db, req, reply)) return;
    return {
      plugins: host.registered.map((p) => ({ ...p, enabled: host.isEnabled(p.id) })),
    };
  });

  app.post("/api/plugins/:id/enabled", (req, reply) => {
    if (!requireActor(db, req, reply, "settings.manage")) return;
    const body = parse(z.object({ enabled: z.boolean() }), req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const plugin = host.registered.find((p) => p.id === id);
    if (!plugin?.optional) {
      reply.code(400).send({ error: "This plugin can't be turned off" });
      return;
    }
    host.setEnabled(id, body.enabled);
    hub.broadcast({ type: "invalidate", keys: ["dashboard"] });
    return { ok: true };
  });

  // Serve the built PWA when present (production); SPA fallback for app routes.
  if (options.webDist && fs.existsSync(path.join(options.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: options.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  return { app, db };
}
