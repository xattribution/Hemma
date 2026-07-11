import { TZDate } from "@date-fns/tz";

export interface WallParts {
  year: number;
  month: number; // 0-based
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock components of a UTC instant, as seen in `tz`. */
export function wallPartsOf(utcMs: number, tz: string): WallParts {
  const d = new TZDate(utcMs, tz);
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
}

/** The UTC instant at which `tz` shows this wall-clock time. */
export function utcOfWall(parts: WallParts, tz: string): number {
  return new TZDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, tz).getTime();
}

/** A wall-clock time re-encoded as fake-UTC — the space rrule iterates in. */
export function toFakeUtc(utcMs: number, tz: string): Date {
  const p = wallPartsOf(utcMs, tz);
  return new Date(Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second));
}

/** Interpret a fake-UTC date's components as wall time in `tz`. */
export function fromFakeUtc(fake: Date, tz: string): number {
  return utcOfWall(
    {
      year: fake.getUTCFullYear(),
      month: fake.getUTCMonth(),
      day: fake.getUTCDate(),
      hour: fake.getUTCHours(),
      minute: fake.getUTCMinutes(),
      second: fake.getUTCSeconds(),
    },
    tz,
  );
}

/** ISO date (YYYY-MM-DD) of an instant in `tz`. */
export function isoDateOf(utcMs: number, tz: string): string {
  const p = wallPartsOf(utcMs, tz);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Day-of-week (0=Sunday) of an instant in `tz`. */
export function weekdayOf(utcMs: number, tz: string): number {
  return new TZDate(utcMs, tz).getDay();
}
