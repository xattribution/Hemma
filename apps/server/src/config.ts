import path from "node:path";

export const config = {
  // High default to stay clear of commonly-used dev ports (3000 etc.).
  port: Number(process.env.PORT ?? 49733),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data/coord.db"),
  /** Directory of the built web app; served when present. */
  webDist: process.env.WEB_DIST ?? path.resolve("../web/dist"),
  sessionDays: 90,
};
