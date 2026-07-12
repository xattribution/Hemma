import { useState } from "react";
import type { ChecklistItem, Me, Task } from "@coord/shared";
import { EVENT_CATEGORIES } from "@coord/shared";
import {
  useChecklistMutations, useChecklists, useEventsRange, useTaskMutations, useTasks,
} from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { SwitchPersonModal } from "../../components/SwitchPersonModal";
import { showToast } from "../../components/Toast";
import { addDays, format, isSameDay, startOfDay } from "../calendar/dates";

/**
 * The "little kid" experience: one screen at a time, giant touch targets,
 * no drawers, no menus, no dense text. Everything a 6-year-old needs to
 * see their day, do their jobs and check things off — nothing else.
 */

type KidTab = "jobs" | "days" | "lists";

const TABS: { key: KidTab; emoji: string; label: string }[] = [
  { key: "jobs", emoji: "⭐", label: "My jobs" },
  { key: "days", emoji: "📅", label: "My days" },
  { key: "lists", emoji: "🛒", label: "Lists" },
];

export function KidApp({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const [tab, setTab] = useState<KidTab>("jobs");
  const [switching, setSwitching] = useState(false);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="flex items-center gap-3 px-4 pb-2 pt-5">
        <button type="button" onClick={() => setSwitching(true)} title="Switch person"
          className="transition active:scale-95">
          <Avatar member={me.member} size="lg" />
        </button>
        <h1 className="text-3xl font-extrabold">Hi, {me.member.name}!</h1>
      </header>

      <main className="flex-1 px-4 pb-32 pt-2">
        {tab === "jobs" && <KidJobs me={me} />}
        {tab === "days" && <KidDays />}
        {tab === "lists" && <KidLists />}
      </main>

      {switching && <SwitchPersonModal currentId={me.member.id} onClose={() => setSwitching(false)} />}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl justify-around gap-2 px-3 py-2">
          {TABS.map(({ key, emoji, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2.5 transition active:scale-95 ${
                tab === key ? "bg-coral-soft" : ""
              }`}>
              <span className="text-3xl">{emoji}</span>
              <span className={`text-base font-extrabold ${tab === key ? "text-coral" : "text-ink-soft"}`}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ---------- My jobs ----------

function KidJobs({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data } = useTasks();
  const mutations = useTaskMutations();
  const mine = (data?.tasks ?? []).filter(
    (t) => t.assigneeId === me.member.id && (t.dueToday || !t.completed),
  );
  const remaining = mine.filter((t) => !t.completed).length;

  if (mine.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-7xl">🌈</span>
        <p className="text-3xl font-extrabold">No jobs today!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-xl font-extrabold text-ink-soft">
        {remaining === 0 ? "All done! You're amazing! 🎉" : `${remaining} to go — you can do it!`}
      </p>
      {mine.map((task) => (
        <KidJobCard key={task.id} task={task}
          onCheck={() =>
            mutations.complete.mutate(
              { id: task.id, occurrenceDate: task.occurrenceDate },
              { onError: (err) => showToast(err.message, "error") },
            )
          }
          onStep={(i) =>
            mutations.toggleStep.mutate(
              { id: task.id, stepIndex: i, occurrenceDate: task.occurrenceDate },
              { onError: (err) => showToast(err.message, "error") },
            )
          }
        />
      ))}
    </div>
  );
}

function KidJobCard({ task, onCheck, onStep }: { task: Task; onCheck: () => void; onStep: (i: number) => void }) {
  return (
    <div className={`rounded-3xl border-4 p-5 shadow-card transition ${
      task.completed ? "border-leaf bg-leaf/10" : "border-line bg-card"
    }`}>
      <div className="flex items-center gap-4">
        <span className="text-6xl">{task.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-extrabold leading-tight">{task.title}</p>
          {task.points ? (
            <p className="mt-1 text-lg font-extrabold text-sun">⭐ {task.points} points</p>
          ) : null}
        </div>
        <button type="button" onClick={onCheck} aria-label={task.completed ? "Not done yet" : "All done"}
          className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 text-4xl transition active:scale-90 ${
            task.completed ? "border-leaf bg-leaf text-white" : "border-line bg-cream"
          }`}>
          {task.completed ? "✓" : ""}
        </button>
      </div>

      {task.completed ? (
        <p className="mt-3 text-center text-xl font-extrabold text-leaf">Done! Great job! 🎉</p>
      ) : (
        task.steps.length > 0 && (
          <div className="mt-4 space-y-2">
            {task.steps.map((step, i) => {
              const done = task.stepsDone.includes(i);
              return (
                <button key={i} type="button" onClick={() => onStep(i)}
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.98] ${
                    done ? "border-leaf bg-leaf/10" : "border-line bg-cream"
                  }`}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-xl ${
                    done ? "border-leaf bg-leaf text-white" : "border-line bg-card"
                  }`}>{done ? "✓" : ""}</span>
                  <span className={`text-xl font-bold ${done ? "text-ink-soft line-through" : ""}`}>{step}</span>
                </button>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

// ---------- My days (today + tomorrow, no month grid) ----------

function KidDays() {
  const today = startOfDay(new Date());
  const { data: instances } = useEventsRange(today.getTime(), addDays(today, 2).getTime());
  const days = [
    { label: "Today", emoji: "☀️", date: today },
    { label: "Tomorrow", emoji: "🌙", date: addDays(today, 1) },
  ];

  return (
    <div className="space-y-5">
      {days.map(({ label, emoji, date }) => {
        const dayEvents = (instances ?? [])
          .filter((i) => isSameDay(new Date(i.occurrenceStart), date))
          .sort((a, b) => a.occurrenceStart - b.occurrenceStart);
        return (
          <section key={label}>
            <h2 className="mb-2 text-2xl font-extrabold">
              {emoji} {label} <span className="text-lg font-bold text-ink-soft">{format(date, "EEEE")}</span>
            </h2>
            {dayEvents.length === 0 ? (
              <p className="rounded-3xl bg-card px-5 py-6 text-center text-xl font-bold text-ink-soft shadow-card">
                Nothing planned!
              </p>
            ) : (
              <div className="space-y-2">
                {dayEvents.map((instance) => {
                  const cat = EVENT_CATEGORIES[instance.category];
                  return (
                    <div key={`${instance.id}:${instance.occurrenceStart}`}
                      className="flex items-center gap-4 rounded-3xl bg-card p-4 shadow-card"
                      style={{ borderLeft: `10px solid ${cat.color}` }}>
                      <span className="text-4xl">{cat.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xl font-extrabold">{instance.title}</p>
                        <p className="text-lg font-bold text-ink-soft">
                          {instance.allDay ? "All day" : format(new Date(instance.occurrenceStart), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Lists (giant check-off rows) ----------

function KidLists() {
  const { data: lists } = useChecklists();
  const { toggleItem } = useChecklistMutations();

  const visible = (lists ?? []).filter((l) => l.items.length > 0);
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-7xl">🛒</span>
        <p className="text-3xl font-extrabold">No lists yet!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((list) => (
        <section key={list.id} className="rounded-3xl bg-card p-4 shadow-card">
          <h2 className="mb-2 flex items-center gap-2 text-2xl font-extrabold">
            <span className="text-3xl">{list.icon}</span> {list.title}
          </h2>
          <div className="space-y-2">
            {list.items.map((item: ChecklistItem) => (
              <button key={item.id} type="button"
                onClick={() => toggleItem.mutate({ listId: list.id, itemId: item.id })}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.98] ${
                  item.checked ? "border-leaf bg-leaf/10" : "border-line bg-cream"
                }`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-xl ${
                  item.checked ? "border-leaf bg-leaf text-white" : "border-line bg-card"
                }`}>{item.checked ? "✓" : ""}</span>
                <span className={`text-xl font-bold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                  {item.text}
                  {item.quantity ? <span className="ml-2 text-lg text-ink-soft">×{item.quantity}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
