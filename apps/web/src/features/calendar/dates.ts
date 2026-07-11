import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth,
  parse, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";

export type CalView = "month" | "week" | "day";

export const toParam = (d: Date) => format(d, "yyyy-MM-dd");
export const fromParam = (s: string | undefined) =>
  s ? parse(s, "yyyy-MM-dd", new Date()) : new Date();

/** The 35/42-cell grid a classic month view renders. */
export function monthGridDays(anchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchor));
  const end = endOfWeek(endOfMonth(anchor));
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** [windowStart, windowEnd) in UTC ms for what a view displays. */
export function viewRange(view: CalView, anchor: Date): { start: number; end: number } {
  if (view === "month") {
    const days = monthGridDays(anchor);
    return { start: days[0]!.getTime(), end: addDays(days[days.length - 1]!, 1).getTime() };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start: start.getTime(), end: addWeeks(start, 1).getTime() };
  }
  const start = startOfDay(anchor);
  return { start: start.getTime(), end: addDays(start, 1).getTime() };
}

export function stepAnchor(view: CalView, anchor: Date, direction: 1 | -1): Date {
  if (view === "month") return addMonths(anchor, direction);
  if (view === "week") return addWeeks(anchor, direction);
  return addDays(anchor, direction);
}

export function viewTitle(view: CalView, anchor: Date): string {
  if (view === "month") return format(anchor, "MMMM yyyy");
  if (view === "week") {
    const days = weekDays(anchor);
    return `${format(days[0]!, "MMM d")} – ${format(days[6]!, "MMM d, yyyy")}`;
  }
  return format(anchor, "EEEE, MMMM d");
}

export { addDays, format, isSameDay, isSameMonth, startOfDay };
