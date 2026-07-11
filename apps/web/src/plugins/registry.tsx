import type { ComponentType } from "react";
import type { SlotId } from "@coord/plugin-sdk";
import { usePlugins } from "../api/queries";
import { DailyQuoteCard } from "./daily-quote";

/**
 * Frontend plugin registry: plugins contribute components to typed slots and
 * core pages render them via <PluginSlot>. Disabled plugins render nothing.
 */
interface FrontendPlugin {
  id: string;
  slots: Partial<Record<SlotId, ComponentType>>;
}

const plugins: FrontendPlugin[] = [];

export function registerPlugin(plugin: FrontendPlugin) {
  plugins.push(plugin);
}

export function PluginSlot({ slot }: { slot: SlotId }) {
  const { data: serverPlugins } = usePlugins();
  const enabled = new Set(serverPlugins?.filter((p) => p.enabled).map((p) => p.id));
  return (
    <>
      {plugins
        .filter((p) => enabled.has(p.id) && p.slots[slot])
        .map((p) => {
          const Component = p.slots[slot]!;
          return <Component key={`${p.id}:${slot}`} />;
        })}
    </>
  );
}

// ---- Built-in plugins ----
registerPlugin({ id: "daily-quote", slots: { "dashboard.card": DailyQuoteCard } });
