import { useEffect, useState } from "react";
import { Link } from "react-router";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { EVENT_CATEGORIES } from "@coord/shared";
import { useChecklistMutations, useDashboard, useMe, useTaskMutations } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { PluginSlot } from "../../plugins/registry";

/**
 * The always-on kitchen display: today at a glance, big and touch-friendly.
 * Data flows in over the WebSocket; a daily reload keeps long-running
 * tablets fresh.
 */
export function DashboardPage() {
  const { data } = useDashboard();
  const me = useMe();
  const tasks = useTaskMutations();
  const lists = useChecklistMutations();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30_000);
    // Reload once a day (at ~4am) so week-long kiosk sessions stay leak-free.
    const reload = setInterval(() => {
      if (new Date().getHours() === 4 && new Date().getMinutes() < 1) location.reload();
    }, 60_000);
    return () => { clearInterval(clock); clearInterval(reload); };
  }, []);

  if (!data) {
    return <div className="flex min-h-dvh items-center justify-center text-5xl"><span className="animate-pop">🏡</span></div>;
  }

  return (
    <div className="min-h-dvh bg-cream p-4 sm:p-6">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">🏡 {data.household.name}</h1>
          <p className="font-semibold text-ink-soft">{format(now, "EEEE, MMMM d")}</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-extrabold tabular-nums sm:text-5xl">{format(now, "h:mm")}</p>
          {me.data?.kind === "member" && (
            <Link to="/calendar" className="text-sm font-bold text-coral hover:underline">← back to app</Link>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today + tomorrow */}
        <section className="rounded-card bg-card p-4 shadow-card">
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-ink-soft">Today</h2>
          <div className="space-y-2">
            {data.events.length === 0 && <p className="font-semibold text-ink-soft">Nothing on the calendar 🎈</p>}
            {data.events.map((instance) => (
              <div key={`${instance.id}:${instance.occurrenceStart}`}
                className="flex items-center gap-3 rounded-xl border-l-4 bg-cream px-3 py-2"
                style={{ borderColor: EVENT_CATEGORIES[instance.category].color }}>
                <span className="text-xl">{EVENT_CATEGORIES[instance.category].icon}</span>
                <div className="min-w-0">
                  <p className="truncate font-extrabold">{instance.title}</p>
                  <p className="text-sm font-semibold text-ink-soft">
                    {instance.allDay ? "All day" : format(instance.occurrenceStart, "h:mm a")}
                    {instance.location ? ` · ${instance.location}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {data.tomorrowEvents.length > 0 && (
            <>
              <h2 className="mb-1 mt-4 text-sm font-extrabold uppercase tracking-wide text-ink-soft">Tomorrow</h2>
              {data.tomorrowEvents.map((instance) => (
                <p key={`${instance.id}:${instance.occurrenceStart}`} className="truncate py-0.5 text-sm font-semibold text-ink-soft">
                  {EVENT_CATEGORIES[instance.category].icon}{" "}
                  {instance.allDay ? "" : `${format(instance.occurrenceStart, "h:mm a")} · `}
                  {instance.title}
                </p>
              ))}
            </>
          )}
        </section>

        {/* Chores by member — tap to complete right on the tablet */}
        <section className="rounded-card bg-card p-4 shadow-card">
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-ink-soft">Chores</h2>
          <div className="space-y-3">
            {data.choresByMember.filter((c) => c.tasks.length > 0).map(({ member, tasks: memberTasks }) => (
              <div key={member.id}>
                <div className="mb-1 flex items-center gap-2">
                  <Avatar member={member} size="sm" />
                  <span className="font-extrabold">{member.name}</span>
                </div>
                <div className="space-y-1">
                  {memberTasks.map((task) => (
                    <button key={task.id} type="button"
                      onClick={() => tasks.complete.mutate({ id: task.id, occurrenceDate: task.occurrenceDate })}
                      className={`flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition active:scale-[0.98] ${
                        task.completed ? "border-leaf/40 bg-leaf/10 opacity-60" : "border-line bg-cream"
                      }`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                        task.completed ? "border-leaf bg-leaf text-white" : "border-line bg-card"
                      }`}>
                        {task.completed ? <Check size={16} /> : <span className="text-xs">{task.icon}</span>}
                      </span>
                      <span className={`font-bold ${task.completed ? "line-through" : ""}`}>{task.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {data.choresByMember.every((c) => c.tasks.length === 0) && (
              <p className="font-semibold text-ink-soft">All chores done — high fives all around! ✋</p>
            )}
          </div>
        </section>

        {/* Pinned lists + plugin cards */}
        <section className="space-y-4">
          {data.pinnedLists.map((list) => (
            <div key={list.id} className="rounded-card bg-card p-4 shadow-card">
              <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-ink-soft">
                {list.icon} {list.title}
              </h2>
              <ul className="space-y-1">
                {list.items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-cream">
                      <input type="checkbox" checked={item.checked} className="h-5 w-5 accent-leaf"
                        onChange={() => lists.toggleItem.mutate({ listId: list.id, itemId: item.id })} />
                      <span className={`font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                        {item.text}
                        {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <PluginSlot slot="dashboard.card" />
        </section>
      </div>
    </div>
  );
}
