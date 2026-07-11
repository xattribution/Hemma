import { useEffect, useRef } from "react";
import type { EventInstance } from "@coord/shared";
import { EVENT_CATEGORIES } from "@coord/shared";
import { format, isSameDay } from "./dates";

interface Props {
  days: Date[]; // 7 for week view, 1 for day view
  instances: EventInstance[];
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (instance: EventInstance) => void;
}

const HOUR_PX = 52;

export function WeekView({ days, instances, onSlotClick, onEventClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX }); // wake up at 7am
  }, []);

  const allDay = (day: Date) =>
    instances.filter((i) => i.allDay && isSameDay(new Date(i.occurrenceStart), day));
  const timed = (day: Date) =>
    instances.filter((i) => !i.allDay && isSameDay(new Date(i.occurrenceStart), day));

  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card">
      {/* Day headers + all-day row */}
      <div className="grid border-b-2 border-line" style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((day) => (
          <div key={day.getTime()} className="border-l border-line px-1 py-2 text-center">
            <div className="text-xs font-extrabold uppercase text-ink-soft">{format(day, "EEE")}</div>
            <div
              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold ${
                isSameDay(day, today) ? "bg-coral text-white" : ""
              }`}
            >
              {format(day, "d")}
            </div>
            <div className="mt-1 space-y-0.5">
              {allDay(day).map((instance) => (
                <button
                  key={`${instance.id}:${instance.occurrenceStart}`}
                  type="button"
                  onClick={() => onEventClick(instance)}
                  className="w-full truncate rounded-md px-1 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: EVENT_CATEGORIES[instance.category].color }}
                >
                  {instance.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="max-h-[65dvh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] font-bold text-ink-soft" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : format(new Date(2000, 0, 1, h), "h a")}
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day.getTime()} className="relative border-l border-line" style={{ height: 24 * HOUR_PX }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  onClick={() => onSlotClick(day, h)}
                  className="absolute inset-x-0 cursor-pointer border-t border-line/70 hover:bg-coral-soft/40"
                  style={{ top: h * HOUR_PX, height: HOUR_PX }}
                />
              ))}
              {timed(day).map((instance, idx) => {
                const start = new Date(instance.occurrenceStart);
                const minutes = start.getHours() * 60 + start.getMinutes();
                const duration = Math.max(30, (instance.occurrenceEnd - instance.occurrenceStart) / 60_000);
                const cat = EVENT_CATEGORIES[instance.category];
                return (
                  <button
                    key={`${instance.id}:${instance.occurrenceStart}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEventClick(instance); }}
                    className="absolute overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11px] font-bold text-white shadow-card"
                    style={{
                      top: (minutes / 60) * HOUR_PX,
                      height: (duration / 60) * HOUR_PX - 2,
                      left: `${2 + (idx % 2) * 6}%`,
                      right: "2%",
                      backgroundColor: cat.color,
                    }}
                  >
                    <span className="opacity-80">{format(start, "h:mm")}</span> {instance.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
