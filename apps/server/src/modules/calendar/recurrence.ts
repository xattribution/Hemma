// rrule is CJS-only; the interop default import works under both Node (tsx) and Vitest.
import rrulePkg from "rrule";
import { fromFakeUtc, toFakeUtc } from "../../core/tz.js";

const { RRule } = rrulePkg;

/**
 * Recurrence expansion.
 *
 * RRULEs are iterated in the event's own wall-clock time ("fake UTC": local
 * components re-encoded as UTC — the rrule library's supported pattern), and
 * each occurrence is then converted back to a real UTC instant via the
 * event's IANA timezone. This keeps a 7am school run at 7am across DST
 * shifts. Stored UNTIL values are therefore also in fake-UTC wall time.
 */

export interface RecurringSpec {
  startAt: number;
  endAt: number;
  timezone: string;
  rrule: string | null;
}

export interface ExceptionSpec {
  occurrenceStart: number;
  kind: "cancelled" | "moved";
  override: Record<string, unknown> | null;
}

export interface Occurrence {
  occurrenceStart: number;
  occurrenceEnd: number;
  isException: boolean;
  override: Record<string, unknown> | null;
}

const WINDOW_PAD_MS = 48 * 3600_000; // covers any UTC-offset skew, filtered after conversion

export function expandOccurrences(
  spec: RecurringSpec,
  windowStart: number,
  windowEnd: number,
  exceptions: ExceptionSpec[] = [],
): Occurrence[] {
  const duration = Math.max(0, spec.endAt - spec.startAt);
  const overlaps = (start: number, end: number) => start < windowEnd && end > windowStart;
  const out: Occurrence[] = [];

  if (!spec.rrule) {
    if (overlaps(spec.startAt, Math.max(spec.endAt, spec.startAt + 1))) {
      out.push({ occurrenceStart: spec.startAt, occurrenceEnd: spec.endAt, isException: false, override: null });
    }
    return out;
  }

  const byStart = new Map(exceptions.map((e) => [e.occurrenceStart, e]));
  const rule = new RRule({
    ...RRule.parseString(spec.rrule),
    dtstart: toFakeUtc(spec.startAt, spec.timezone),
  });

  const fakeOccurrences = rule.between(
    new Date(toFakeUtc(windowStart, spec.timezone).getTime() - duration - WINDOW_PAD_MS),
    new Date(toFakeUtc(windowEnd, spec.timezone).getTime() + WINDOW_PAD_MS),
    true,
  );

  for (const fake of fakeOccurrences) {
    const start = fromFakeUtc(fake, spec.timezone);
    const end = start + duration;
    const exception = byStart.get(start);
    if (exception) continue; // cancelled → dropped; moved → emitted below
    if (overlaps(start, Math.max(end, start + 1))) {
      out.push({ occurrenceStart: start, occurrenceEnd: end, isException: false, override: null });
    }
  }

  for (const exception of exceptions) {
    if (exception.kind !== "moved") continue;
    const start = (exception.override?.startAt as number | undefined) ?? exception.occurrenceStart;
    const end = (exception.override?.endAt as number | undefined) ?? start + duration;
    if (overlaps(start, Math.max(end, start + 1))) {
      out.push({ occurrenceStart: start, occurrenceEnd: end, isException: true, override: exception.override });
    }
  }

  return out.sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

/**
 * Return `rruleStr` with UNTIL replaced so the series ends strictly before
 * `beforeUtcMs` (used for "this and future" edits). UNTIL is encoded in
 * fake-UTC wall time to match expansion.
 */
export function withUntilBefore(rruleStr: string, beforeUtcMs: number, tz: string): string {
  const options = RRule.parseString(rruleStr);
  options.until = new Date(toFakeUtc(beforeUtcMs, tz).getTime() - 1000);
  options.count = undefined;
  const full = new RRule(options).toString(); // may include DTSTART line
  const ruleLine = full.split("\n").find((l) => l.startsWith("RRULE:")) ?? full;
  return ruleLine.replace(/^RRULE:/, "");
}
