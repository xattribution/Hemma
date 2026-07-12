import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { format, startOfMonth } from "date-fns";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_DISPLAY_CONFIG, EVENT_CATEGORIES, type DisplayConfig } from "@coord/shared";
import {
  useChecklistMutations, useChecklists, useDashboard, useEventsRange, useMe, useMembers,
  useStores, useTaskMutations,
} from "../../api/queries";
import { StoreChip } from "../lists/ListsPage";
import { Avatar } from "../../components/Avatar";
import { PluginSlot } from "../../plugins/registry";
import { MonthView } from "../calendar/MonthView";
import { DayModal } from "../calendar/DayModal";
import { viewRange } from "../calendar/dates";
import { ElevationProvider, useElevation } from "./elevation";
import { FullscreenButton } from "../../components/FullscreenButton";

/**
 * The always-on display view (kitchen, living room, bedroom…). What it shows
 * is controlled per-display from Settings → Displays: card dashboard or a
 * fullscreen interactive calendar, with events/chores/lists toggles.
 */
export function DashboardPage() {
  const me = useMe();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30_000);
    // Reload once a day (at ~4am) so week-long kiosk sessions stay leak-free.
    const reload = setInterval(() => {
      if (new Date().getHours() === 4 && new Date().getMinutes() < 1) location.reload();
    }, 60_000);
    return () => { clearInterval(clock); clearInterval(reload); };
  }, []);

  const config: DisplayConfig = me.data?.kind === "device" ? me.data.config : DEFAULT_DISPLAY_CONFIG;

  if (!me.data) {
    return <div className="flex min-h-dvh items-center justify-center text-5xl"><span className="animate-pop">🏡</span></div>;
  }

  return (
    <ElevationProvider me={me.data}>
      <div className="min-h-dvh bg-cream p-4 sm:p-6">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-extrabold sm:text-3xl">🏡 {me.data.household.name}</h1>
            <p className="font-semibold text-ink-soft">{format(now, "EEEE, MMMM d")}</p>
          </div>
          <div className="flex items-start gap-3 text-right">
            <FullscreenButton />
            <div>
            <p className="text-4xl font-extrabold tabular-nums sm:text-5xl">{format(now, "h:mm")}</p>
            {me.data.kind === "member" && (
              <Link to="/calendar" className="text-sm font-bold text-coral hover:underline">← back to app</Link>
            )}
            </div>
          </div>
        </header>

        {config.layout === "calendar" ? <DisplayCalendar /> : config.layout === "lists" ? <DisplayLists /> : <DisplayCards config={config} />}
      </div>
    </ElevationProvider>
  );
}

/** Fullscreen interactive calendar layout — tap a day for its summary. */
function DisplayCalendar() {
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [day, setDay] = useState<Date | null>(null);
  const range = useMemo(() => viewRange("month", anchor), [anchor.getTime()]);
  const { data: instances } = useEventsRange(range.start, range.end);
  const { data: members } = useMembers();

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold">{format(anchor, "MMMM yyyy")}</h2>
        <button type="button" aria-label="Previous month" className="rounded-xl bg-card p-2 shadow-card"
          onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" className="rounded-xl bg-card px-3 py-2 text-sm font-extrabold shadow-card"
          onClick={() => setAnchor(startOfMonth(new Date()))}>
          Today
        </button>
        <button type="button" aria-label="Next month" className="rounded-xl bg-card p-2 shadow-card"
          onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}>
          <ChevronRight size={20} />
        </button>
      </div>
      <MonthView
        anchor={anchor}
        instances={instances ?? []}
        members={members ?? []}
        onDayClick={(d) => setDay(d)}
        onEventClick={(instance) => setDay(new Date(instance.occurrenceStart))}
      />
      {day && (
        <DayModal day={day} members={members ?? []} canManageEvents={false} onClose={() => setDay(null)} />
      )}
    </div>
  );
}

