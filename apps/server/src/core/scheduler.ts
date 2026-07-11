import type { Scheduler } from "@coord/plugin-sdk";

export function createScheduler(log: (msg: string) => void): Scheduler & { stop: () => void } {
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    every(name, seconds, fn) {
      const run = async () => {
        try {
          await fn();
        } catch (err) {
          log(`scheduler job "${name}" failed: ${String(err)}`);
        }
      };
      const timer = setInterval(run, seconds * 1000);
      timer.unref?.();
      timers.set(name, timer);
      void run(); // run once at startup so restarts catch up promptly
      return () => {
        clearInterval(timer);
        timers.delete(name);
      };
    },
    stop() {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    },
  };
}
