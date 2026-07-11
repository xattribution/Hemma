import type { SettingsStore } from "@coord/plugin-sdk";
import type { Db } from "./db.js";

export function settingsFor(db: Db, pluginId: string): SettingsStore {
  return {
    get<T>(key: string, fallback: T): T {
      const row = db
        .prepare("SELECT value_json FROM plugin_settings WHERE plugin_id = ? AND key = ?")
        .get(pluginId, key) as { value_json: string } | undefined;
      return row ? (JSON.parse(row.value_json) as T) : fallback;
    },
    set(key, value) {
      db.prepare(
        `INSERT INTO plugin_settings (plugin_id, key, value_json) VALUES (?, ?, ?)
         ON CONFLICT (plugin_id, key) DO UPDATE SET value_json = excluded.value_json`,
      ).run(pluginId, key, JSON.stringify(value));
    },
  };
}
