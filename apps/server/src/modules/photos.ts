import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { parse } from "../core/http.js";

/**
 * The one photo tap every slideshow drinks from. A household picks its
 * source (Immich server or NAS folder — Google Photos reserved for a
 * future integration) and every consumer (display photo layout, in-app
 * slideshow/screensaver) talks to these two endpoints; they redirect to
 * the chosen backend so the plugins stay decoupled.
 */
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
      const q = (req.query as { count?: string }).count;
      return reply.redirect(`${backend(kind).random}${q ? `?count=${encodeURIComponent(q)}` : ""}`, 307);
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
  },
};
