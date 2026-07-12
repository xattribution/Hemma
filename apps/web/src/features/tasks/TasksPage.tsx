import { useState } from "react";
import { ArrowLeftRight, Check, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { Me, Member, Task, TaskInput } from "@coord/shared";
import { can } from "@coord/shared";
import { useMembers, useTaskMutations, useTasks } from "../../api/queries";
import { Avatar, MemberChip } from "../../components/Avatar";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

const CHORE_ICONS = ["⭐", "🐶", "🍽️", "🗑️", "🛏️", "🪴", "🧹", "🧺", "📚", "🚿", "🎒", "🧸"];
type Repeat = "" | "daily" | "weekdays" | "0" | "6";

export function TasksPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data } = useTasks();
  const { data: members } = useMembers();
  const mutations = useTaskMutations();
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [swapping, setSwapping] = useState<Task | null>(null);
  const isParent = can(me.member.role, "task.manage", me.member.grants);

  const tasks = (data?.tasks ?? []).filter((t) => t.dueToday || !t.completed);
  const columns: { member: Member | null; tasks: Task[] }[] = [
    ...(members ?? []).map((member) => ({ member, tasks: tasks.filter((t) => t.assigneeId === member.id) })),
    { member: null, tasks: tasks.filter((t) => !t.assigneeId) },
  ];

  const toggle = (task: Task) =>
    mutations.complete.mutate(
      { id: task.id, occurrenceDate: task.occurrenceDate },
      { onError: (err) => showToast(err.message, "error") },
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Today's chores & to-dos</h2>
        {isParent && (
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setEditing("new")}>
            <Plus size={18} /> Chore
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map(({ member, tasks: columnTasks }) => (
          <div key={member?.id ?? "unassigned"} className="rounded-card bg-card p-3 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              {member ? (
                <>
                  <Avatar member={member} size="sm" />
                  <span className="font-extrabold">{member.name}</span>
                </>
              ) : (
                <>
                  <span className="text-xl">🙋</span>
                  <span className="font-extrabold text-ink-soft">Up for grabs</span>
                </>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                {(() => {
                  const pts = columnTasks.filter((t) => t.completed).reduce((sum, t) => sum + (t.points ?? 0), 0);
                  return pts > 0 ? <span className="rounded-full bg-sun/20 px-1.5 py-0.5 text-sun">★ {pts} today</span> : null;
                })()}
                {columnTasks.filter((t) => t.completed).length}/{columnTasks.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {columnTasks.length === 0 && (
                <p className="rounded-xl bg-cream px-3 py-4 text-center text-sm font-semibold text-ink-soft">
                  All clear! 🎉
                </p>
              )}
              {columnTasks.map((task) => (
                <div key={task.id}
                  className={`flex items-center gap-2 rounded-xl border-2 border-line px-2 py-1.5 transition ${task.completed ? "opacity-50" : ""}`}>
                  <button type="button" onClick={() => toggle(task)} aria-label="Complete"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 ${
                      task.completed ? "border-leaf bg-leaf text-white" : "border-line bg-cream hover:border-leaf"
                    }`}>
                    {task.completed ? <Check size={18} /> : <span className="text-sm">{task.icon}</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-bold ${task.completed ? "line-through" : ""}`}>{task.title}</p>
                    {task.steps.length > 0 && !task.completed && (
                      <p className="truncate text-[11px] font-semibold text-ink-soft">
                        {task.steps.map((step, i) => `${i + 1}. ${step}`).join("  ")}
                      </p>
                    )}
                    <p className="text-[11px] font-semibold text-ink-soft">
                      {task.repeat === "daily" ? "Every day" : task.repeat === "weekdays" ? "Weekdays" : task.repeat ? "Weekly" : "One-time"}
                      {task.points ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-sun">
                          <Star size={10} fill="currentColor" /> {task.points}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <button type="button" className="rounded-lg p-1.5 text-ink-soft hover:bg-line" title="Swap to someone else"
                    onClick={() => setSwapping(task)}>
                    <ArrowLeftRight size={15} />
                  </button>
                  {isParent && (
                    <button type="button" className="rounded-lg p-1.5 text-ink-soft hover:bg-line" title="Edit"
                      onClick={() => setEditing(task)}>
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TaskModal task={editing === "new" ? null : editing} members={members ?? []} onClose={() => setEditing(null)} />
      )}
      {swapping && (
        <Modal title={`Who takes "${swapping.title}"?`} onClose={() => setSwapping(null)}>
          <div className="flex flex-wrap gap-2">
            {(members ?? [])
              .filter((m) => m.id !== swapping.assigneeId)
              .map((member) => (
                <MemberChip key={member.id} member={member}
                  onClick={() =>
                    mutations.reassign.mutate(
                      { id: swapping.id, toMemberId: member.id },
                      {
                        onSuccess: () => { setSwapping(null); showToast(`"${swapping.title}" is now ${member.name}'s ✨`); },
                        onError: (err) => showToast(err.message, "error"),
                      },
                    )
                  } />
              ))}
            <button type="button" className={ghostBtn}
              onClick={() =>
                mutations.reassign.mutate(
                  { id: swapping.id, toMemberId: null },
                  { onSuccess: () => setSwapping(null) },
                )
              }>
              🙋 Up for grabs
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskModal({ task, members, onClose }: { task: Task | null; members: Member[]; onClose: () => void }) {
  const mutations = useTaskMutations();
  const [title, setTitle] = useState(task?.title ?? "");
  const [icon, setIcon] = useState(task?.icon ?? "⭐");
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const [repeat, setRepeat] = useState<Repeat>((task?.repeat as Repeat) ?? "daily");
  const [points, setPoints] = useState(task?.points?.toString() ?? "");
  const [steps, setSteps] = useState((task?.steps ?? []).join("\n"));
  const busy = mutations.create.isPending || mutations.update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: TaskInput = {
      title, icon, notes: task?.notes ?? "", kind: "chore",
      assigneeId, dueAt: task?.dueAt ?? null,
      repeat: repeat === "" ? null : repeat,
      points: points ? Number(points) : null,
      steps: steps.split("\n").map((l) => l.trim()).filter(Boolean),
    };
    const options = { onSuccess: onClose, onError: (err: Error) => showToast(err.message, "error") };
    if (task) mutations.update.mutate({ id: task.id, ...input }, options);
    else mutations.create.mutate(input, options);
  };

  return (
    <Modal title={task ? "Edit chore" : "New chore"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input className={inputCls} placeholder="What needs doing?" value={title}
          onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={120} />
        <div>
          <label className={labelCls}>Icon</label>
          <div className="flex flex-wrap gap-1">
            {CHORE_ICONS.map((i) => (
              <button key={i} type="button" onClick={() => setIcon(i)}
                className={`rounded-lg p-1.5 text-xl ${icon === i ? "bg-coral-soft ring-2 ring-coral" : "hover:bg-line"}`}>
                {i}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Whose job?</label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setAssigneeId(null)}
              className={`rounded-full border-2 border-line px-2.5 py-1 text-sm font-bold ${assigneeId === null ? "bg-ink text-cream" : "bg-card"}`}>
              🙋 Up for grabs
            </button>
            {members.map((member) => (
              <MemberChip key={member.id} member={member} active={assigneeId === member.id}
                onClick={() => setAssigneeId(member.id)} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Repeats</label>
            <select className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              <option value="daily">Every day</option>
              <option value="weekdays">School days</option>
              <option value="6">Saturdays</option>
              <option value="0">Sundays</option>
              <option value="">One-time</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Points (optional)</label>
            <input className={inputCls} type="number" min={0} max={1000} value={points}
              onChange={(e) => setPoints(e.target.value)} placeholder="5" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Steps (one per line — shows inside the chore)</label>
          <textarea className={`${inputCls} min-h-20 text-sm`} value={steps} onChange={(e) => setSteps(e.target.value)}
            placeholder={"vacuum the rug\npick up toys\nfluff the pillows"} />
        </div>
        <div className="flex items-center justify-between pt-1">
          {task ? (
            <button type="button" onClick={() => mutations.remove.mutate(task.id, { onSuccess: onClose })}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 font-bold text-coral transition hover:bg-coral-soft">
              <Trash2 size={16} /> Delete
            </button>
          ) : (
            <span />
          )}
          <button className={primaryBtn} disabled={busy || !title.trim()}>
            {task ? "Save" : "Add chore"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
