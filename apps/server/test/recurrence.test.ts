import { describe, expect, it } from "vitest";
import { expandOccurrences, withUntilBefore } from "../src/modules/calendar/recurrence.js";
import { utcOfWall, wallPartsOf } from "../src/core/tz.js";

const TZ = "America/New_York";
const wall = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  utcOfWall({ year: y, month: mo - 1, day: d, hour: h, minute: mi, second: 0 }, TZ);

describe("expandOccurrences", () => {
  it("returns a single occurrence for non-recurring events overlapping the window", () => {
    const start = wall(2026, 7, 20, 10);
    const spec = { startAt: start, endAt: start + 3600_000, timezone: TZ, rrule: null };
    expect(expandOccurrences(spec, wall(2026, 7, 19), wall(2026, 7, 21))).toHaveLength(1);
    expect(expandOccurrences(spec, wall(2026, 7, 21), wall(2026, 7, 22))).toHaveLength(0);
  });

  it("keeps weekly events at the same wall-clock time across the DST spring-forward", () => {
    // Mondays 9:00 America/New_York; US DST starts Sun 2026-03-08.
    const start = wall(2026, 2, 23, 9); // Mon Feb 23, EST (UTC-5)
    const spec = { startAt: start, endAt: start + 3600_000, timezone: TZ, rrule: "FREQ=WEEKLY" };
    const occurrences = expandOccurrences(spec, wall(2026, 2, 22), wall(2026, 3, 17));
    expect(occurrences).toHaveLength(4); // Feb 23, Mar 2, Mar 9, Mar 16

    for (const occ of occurrences) {
      const parts = wallPartsOf(occ.occurrenceStart, TZ);
      expect(parts.hour).toBe(9); // 9am local before AND after the shift
    }
    // The UTC instant must actually shift by an hour across the boundary.
    const beforeDst = occurrences[1]!.occurrenceStart; // Mar 2 (EST)
    const afterDst = occurrences[2]!.occurrenceStart; // Mar 9 (EDT)
    expect(afterDst - beforeDst).toBe(7 * 24 * 3600_000 - 3600_000);
  });

  it("drops cancelled occurrences and emits moved ones with overrides", () => {
    const start = wall(2026, 7, 6, 15); // Mon 3pm
    const spec = { startAt: start, endAt: start + 3600_000, timezone: TZ, rrule: "FREQ=WEEKLY" };
    const secondOccurrence = wall(2026, 7, 13, 15);
    const movedTo = wall(2026, 7, 14, 10);
    const occurrences = expandOccurrences(spec, wall(2026, 7, 5), wall(2026, 7, 27), [
      { occurrenceStart: secondOccurrence, kind: "cancelled", override: null },
      { occurrenceStart: wall(2026, 7, 20, 15), kind: "moved", override: { startAt: movedTo, title: "Moved!" } },
    ]);
    const starts = occurrences.map((o) => o.occurrenceStart);
    expect(starts).not.toContain(secondOccurrence);
    expect(starts).toContain(movedTo);
    const moved = occurrences.find((o) => o.occurrenceStart === movedTo)!;
    expect(moved.isException).toBe(true);
    expect(moved.override?.title).toBe("Moved!");
  });

  it("respects UNTIL set by withUntilBefore for this-and-future edits", () => {
    const start = wall(2026, 7, 6, 15);
    const cutoff = wall(2026, 7, 20, 15); // third occurrence
    const rrule = withUntilBefore("FREQ=WEEKLY", cutoff, TZ);
    const spec = { startAt: start, endAt: start + 3600_000, timezone: TZ, rrule };
    const occurrences = expandOccurrences(spec, wall(2026, 7, 1), wall(2026, 8, 15));
    expect(occurrences).toHaveLength(2); // Jul 6, Jul 13 — series ends before Jul 20
  });

  it("expands daily all-day events", () => {
    const start = wall(2026, 7, 1, 0);
    const spec = { startAt: start, endAt: start + 24 * 3600_000, timezone: TZ, rrule: "FREQ=DAILY;COUNT=5" };
    const occurrences = expandOccurrences(spec, wall(2026, 6, 30), wall(2026, 7, 10));
    expect(occurrences).toHaveLength(5);
  });
});
