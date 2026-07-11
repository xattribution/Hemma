import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data/coord.db"),
  /** Directory of the built web app; served when present. */
  webDist: process.env.WEB_DIST ?? path.resolve("../web/dist"),
  sessionDays: 90,
};
