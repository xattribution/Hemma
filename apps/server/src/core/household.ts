import type { Db } from "./db.js";

export interface HouseholdRow {
  id: string;
  name: string;
  timezone: string;
}

/** Single-household instance: the one row, or null before first-run setup. */
export function getHousehold(db: Db): HouseholdRow | null {
  return (db.prepare("SELECT id, name, timezone FROM households LIMIT 1").get() as HouseholdRow | undefined) ?? null;
}
