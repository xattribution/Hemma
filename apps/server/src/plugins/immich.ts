import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { parse } from "../core/http.js";

/**
 * Immich connector — points Coord at the family's own Immich photo server.
 *
 * The server proxies everything: the API key never reaches a browser, and
 * displays (which hold no member credentials) can still pull photos. Two
 * consumer endpoints keep it simple:
 *   GET /api/p/immich/random?count=20   → { assets: [{ id }] }
 *   GET /api/p/immich/asset/:id         → the image bytes (preview size)
 *
 * Immich's API has moved over the years (server-info → server, GET
 * assets/random → POST search/random) — every call tries current-then-legacy
 * so families on older Immich versions still work.
 */
export const immichPlugin: CoreModule = {
  id: "immich",
  name: "Photos (Immich)",
  description: "Family photo slideshows on displays, straight from your own Immich server.",
  optional: true,
  register({ app, db, settings, log }) {
    const config = () => ({
      url: settings.get<string>("url", "").replace(/\/$/, ""),
      apiKey: settings.get<string>("apiKey", ""),
      albumId: settings.get<string>("albumId", ""),
    });

    async function immich(pathname: string, init?: { method?: string; body?: unknown }): Promise<Response> {
      const { url, apiKey } = config();
      if (!url || !apiKey) {
        throw Object.assign(new Error("Immich isn't set up yet — add the server address and API key in Settings"), { statusCode: 400 });
      }
      return fetch(`${url}/api${pathname}`, {
        method: init?.method ?? "GET",
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
          ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    }

    const NOT_CONFIGURED = "Immich isn't set up yet — add the server address and API key in Settings";
    const configured = () => {
      const { url, apiKey } = config();
      return !!(url && apiKey);
    };

    /** Try endpoints in order until one answers 2xx (Immich API drift). */
    async function firstOk(attempts: (() => Promise<Response>)[]): Promise<Response | null> {
      for (const attempt of attempts) {
        try {
          const res = await attempt();
          if (res.ok) return res;
        } catch {
          // network-level failure — try the next shape
        }
      }
      return null;
    }

    // ---------- settings (parents only; the key never leaves the server) ----------

    app.get("/api/p/immich/settings", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const { url, apiKey, albumId } = config();
      return { url, albumId, configured: !!(url && apiKey) };
    });

    app.post("/api/p/immich/settings", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const body = parse(
        z.object({
          url: z.string().url().max(200).or(z.literal("")).optional(),
          apiKey: z.string().max(200).optional(), // omitted = keep current
          albumId: z.string().max(100).optional(),
        }),
        req.body, reply,
      );
      if (!body) return;
      if (body.url !== undefined) settings.set("url", body.url);
      if (body.apiKey !== undefined && body.apiKey !== "") settings.set("apiKey", body.apiKey);
      if (body.albumId !== undefined) settings.set("albumId", body.albumId);
      return { ok: true };
    });

    // "Does it work?" — ping + server version, friendly errors.
    app.post("/api/p/immich/test", async (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      if (!configured()) {
        reply.code(400).send({ error: NOT_CONFIGURED });
        return;
      }
      const ping = await firstOk([() => immich("/server/ping"), () => immich("/server-info/ping")]);
      if (!ping) {
        reply.code(502).send({ error: "Couldn't reach Immich — check the address and API key" });
        return;
      }
      const about = await firstOk([() => immich("/server/about"), () => immich("/server-info/version")]);
      const info = about ? ((await about.json().catch(() => ({}))) as { version?: string }) : {};
      return { ok: true, version: info.version ?? "unknown" };
    });

    // List albums so the family can pick one for the slideshow.
    app.get("/api/p/immich/albums", async (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      if (!configured()) {
        reply.code(400).send({ error: NOT_CONFIGURED });
        return;
      }
      const res = await firstOk([() => immich("/albums"), () => immich("/album")]);
      if (!res) {
        reply.code(502).send({ error: "Couldn't reach Immich" });
        return;
      }
      const albums = (await res.json()) as { id: string; albumName: string; assetCount: number }[];
      return { albums: albums.map((a) => ({ id: a.id, name: a.albumName, count: a.assetCount })) };
    });

    // ---------- photos (any signed-in principal, displays included) ----------

    app.get("/api/p/immich/random", async (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      if (!configured()) {
        reply.code(400).send({ error: NOT_CONFIGURED });
        return;
      }
      const query = parse(z.object({
        count: z.coerce.number().int().min(1).max(100).default(20),
        // "in order" works when an album is chosen (albums have an order);
        // server-wide random has none, so seq quietly falls back to shuffle.
        order: z.enum(["shuffle", "seq"]).default("shuffle"),
        offset: z.coerce.number().int().min(0).default(0),
      }), req.query, reply);
      if (!query) return;
      const { albumId } = config();

      let ids: string[] = [];
      if (albumId) {
        const res = await firstOk([() => immich(`/albums/${albumId}`), () => immich(`/album/${albumId}`)]);
        if (res) {
          const album = (await res.json()) as { assets?: { id: string; type: string }[] };
          ids = (album.assets ?? []).filter((a) => a.type === "IMAGE").map((a) => a.id);
          if (query.order === "seq" && ids.length) {
            ids = Array.from({ length: Math.min(query.count, ids.length) }, (_, i) => ids[(query.offset + i) % ids.length]!);
          } else {
            ids.sort(() => Math.random() - 0.5);
            ids = ids.slice(0, query.count);
          }
        }
      } else {
        const res = await firstOk([
          () => immich("/search/random", { method: "POST", body: { size: query.count, type: "IMAGE" } }),
          () => immich(`/assets/random?count=${query.count}`),
          () => immich(`/asset/random?count=${query.count}`),
        ]);
        if (res) {
          const assets = (await res.json()) as { id: string; type?: string }[];
          ids = assets.filter((a) => (a.type ?? "IMAGE") === "IMAGE").map((a) => a.id);
        }
      }
      if (!ids.length) {
        reply.code(502).send({ error: "No photos came back from Immich" });
        return;
      }
      return { assets: ids.map((id) => ({ id })) };
    });

    // Stream one photo (preview-sized) through the server.
    app.get("/api/p/immich/asset/:id", async (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      if (!configured()) {
        reply.code(400).send({ error: NOT_CONFIGURED });
        return;
      }
      const { id } = req.params as { id: string };
      if (!/^[0-9a-f-]{10,60}$/i.test(id)) {
        reply.code(400).send({ error: "Bad asset id" });
        return;
      }
      const res = await firstOk([
        () => immich(`/assets/${id}/thumbnail?size=preview`),
        () => immich(`/asset/thumbnail/${id}?format=JPEG`),
      ]);
      if (!res) {
        reply.code(502).send({ error: "Couldn't fetch that photo" });
        return;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      reply
        .header("content-type", res.headers.get("content-type") ?? "image/jpeg")
        .header("cache-control", "private, max-age=3600");
      return reply.send(bytes);
    });

    log("immich: connector ready (configure under Settings → Photos)");
  },
};
