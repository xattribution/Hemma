import type { FastifyInstance } from "fastify";
import type { EventBus, Scheduler, SettingsStore } from "@coord/plugin-sdk";
import type { WsServerMessage } from "@coord/shared";
import type { Db } from "./db.js";
import { settingsFor } from "./settings.js";

/** Context handed to core modules — same shape as the SDK's PluginContext, concretely typed. */
export interface CoreContext {
  app: FastifyInstance;
  db: Db;
  bus: EventBus;
  scheduler: Scheduler;
  settings: SettingsStore;
  broadcast: (msg: WsServerMessage) => void;
  log: (msg: string) => void;
}

export interface CoreModule {
  id: string;
  name: string;
  description?: string;
  /** Core modules are always on; optional plugins can be toggled in Settings. */
  optional?: boolean;
  register(ctx: CoreContext): void | Promise<void>;
}

export interface PluginHost {
  registered: { id: string; name: string; description: string; optional: boolean }[];
  isEnabled(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
}

export async function registerModules(
  base: Omit<CoreContext, "settings">,
  modules: CoreModule[],
): Promise<PluginHost> {
  const hostSettings = settingsFor(base.db, "core.plugin-host");

  const host: PluginHost = {
    registered: modules.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? "",
      optional: m.optional ?? false,
    })),
    isEnabled(id) {
      const module = modules.find((m) => m.id === id);
      if (!module?.optional) return true;
      return hostSettings.get(`enabled.${id}`, true);
    },
    setEnabled(id, enabled) {
      hostSettings.set(`enabled.${id}`, enabled);
    },
  };

  for (const module of modules) {
    await module.register({ ...base, settings: settingsFor(base.db, module.id) });
    base.log(`plugin registered: ${module.id}`);
  }

  // Bridge: domain events → thin cache-invalidation broadcasts.
  const invalidate = (keys: Parameters<typeof invalidateMsg>[0]) => base.broadcast(invalidateMsg(keys));
  base.bus.on("event.created", () => invalidate(["events", "dashboard", "audit"]));
  base.bus.on("event.updated", () => invalidate(["events", "dashboard", "audit"]));
  base.bus.on("event.deleted", () => invalidate(["events", "dashboard", "audit"]));
  base.bus.on("task.created", () => invalidate(["tasks", "dashboard", "audit"]));
  base.bus.on("task.completed", () => invalidate(["tasks", "dashboard", "audit"]));
  base.bus.on("task.reassigned", () => invalidate(["tasks", "dashboard", "audit"]));
  base.bus.on("checklist.item.checked", () => invalidate(["checklists", "dashboard", "audit"]));
  base.bus.on("member.updated", () => invalidate(["members", "dashboard"]));

  return host;
}

function invalidateMsg(keys: ("events" | "tasks" | "checklists" | "members" | "dashboard" | "audit")[]): WsServerMessage {
  return { type: "invalidate", keys };
}
