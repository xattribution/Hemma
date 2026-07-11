import type { CoordEventName, CoordEvents, EventBus } from "@coord/plugin-sdk";

export function createBus(onError?: (event: string, err: unknown) => void): EventBus {
  const handlers = new Map<CoordEventName, Set<(payload: never) => void>>();

  return {
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) {
        try {
          (handler as (p: CoordEvents[typeof event]) => void)(payload);
        } catch (err) {
          onError?.(event, err);
        }
      }
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as (payload: never) => void);
      return () => set.delete(handler as (payload: never) => void);
    },
  };
}
