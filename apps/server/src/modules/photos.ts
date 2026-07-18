import crypto from "node:crypto";
import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { INTERNAL_TOKEN } from "../core/internal.js";
import { parse } from "../core/http.js";
import { now } from "../core/db.js";

/**
 * The one photo tap every slideshow drinks from. A household picks its
 * source (Immich server or NAS folder — Google Photos reserved for a
 * future integration) and every consumer (display photo layout, in-app
 * slideshow/screensaver) talks to these endpoints; they redirect to the
 * chosen backend so the plugins stay decoupled.
 *
 * This module also carries the conversational layer:
 * - every slideshow reports what it's showing → GET /api/photos/current
 *   lets an AI answer "what's on the kitchen display?" and act on it
 * - POST /api/photos/share mints a public, expiring link (+QR in the UI)
 *   for "share this photo" — streamed without auth via a random token.
 */

const SHARE_TTL = 7 * 24 * 3600_000;

export const photosModule: CoreModule = {
  id: "core.photos",
  name: "Photo source",
  description: "Which photo library slideshows use: Immich or a NAS folder.",
  register({ app, db, settings, broadcast }) {
    const source = () => settings.get<"none" | "immich" | "nas">("source", "none");
    const backend = (kind: "immich" | "nas") => ({
      random: `/api/p/${kind}/random`,
      asset: (id: string) => `/api/p/${kind}/asset/${id}`,
    });

    /** What each screen is showing right now (RAM; stale after 3 min). */
    const nowShowing = new Map<string, { screen: string; kind: string; assetId: string; at: number }>();
    /** Public share links: token → asset (RAM; links survive until restart/expiry). */
    const shares = new Map<string, { source: "immich" | "nas"; assetId: string; expires: number }>();

    app.get("/api/photos/source", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      return {
        source: source(),
        // Google Photos: planned alongside Google Calendar sync.
        options: [
          { id: "immich", label: "Immich" },
          { id: "nas", label: "NAS folder" },
          { id: "google", label: "Google Photos", comingSoon: true },
        ],
      };
    });

    app.post("/api/photos/source", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const body = parse(z.object({ source: z.enum(["none", "immich", "nas"]) }), req.body, reply);
      if (!body) return;
      settings.set("source", body.source);
      broadcast({ type: "invalidate", keys: ["me"] }); // photo-layout displays re-check
      return { ok: true };
    });

    app.get("/api/photos/random", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const kind = source();
      if (kind === "none") {
        reply.code(400).send({ error: "Pick a photo source under Settings → Photos first" });
        return;
      }
      const q = req.query as { count?: string; order?: string; offset?: string };
      const params = new URLSearchParams();
      if (q.count) params.set("count", q.count);
      if (q.order) params.set("order", q.order);
      if (q.offset) params.set("offset", q.offset);
      const qs = params.toString();
      return reply.redirect(`${backend(kind).random}${qs ? `?${qs}` : ""}`, 307);
    });

    app.get("/api/photos/asset/:id", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const kind = source();
      if (kind === "none") {
        reply.code(400).send({ error: "No photo source configured" });
        return;
      }
      return reply.redirect(backend(kind).asset(encodeURIComponent((req.params as { id: string }).id)), 307);
    });

    // ---------- "now showing" (the AI-readable layer) ----------

    // Slideshows call this as they rotate; keyed by who/what is showing it.
    app.post("/api/photos/current", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const body = parse(z.object({ assetId: z.string().min(1).max(300) }), req.body, reply);
      if (!body) return;
      nowShowing.set(`${access.kind}:${access.name}`, {
        screen: access.name, kind: access.kind, assetId: body.assetId, at: now(),
      });
      return { ok: true };
    });

    // "What's on the kitchen display?" — fresh entries only.
    app.get("/api/photos/current", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const fresh = [...nowShowing.values()].filter((entry) => now() - entry.at < 3 * 60_000);
      return {
        screens: fresh.map((entry) => ({
          screen: entry.screen,
          kind: entry.kind, // 'device' = a wall display, 'member' = someone's app
          assetId: entry.assetId,
          assetUrl: `/api/photos/asset/${encodeURIComponent(entry.assetId)}`,
          secondsAgo: Math.round((now() - entry.at) / 1000),
        })),
      };
    });

    // ---------- public share links ----------

    app.post("/api/photos/share", (req, reply) => {
      const access = requireAccess(db, req, reply);
      if (!access) return;
      const kind = source();
      if (kind === "none") {
        reply.code(400).send({ error: "No photo source configured" });
        return;
      }
      const body = parse(z.object({ assetId: z.string().min(1).max(300) }), req.body, reply);
      if (!body) return;
      // prune + mint
      for (const [token, share] of shares) if (share.expires < now()) shares.delete(token);
      const token = crypto.randomBytes(16).toString("base64url");
      shares.set(token, { source: kind, assetId: body.assetId, expires: now() + SHARE_TTL });
      return { token, url: `${req.protocol}://${req.headers.host}/shared/photo/${token}`, expiresDays: 7 };
    });

    // No auth: the token IS the credential (128-bit, 7-day expiry, RAM-only —
    // links die at restart, which suits a "here, grandma" share fine).
    app.get("/shared/photo/:token", async (req, reply) => {
      const share = shares.get((req.params as { token: string }).token);
      if (!share || share.expires < now()) {
        reply.code(404).send("This photo link has expired.");
        return;
      }
      const res = await app.inject({
        method: "GET",
        url: `/api/p/${share.source}/asset/${encodeURIComponent(share.assetId)}`,
        headers: { "x-coord-internal": INTERNAL_TOKEN },
      });
      if (res.statusCode !== 200) {
        reply.code(404).send("This photo isn't available any more.");
        return;
      }
      reply
        .header("content-type", res.headers["content-type"] ?? "image/jpeg")
        .header("cache-control", "public, max-age=3600");
      return reply.send(res.rawPayload);
    });
  },
};
