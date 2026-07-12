import { useState } from "react";
import { format, set } from "date-fns";
import type { EditScope, EventInput, EventInstance, Member } from "@coord/shared";
import { EVENT_CATEGORIES, type EventCategory } from "@coord/shared";
import { Trash2 } from "lucide-react";
import { deviceTimezone, useEventMutations } from "../../api/queries";
import { MemberChip } from "../../components/Avatar";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

type Repeat = "none" | "daily" | "weekly" | "weekdays" | "monthly";
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const REMINDERS: [string, string][] = [
  ["none", "No reminder"], ["5", "5 min before"], ["15", "15 min before"], ["30", "30 min before"],
  ["60", "1 hour before"], ["120", "2 hours before"], ["1440", "1 day before"],
];

function repeatOf(rrule: string | null): { repeat: Repeat; days: number[] } {
  if (!rrule) return { repeat: "none", days: [] };
  const days = /BYDAY=([A-Z,]+)/.exec(rrule)?.[1]?.split(",").map((d) => BYDAY.indexOf(d)) ?? [];
  if (rrule.includes("FREQ=DAILY")) return { repeat: "daily", days: [] };
  if (rrule.includes("FREQ=MONTHLY")) return { repeat: "monthly", days: [] };
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return { repeat: "weekdays", days };
  return { repeat: "weekly", days };
}

function buildRrule(repeat: Repeat, days: number[]): string | null {
  switch (repeat) {
    case "none": return null;
    case "daily": return "FREQ=DAILY";
    case "monthly": return "FREQ=MONTHLY";
    case "weekdays": return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return days.length ? `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")}` : "FREQ=WEEKLY";
  }
}

interface Props {
  members: Member[];
  /** Editing an existing occurrence, or creating at a prefilled time. */
  instance?: EventInstance;
  defaultStart?: Date;
  onClose: () => void;
}

