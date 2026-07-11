import { describe, expect, it, vi } from "vitest";
import { createBus } from "../src/core/bus.js";

const actor = { memberId: "m1", name: "Test" };

describe("event bus", () => {
  it("delivers payloads to subscribers and supports unsubscribe", () => {
    const bus = createBus();
    const seen: string[] = [];
    const off = bus.on("task.completed", (p) => seen.push(p.title));
    bus.emit("task.completed", { taskId: "t1", title: "Dishes", occurrenceDate: null, actor });
    off();
    bus.emit("task.completed", { taskId: "t1", title: "Dishes again", occurrenceDate: null, actor });
    expect(seen).toEqual(["Dishes"]);
  });

  it("isolates handler errors so one bad plugin can't break others", () => {
    const onError = vi.fn();
    const bus = createBus(onError);
    const seen: string[] = [];
    bus.on("event.created", () => {
      throw new Error("boom");
    });
    bus.on("event.created", (p) => seen.push(p.title));
    bus.emit("event.created", { eventId: "e1", title: "Party", actor });
    expect(seen).toEqual(["Party"]);
    expect(onError).toHaveBeenCalledOnce();
  });
});
