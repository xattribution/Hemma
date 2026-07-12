import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { EventInstance } from "@coord/shared";
import { useEventsRange, useMembers } from "../../api/queries";
import { PluginSlot } from "../../plugins/registry";
import { FullscreenButton } from "../../components/FullscreenButton";
import { ghostBtn, primaryBtn } from "../../components/Modal";
import {
  fromParam, stepAnchor, toParam, viewRange, viewTitle, weekDays, type CalView,
} from "./dates";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { EventModal } from "./EventModal";
import { DayModal } from "./DayModal";

type ModalState =
  | { kind: "day"; day: Date }
  | { kind: "create"; start: Date }
  | { kind: "edit"; instance: EventInstance }
  | null;

export function CalendarPage() {
  const params = useParams<{ view?: string; date?: string }>();
  const navigate = useNavigate();
  const view: CalView = params.view === "week" || params.view === "day" ? params.view : "month";
  const anchor = fromParam(params.date);
  const [modal, setModal] = useState<ModalState>(null);

  const range = useMemo(() => viewRange(view, anchor), [view, anchor.getTime()]);
  const { data: instances } = useEventsRange(range.start, range.end);
  const { data: members } = useMembers();

  const go = (v: CalView, d: Date) => navigate(`/calendar/${v}/${toParam(d)}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold">{viewTitle(view, anchor)}</h2>
        <PluginSlot slot="calendar.toolbar" />
        <FullscreenButton />
        <div className="flex rounded-xl bg-card p-0.5 shadow-card">
          {(["month", "week", "day"] as const).map((v) => (
            <button key={v} type="button" onClick={() => go(v, anchor)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold capitalize transition ${
                view === v ? "bg-coral text-white" : "text-ink-soft hover:text-ink"
              }`}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={ghostBtn} onClick={() => go(view, stepAnchor(view, anchor, -1))} aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className={ghostBtn} onClick={() => go(view, new Date())}>
            Today
          </button>
          <button type="button" className={ghostBtn} onClick={() => go(view, stepAnchor(view, anchor, 1))} aria-label="Next">
            <ChevronRight size={18} />
          </button>
        </div>
        <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setModal({ kind: "create", start: defaultStart(anchor) })}>
          <Plus size={18} /> Event
        </button>
      </div>

      {view === "month" ? (
        <MonthView
          anchor={anchor}
          instances={instances ?? []}
          members={members ?? []}
          onDayClick={(day) => setModal({ kind: "day", day })}
          onEventClick={(instance) => setModal({ kind: "edit", instance })}
        />
      ) : (
        <WeekView
          days={view === "week" ? weekDays(anchor) : [anchor]}
          instances={instances ?? []}
          onSlotClick={(day, hour) => {
            const start = new Date(day);
            start.setHours(hour, 0, 0, 0);
            setModal({ kind: "create", start });
          }}
          onEventClick={(instance) => setModal({ kind: "edit", instance })}
        />
      )}

      {modal?.kind === "day" && (
        <DayModal
          day={modal.day}
          members={members ?? []}
          canManageEvents
          onAddEvent={() => setModal({ kind: "create", start: defaultStart(modal.day) })}
          onEventClick={(instance) => setModal({ kind: "edit", instance })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "create" && (
        <EventModal members={members ?? []} defaultStart={modal.start} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit" && (
        <EventModal members={members ?? []} instance={modal.instance} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function defaultStart(day: Date): Date {
  const start = new Date(day);
  const nextHour = new Date().getHours() + 1;
  start.setHours(Math.min(nextHour, 20), 0, 0, 0);
  return start;
}
