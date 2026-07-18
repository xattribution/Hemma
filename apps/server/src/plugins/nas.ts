import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, requireActor } from "../core/auth.js";
import { parse } from "../core/http.js";

/**
 * NAS folder connector — photos (and, later, shared files) from a folder
 * the family already owns.
 *
 * Mounting is the HOST's job: mount the NFS/SMB share on the box (or let
 * the NAS run Sett itself) and bind it into the container, e.g.
 *     volumes:
 *       - /mnt/family-nas/coord:/nas
 * Then point this plugin at /nas. On first use Sett creates two folders:
 *     <root>/photos   — slideshow source (scanned recursively)
 *     <root>/files    — reserved for family file sharing (future; the
 *                       federation PTP channel will exchange from here)
 *
 * Asset ids are base64url relative paths, resolved strictly inside
 * <root>/photos — no traversal, no symlink escapes.
 */

const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
};

function listPhotos(photosRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return; // sanity bound for looped mounts
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (PHOTO_EXT.has(path.extname(entry.name).toLowerCase())) {
        found.push(path.relative(photosRoot, full));
      }
    }
  };
  walk(photosRoot, 0);
  found.sort(); // stable order so "in order" playback is deterministic
  return found;
}

export const nasPlugin: CoreModule = {
  id: "nas",
  name: "NAS folder",
  description: "Photos (and someday shared files) from a folder on your NAS.",
  optional: true,
  register({ app, db, settings, log }) {
    const root = () => settings.get<string>("root", "").replace(/\/+$/, "");
    const photosRoot = () => path.join(root(), "photos");

    // The photo list is rescanned lazily, at most once a minute.
    let cache: { at: number; photos: string[] } = { at: 0, photos: [] };
    const photos = () => {
      if (Date.now() - cache.at > 60_000) {
        cache = { at: Date.now(), photos: root() ? listPhotos(photosRoot()) : [] };
      }
      return cache.photos;
    };

    /** Create <root>/photos and <root>/files; returns a problem string or null. */
    function ensureFolders(): string | null {
      const base = root();
      if (!base) return "Set the NAS folder path first";
      try {
        if (!fs.existsSync(base)) return `${base} doesn't exist — is the share mounted into the container?`;
        fs.mkdirSync(path.join(base, "photos"), { recursive: true });
        fs.mkdirSync(path.join(base, "files"), { recursive: true });
        return null;
      } catch (err) {
        return `Can't write to ${base}: ${(err as Error).message}`;
      }
    }

    app.get("/api/p/nas/settings", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      return { root: root(), configured: !!root() };
    });

    app.post("/api/p/nas/settings", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const body = parse(z.object({ root: z.string().trim().max(300) }), req.body, reply);
      if (!body) return;
      settings.set("root", body.root.replace(/\/+$/, ""));
      cache = { at: 0, photos: [] };
      return { ok: true };
    });

    // Verify the mount, create photos/ + files/, report what's inside.
    app.post("/api/p/nas/test", (req, reply) => {
      if (!requireActor(db, req, reply, "settings.manage")) return;
      const problem = ensureFolders();
      if (problem) {
        reply.code(400).send({ error: problem });
        return;
      }
      cache = { at: 0, photos: [] };
      const fileCount = (() => {
        try {
          return fs.readdirSync(path.join(root(), "files")).filter((n) => !n.startsWith(".")).length;
        } catch {
          return 0;
        }
      })();
      return { ok: true, photoCount: photos().length, fileCount };
    });

    app.get("/api/p/nas/random", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const query = parse(z.object({
        count: z.coerce.number().int().min(1).max(100).default(20),
        order: z.enum(["shuffle", "seq"]).default("shuffle"),
        offset: z.coerce.number().int().min(0).default(0),
      }), req.query, reply);
      if (!query) return;
      if (!root()) {
        reply.code(400).send({ error: "The NAS folder isn't set up yet — add it in Settings" });
        return;
      }
      const all = photos();
      if (!all.length) {
        reply.code(404).send({ error: `No photos yet — drop some into ${photosRoot()}` });
        return;
      }
      const picked = query.order === "seq"
        ? Array.from({ length: Math.min(query.count, all.length) }, (_, i) => all[(query.offset + i) % all.length]!)
        : [...all].sort(() => Math.random() - 0.5).slice(0, query.count);
      return {
        assets: picked.map((rel) => ({ id: Buffer.from(rel).toString("base64url") })),
        total: all.length,
      };
    });

    app.get("/api/p/nas/asset/:id", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const { id } = req.params as { id: string };
      let rel: string;
      try {
        rel = Buffer.from(id, "base64url").toString();
      } catch {
        reply.code(400).send({ error: "Bad asset id" });
        return;
      }
      // Resolve strictly inside photos/ — reject traversal & absolute paths.
      const base = photosRoot();
      const full = path.resolve(base, rel);
      if (!full.startsWith(path.resolve(base) + path.sep) && full !== path.resolve(base)) {
        reply.code(400).send({ error: "Bad asset id" });
        return;
      }
      const ext = path.extname(full).toLowerCase();
      if (!PHOTO_EXT.has(ext) || !fs.existsSync(full)) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply
        .header("content-type", MIME[ext] ?? "application/octet-stream")
        .header("cache-control", "private, max-age=3600");
      return reply.send(fs.createReadStream(full));
    });

    log("nas: folder connector ready (configure under Settings → Photos)");
  },
};
