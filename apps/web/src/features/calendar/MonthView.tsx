import type { EventInstance, Member } from "@coord/shared";
import { EVENT_CATEGORIES } from "@coord/shared";
import { format, isSameDay, isSameMonth, monthGridDays } from "./dates";

interface Props {
  anchor: Date;
  instances: EventInstance[];
  members: Member[];
  onDayClick: (day: Date) => void;
  onEventClick: (instance: EventInstance) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ anchor, instances, members, onDayClick, onEventClick }: Props) {
  const days = monthGridDays(anchor);
  const today = new Date();
  const memberById = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card">
      <div className="grid grid-cols-7 border-b-2 border-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-extrabold uppercase tracking-wide text-ink-soft">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = instances.filter((i) => isSameDay(new Date(i.occurrenceStart), day));
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.getTime()}
              onClick={() => onDayClick(day)}
              className={`relative min-h-20 cursor-pointer border-b border-r border-line p-1 transition hover:bg-coral-soft/40 sm:min-h-28 ${
                inMonth ? "" : "bg-cream/60 text-ink-soft"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                  isToday ? "bg-coral text-white" : ""
                }`}
              >
                {format(day, "d")}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 3).map((instance) => {
                  const cat = EVENT_CATEGORIES[instance.category];
                  return (
                    <button
                      key={`${instance.id}:${instance.occurrenceStart}`}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEventClick(instance); }}
                      className="flex w-full items-center gap-1 truncate rounded-md px-1 py-0.5 text-left text-[10px] font-bold text-white sm:text-xs"
                      style={{ backgroundColor: cat.color }}
                      title={instance.title}
                    >
                      {!instance.allDay && (
                        <span className="hidden shrink-0 opacity-80 sm:inline">{format(new Date(instance.occurrenceStart), "h:mm")}</span>
                      )}
                      <span className="truncate">{instance.title}</span>
                      <span className="ml-auto hidden shrink-0 gap-0.5 sm:flex">
                        {instance.assigneeIds.slice(0, 3).map((id) => {
                          const member = memberById.get(id);
                          return member ? (
                            <span key={id} className="h-2 w-2 rounded-full ring-1 ring-white/60" style={{ backgroundColor: member.color }} />
                          ) : null;
                        })}
                      </span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="px-1 text-[10px] font-bold text-ink-soft">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
