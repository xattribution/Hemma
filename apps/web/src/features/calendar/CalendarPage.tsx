import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Plus } from "lucide-react";
import type { EventInstance } from "@coord/shared";
import { useEventsRange, useMe, useMembers } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { PluginSlot } from "../../plugins/registry";
import { FullscreenButton } from "../../components/FullscreenButton";
import { primaryBtn } from "../../components/Modal";
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
  const me = useMe();
  const myId = me.data?.kind === "member" ? me.data.member.id : null;
  const isParent = me.data?.kind === "member" && me.data.member.role === "parent";

  // Per-user view filters (this device): hide members' events you don't
  // need to see; parents can also reveal others' private items.
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("coord.cal.hiddenMembers") ?? "[]") as string[]; } catch { return []; }
  });
  const [showPrivate, setShowPrivate] = useState(() => localStorage.getItem("coord.cal.showPrivate") === "1");
  const toggleMember = (id: string) =>
    setHidden((current) => {
      const next = current.includes(id) ? current.filter((m) => m !== id) : [...current, id];
      localStorage.setItem("coord.cal.hiddenMembers", JSON.stringify(next));
      return next;
    });
  const togglePrivate = () =>
    setShowPrivate((current) => {
      localStorage.setItem("coord.cal.showPrivate", current ? "0" : "1");
      return !current;
    });

  const visibleInstances = (instances ?? []).filter((instance) => {
    // Others' private items reach parents only; keep them tucked away
    // until the eye is opened. Your own always show.
    if (instance.visibility === "private" && instance.createdBy !== myId && !showPrivate) return false;
    // An event assigned to specific people hides when ALL of them are
    // filtered out (family-wide, unassigned events always show).
    if (instance.assigneeIds.length && instance.assigneeIds.every((id) => hidden.includes(id))) return false;
    return true;
  });

  const go = (v: CalView, d: Date) => navigate(`/calendar/${v}/${toParam(d)}`);

  return (
    <div className="space-y-3">
      {/* One toolbar, grouped by function: where am I (title + date nav) on
          the left; how I'm looking (views) and what I can do (add) on the
          right. Wraps to two tidy rows on phones. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-xl font-extrabold">{viewTitle(view, anchor)}</h2>
        <div className="flex items-center rounded-lg bg-card shadow-card">
          <button type="button" onClick={() => go(view, stepAnchor(view, anchor, -1))} aria-label="Previous" title="Previous"
            className="px-2 py-1.5 text-ink-soft transition hover:text-ink">
            <ChevronLeft size={17} />
          </button>
          <button type="button" onClick={() => go(view, new Date())} title="Jump to today"
            className="border-x border-line px-3 py-1.5 text-sm font-bold text-ink-soft transition hover:text-ink">
            Today
          </button>
          <button type="button" onClick={() => go(view, stepAnchor(view, anchor, 1))} aria-label="Next" title="Next"
            className="px-2 py-1.5 text-ink-soft transition hover:text-ink">
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PluginSlot slot="calendar.toolbar" />
          <div className="flex rounded-lg bg-card shadow-card">
            {(["month", "week", "day"] as const).map((v, i) => (
              <button key={v} type="button" onClick={() => go(v, anchor)}
                className={`px-3 py-1.5 text-sm font-bold capitalize transition ${i > 0 ? "border-l border-line" : ""} ${
                  view === v ? "bg-sky text-white" : "text-ink-soft hover:text-ink"
                } ${i === 0 ? "rounded-l-lg" : ""} ${i === 2 ? "rounded-r-lg" : ""}`}>
                {v}
              </button>
            ))}
          </div>
          <FullscreenButton />
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setModal({ kind: "create", start: defaultStart(anchor) })}>
            <Plus size={18} /> Event
          </button>
        </div>
      </div>

      {(members ?? []).length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(members ?? []).map((member) => (
            <button key={member.id} type="button" onClick={() => toggleMember(member.id)}
              title={hidden.includes(member.id) ? `Show ${member.name}'s events` : `Hide ${member.name}'s events`}
              className={`transition ${hidden.includes(member.id) ? "opacity-30 grayscale" : ""}`}>
              <Avatar member={member} size="sm" />
            </button>
          ))}
          {isParent && (
            <button type="button" onClick={togglePrivate}
              title={showPrivate ? "Hide other people's private items" : "Show other people's private items"}
              className="ml-2 rounded-lg p-1.5 text-ink-soft transition hover:text-ink">
              {showPrivate ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
        </div>
      )}

      {view === "month" ? (
        <MonthView
          anchor={anchor}
          instances={visibleInstances}
          members={members ?? []}
          onDayClick={(day) => setModal({ kind: "day", day })}
          onEventClick={(instance) => setModal({ kind: "edit", instance })}
        />
      ) : (
        <WeekView
          days={view === "week" ? weekDays(anchor) : [anchor]}
          instances={visibleInstances}
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
