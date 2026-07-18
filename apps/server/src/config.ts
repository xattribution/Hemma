import fs from "node:fs";
import path from "node:path";

/** The released Hemma version. Stamped into the root package.json by
    scripts/release.sh; the standalone bundles ship a package.json next to
    server.mjs. Dev checkouts show whatever was released last. */
function readVersion(): string {
  for (const candidate of [
    path.resolve("../../package.json"), // dev + Docker (cwd = apps/server → repo root)
    path.resolve("package.json"), // standalone bundle (cwd = bundle dir)
  ]) {
    try {
      const version = (JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string }).version;
      if (version && /^\d/.test(version)) return version;
    } catch {
      /* try the next candidate */
    }
  }
  return "dev";
}

export const config = {
  version: process.env.HEMMA_VERSION ?? readVersion(),
  // High default to stay clear of commonly-used dev ports (3000 etc.).
  port: Number(process.env.PORT ?? 49733),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data/coord.db"),
  /** Directory of the built web app; served when present. */
  webDist: process.env.WEB_DIST ?? path.resolve("../web/dist"),
  sessionDays: 90,
};