export function EventModal({ members, instance, defaultStart, onClose }: Props) {
  const { create, update, remove } = useEventMutations();
  const start = instance ? new Date(instance.occurrenceStart) : (defaultStart ?? new Date());
  const initialRepeat = repeatOf(instance?.rrule ?? null);

  const [title, setTitle] = useState(instance?.title ?? "");
  const [category, setCategory] = useState<EventCategory>(instance?.category ?? "family");
  const [date, setDate] = useState(format(start, "yyyy-MM-dd"));
  const [allDay, setAllDay] = useState(instance?.allDay ?? false);
  const [startTime, setStartTime] = useState(format(start, "HH:mm"));
  const [endTime, setEndTime] = useState(
    instance ? format(new Date(instance.occurrenceEnd), "HH:mm") : format(set(start, { hours: start.getHours() + 1 }), "HH:mm"),
  );
  const [location, setLocation] = useState(instance?.location ?? "");
  const [description, setDescription] = useState(instance?.description ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(instance?.assigneeIds ?? []);
  const [repeat, setRepeat] = useState<Repeat>(initialRepeat.repeat);
  const [weeklyDays, setWeeklyDays] = useState<number[]>(
    initialRepeat.days.length ? initialRepeat.days : [start.getDay()],
  );
  const [reminder, setReminder] = useState(instance?.reminderMinutes != null ? String(instance.reminderMinutes) : "none");
  const [scopeAsk, setScopeAsk] = useState<"save" | "delete" | null>(null);

  const isRecurring = !!instance?.rrule;
  const busy = create.isPending || update.isPending || remove.isPending;

  const buildInput = (): EventInput | null => {
    const [y, mo, d] = date.split("-").map(Number);
    const [sh, sm] = (allDay ? "00:00" : startTime).split(":").map(Number);
    const [eh, em] = (allDay ? "00:00" : endTime).split(":").map(Number);
    const startAt = new Date(y!, mo! - 1, d!, sh!, sm!).getTime();
    const endAt = allDay ? startAt + 24 * 3600_000 : new Date(y!, mo! - 1, d!, eh!, em!).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
      showToast("Pick a date and time first", "error");
      return null;
    }
    return {
      title, category, location, description, allDay,
      startAt, endAt,
      timezone: deviceTimezone(),
      rrule: buildRrule(repeat, weeklyDays),
      assigneeIds,
      reminderMinutes: reminder === "none" ? null : Number(reminder),
    };
  };

  const onError = (err: Error) => showToast(`Couldn't save: ${err.message}`, "error");

  const save = (scope: EditScope) => {
    const input = buildInput();
    if (!input) return;
    if (!instance) {
      create.mutate(input, {
        onSuccess: () => {
          showToast(`"${input.title}" added to the calendar ✔`);
          onClose();
        },
        onError,
      });
      return;
    }
    const patch: Partial<EventInput> =
      scope === "single"
        ? { title: input.title, category: input.category, location: input.location,
            description: input.description, startAt: input.startAt, endAt: input.endAt }
        : input;
    update.mutate(
      { id: instance.id, scope, occurrenceStart: instance.occurrenceStart, patch },
      { onSuccess: onClose, onError },
    );
  };

  const del = (scope: EditScope) => {
    remove.mutate(
      { id: instance!.id, scope, occurrenceStart: instance!.occurrenceStart },
      { onSuccess: onClose, onError },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (instance && isRecurring) setScopeAsk("save");
    else save("all");
  };

  if (scopeAsk) {
    const apply = scopeAsk === "save" ? save : del;
    return (
      <Modal title={scopeAsk === "save" ? "Change repeating event" : "Delete repeating event"} onClose={() => setScopeAsk(null)}>
        <div className="flex flex-col gap-2">
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => apply("single")}>
            Just this one ({format(new Date(instance!.occurrenceStart), "MMM d")})
          </button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => apply("future")}>
            This and all following
          </button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => apply("all")}>
            The whole series
          </button>
          <button type="button" className={ghostBtn} onClick={() => setScopeAsk(null)}>Never mind</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={instance ? "Edit event" : "New event"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <input className={`${inputCls} text-lg`} placeholder="What's happening?" value={title}
          onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={120} />

        <div>
          <label className={labelCls}>Category</label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(EVENT_CATEGORIES) as [EventCategory, (typeof EVENT_CATEGORIES)[EventCategory]][]).map(([key, cat]) => (
              <button key={key} type="button" onClick={() => setCategory(key)}
                className={`rounded-full border-2 px-2.5 py-1 text-xs font-bold transition ${category === key ? "text-white" : "bg-card text-ink"}`}
                style={{ borderColor: cat.color, backgroundColor: category === key ? cat.color : undefined }}>
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className={labelCls}>Date</label>
            <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          {!allDay && (
            <>
              <div>
                <label className={labelCls}>From</label>
                <input className={inputCls} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>To</label>
                <input className={inputCls} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}
            className="h-5 w-5 accent-coral" />
          All day
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Repeats</label>
            <select className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              <option value="none">Doesn't repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="weekdays">Weekdays</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Reminder</label>
            <select className={inputCls} value={reminder} onChange={(e) => setReminder(e.target.value)}>
              {REMINDERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {repeat === "weekly" && (
          <div className="flex gap-1.5">
            {DAY_LABELS.map((label, day) => (
              <button key={day} type="button"
                onClick={() =>
                  setWeeklyDays((current) =>
                    current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
                  )
                }
                className={`h-9 w-9 rounded-full text-sm font-extrabold transition ${
                  weeklyDays.includes(day) ? "bg-coral text-white" : "bg-card text-ink-soft shadow-card"
                }`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div>
          <label className={labelCls}>Who's it for?</label>
          <div className="flex flex-wrap gap-1.5">
            {members.map((member) => (
              <MemberChip key={member.id} member={member} active={assigneeIds.includes(member.id)}
                onClick={() =>
                  setAssigneeIds((current) =>
                    current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id],
                  )
                } />
            ))}
          </div>
        </div>

        <input className={inputCls} placeholder="Location (optional)" value={location}
          onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        <textarea className={`${inputCls} min-h-16`} placeholder="Notes (optional)" value={description}
          onChange={(e) => setDescription(e.target.value)} maxLength={2000} />

        <div className="flex items-center justify-between pt-1">
          {instance ? (
            <button type="button" disabled={busy}
              onClick={() => (isRecurring ? setScopeAsk("delete") : del("all"))}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 font-bold text-coral transition hover:bg-coral-soft">
              <Trash2 size={16} /> Delete
            </button>
          ) : (
            <span />
          )}
          <button className={primaryBtn} disabled={busy || !title.trim()}>
            {busy ? "Saving…" : instance ? "Save changes" : "Add to calendar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
