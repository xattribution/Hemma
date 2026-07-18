import type { CoreModule } from "../core/plugin-host.js";
import { requireActor } from "../core/auth.js";
import { actorOf } from "../core/actor.js";
import { recordAudit } from "../core/audit.js";

/**
 * One-click backup: the ENTIRE family — data and configuration — lives in
 * one SQLite file, so a backup is a byte-for-byte snapshot of it, streamed
 * to whatever device the parent is holding (or saved onto a NAS share).
 * Restore = stop the server, put the file back as coord.db, start.
 * better-sqlite3's serialize() snapshots safely while the DB is live.
 */
export const backupModule: CoreModule = {
  id: "core.backup",
  name: "Backup",
  description: "Download the whole household (data + settings) as one file.",
  register({ app, db }) {
    app.get("/api/backup", (req, reply) => {
      const access = requireActor(db, req, reply, "settings.manage");
      if (!access) return;
      const bytes = db.serialize();
      recordAudit(db, access.householdId, actorOf(access), "household", access.householdId, "update",
        `${access.name} downloaded a backup`);
      const stamp = new Date().toISOString().slice(0, 10);
      reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="coord-backup-${stamp}.db"`);
      return reply.send(bytes);
    });
  },
};
