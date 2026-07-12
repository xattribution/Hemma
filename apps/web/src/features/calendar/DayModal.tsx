import { format, isSameDay, startOfDay, addDays } from "date-fns";
import { Check, Plus } from "lucide-react";
import type { EventInstance, Member } from "@coord/shared";
import { EVENT_CATEGORIES } from "@coord/shared";
import { useChecklists, useEventsRange, useTaskMutations, useTasks } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { Modal, primaryBtn } from "../../components/Modal";
import { useElevation } from "../dashboard/elevation";

interface Props {
  day: Date;
  members: Member[];
  /** Members can add/edit events; kiosk displays pass false. */
  canManageEvents: boolean;
  onAddEvent?: () => void;
  onEventClick?: (instance: EventInstance) => void;
  onClose: () => void;
}

/** Tap a date → everything that matters that day: events, chores, dated lists. */
export function DayModal({ day, members, canManageEvents, onAddEvent, onEventClick, onClose }: Props) {
  const dayStart = startOfDay(day);
  const isoDate = format(day, "yyyy-MM-dd");
  const { data: instances } = useEventsRange(dayStart.getTime(), addDays(dayStart, 1).getTime());
  const { data: taskData } = useTasks(isoDate);
  const { data: lists } = useChecklists();
  const taskMutations = useTaskMutations();
  const { ensure } = useElevation(); // no-op outside displays
  const memberById = new Map(members.map((m) => [m.id, m]));

  const dueTasks = (taskData?.tasks ?? []).filter((t) => t.dueToday);
  const dueLists = (lists ?? []).filter((l) => l.needBy !== null && isSameDay(l.needBy, day));

  return (
    <Modal title={format(day, "EEEE, MMMM d")} onClose={onClose} wide>
      <div className="space-y-5">
        {/* Events */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-ink-soft">Events</h3>
            {canManageEvents && onAddEvent && (
              <button type="button" className={`${primaryBtn} flex items-center gap-1 px-3 py-1 text-sm`} onClick={onAddEvent}>
                <Plus size={14} /> Event
              </button>
            )}
          </div>
          {(instances ?? []).length === 0 && (
            <p className="rounded-xl bg-card px-3 py-3 text-sm font-semibold text-ink-soft">Nothing planned 🎈</p>
          )}
          <div className="space-y-1.5">
            {(instances ?? []).map((instance) => (
              <button
                key={`${instance.id}:${instance.occurrenceStart}`}
                type="button"
                disabled={!onEventClick}
                onClick={() => onEventClick?.(instance)}
                className="flex w-full items-center gap-3 rounded-xl border-l-4 bg-card px-3 py-2 text-left shadow-card disabled:cursor-default"
                style={{ borderColor: EVENT_CATEGORIES[instance.category].color }}
              >
                <span className="text-lg">{EVENT_CATEGORIES[instance.category].icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{instance.title}</span>
                  <span className="block text-xs font-semibold text-ink-soft">
                    {instance.allDay
                      ? "All day"
                      : `${format(instance.occurrenceStart, "h:mm a")} – ${format(instance.occurrenceEnd, "h:mm a")}`}
                    {instance.location ? ` · ${instance.location}` : ""}
                  </span>
                </span>
                <span className="flex gap-0.5">
                  {instance.assigneeIds.map((id) => {
                    const member = memberById.get(id);
                    return member ? (
                      <span key={id} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} title={member.name} />
                    ) : null;
                  })}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Chores & to-dos */}
        <section>
          <h3 className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-ink-soft">Chores & to-dos</h3>
          {dueTasks.length === 0 && (
            <p className="rounded-xl bg-card px-3 py-3 text-sm font-semibold text-ink-soft">All clear! 🎉</p>
          )}
          <div className="space-y-1">
            {dueTasks.map((task) => {
              const assignee = task.assigneeId ? memberById.get(task.assigneeId) : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => void ensure().then((ok) => ok && taskMutations.complete.mutate({ id: task.id, occurrenceDate: task.occurrenceDate }))}
                  className={`flex w-full items-center gap-2 rounded-xl border-2 border-line bg-card px-2.5 py-1.5 text-left transition active:scale-[0.99] ${
                    task.completed ? "opacity-55" : ""
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                      task.completed ? "border-leaf bg-leaf text-white" : "border-line bg-cream"
                    }`}
                  >
                    {task.completed ? <Check size={15} /> : <span className="text-xs">{task.icon}</span>}
                  </span>
                  <span className={`flex-1 truncate text-sm font-bold ${task.completed ? "line-through" : ""}`}>{task.title}</span>
                  {assignee && <Avatar member={assignee} size="sm" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Lists needed by this day */}
        {dueLists.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-ink-soft">Needed by today</h3>
            <div className="space-y-1.5">
              {dueLists.map((list) => {
                const done = list.items.filter((i) => i.checked).length;
                return (
                  <div key={list.id} className="rounded-xl bg-card px-3 py-2 shadow-card">
                    <p className="font-bold">
                      {list.icon} {list.title}
                      <span className="ml-2 text-xs font-bold text-ink-soft">{done}/{list.items.length}</span>
                    </p>
                    <p className="truncate text-xs font-semibold text-ink-soft">
                      {list.items.filter((i) => !i.checked).map((i) => i.text).join(", ") || "All done!"}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