/** Lists-only layout — every pinned list big and touchable (all lists if none pinned). */
function DisplayLists() {
  const { data: lists } = useChecklists();
  const { data: stores } = useStores();
  const mutations = useChecklistMutations();
  const { ensure } = useElevation();

  const pinned = (lists ?? []).filter((l) => l.pinnedToDashboard);
  const shown = pinned.length ? pinned : (lists ?? []);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {shown.map((list) => {
        const done = list.items.filter((i) => i.checked).length;
        return (
          <div key={list.id} className="rounded-card bg-card p-4 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">{list.icon}</span>
              <h2 className="font-extrabold">{list.title}</h2>
              <span className="text-xs font-bold text-ink-soft">{done}/{list.items.length}</span>
              {list.needBy !== null && (
                <span className="rounded-full bg-sun/20 px-2 py-0.5 text-[10px] font-extrabold">
                  need by {format(list.needBy, "EEE")}
                </span>
              )}
            </div>
            <ul className="space-y-1">
              {list.items.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-cream">
                    <input type="checkbox" checked={item.checked} className="h-6 w-6 accent-leaf"
                      onChange={() => void ensure().then((ok) => ok && mutations.toggleItem.mutate({ listId: list.id, itemId: item.id }))} />
                    <span className={`flex-1 truncate font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                      {item.text}
                      {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
                    </span>
                    {item.store && <StoreChip store={item.store} stores={stores ?? []} muted={item.checked} />}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {shown.length === 0 && (
        <p className="rounded-card bg-card p-8 text-center font-semibold text-ink-soft shadow-card">No lists yet.</p>
      )}
    </div>
  );
}

/** Card dashboard layout — today, chores, pinned lists, plugin cards. */
function DisplayCards({ config }: { config: DisplayConfig }) {
  const { data } = useDashboard();
  const tasks = useTaskMutations();
  const lists = useChecklistMutations();
  const { ensure } = useElevation();

  if (!data) {
    return <div className="flex h-64 items-center justify-center text-5xl"><span className="animate-pop">🏡</span></div>;
  }

  const columns = [config.showEvents, config.showChores, config.showLists].filter(Boolean).length || 1;

  return (
    <div className={`grid gap-4 ${columns === 1 ? "" : columns === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      {config.showEvents && (
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
      )}

      {config.showChores && (
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
                      onClick={() => void ensure().then((ok) => ok && tasks.complete.mutate({ id: task.id, occurrenceDate: task.occurrenceDate }))}
                      className={`flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition active:scale-[0.98] ${
                        task.completed ? "border-leaf/40 bg-leaf/10 opacity-60" : "border-line bg-cream"
                      }`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                        task.completed ? "border-leaf bg-leaf text-white" : "border-line bg-card"
                      }`}>
                        {task.completed ? <Check size={16} /> : <span className="text-xs">{task.icon}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className={`block font-bold ${task.completed ? "line-through" : ""}`}>{task.title}</span>
                        {task.steps.length > 0 && !task.completed && (
                          <span className="block truncate text-xs font-semibold text-ink-soft">
                            {task.steps.join(" → ")}
                          </span>
                        )}
                      </span>
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
      )}

      {config.showLists && (
        <section className="space-y-4">
          {data.pinnedLists.map((list) => (
            <div key={list.id} className="rounded-card bg-card p-4 shadow-card">
              <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-ink-soft">
                {list.icon} {list.title}
                {list.needBy !== null && (
                  <span className="ml-2 rounded-full bg-sun/20 px-2 py-0.5 text-[10px] font-extrabold normal-case text-ink">
                    need by {format(list.needBy, "EEE")}
                  </span>
                )}
              </h2>
              <ul className="space-y-1">
                {list.items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-cream">
                      <input type="checkbox" checked={item.checked} className="h-5 w-5 accent-leaf"
                        onChange={() => void ensure().then((ok) => ok && lists.toggleItem.mutate({ listId: list.id, itemId: item.id }))} />
                      <span className={`font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                        {item.text}
                        {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
                        {item.store && <span className="ml-1.5 rounded-full bg-sky/10 px-1.5 text-[10px] font-extrabold text-sky">{item.store}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <PluginSlot slot="dashboard.card" />
        </section>
      )}
    </div>
  );
}
