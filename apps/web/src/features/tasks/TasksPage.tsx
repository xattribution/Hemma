import { useState } from "react";
import { ArrowLeftRight, Check, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { Me, Member, Task, TaskInput, TaskStep } from "@coord/shared";
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

  // Checking something off must never make it vanish mid-tap: anything done
  // today stays on the board (struck through) so you see it land — and can
  // untick a mistake.
  const doneToday = (t: Task) =>
    t.completedAt !== null && new Date(t.completedAt).toDateString() === new Date().toDateString();
  const tasks = (data?.tasks ?? []).filter((t) => t.dueToday || !t.completed || doneToday(t));
  // Your own column comes first (kids see their chores right away).
  const ordered = [...(members ?? [])].sort((a, b) =>
    a.id === me.member.id ? -1 : b.id === me.member.id ? 1 : 0,
  );
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const columns: { member: Member | null; tasks: Task[] }[] = [
    ...ordered.map((member) => ({ member, tasks: tasks.filter((t) => t.assigneeId === member.id) })),
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
                  <span className="text-xl">👪</span>
                  <span className="font-extrabold text-ink-soft">Family & up for grabs</span>
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
                  className={`flex items-center gap-2 rounded-xl border-2 border-line px-2 py-2 transition ${task.completed ? "opacity-50" : ""}`}>
                  {task.steps.length > 0 ? (
                    /* Multi-part chores green up only through their steps —
                       this circle just reports progress. */
                    <span aria-label={`${task.stepsDone.length} of ${task.steps.length} steps done`}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px] text-[11px] font-extrabold ${
                        task.completed ? "border-leaf bg-leaf text-white" : "border-ink-soft/30 bg-cream text-ink-soft"
                      }`}>
                      {task.completed ? <Check size={20} /> : `${task.stepsDone.length}/${task.steps.length}`}
                    </span>
                  ) : (
                    /* An unmistakable checkbox — same language as lists & the kid app. */
                    <button type="button" onClick={() => toggle(task)}
                      aria-label={task.completed ? "Mark not done" : "Mark done"}
                      title={task.completed ? "Mark not done" : "Mark done"}
                      className={`group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px] transition active:scale-90 ${
                        task.completed ? "border-leaf bg-leaf text-white" : "border-ink-soft/40 bg-cream hover:border-leaf"
                      }`}>
                      <Check size={20} className={task.completed ? "" : "opacity-0 text-leaf transition group-hover:opacity-60"} />
                    </button>
                  )}
                  <span className="shrink-0 text-xl" aria-hidden>{task.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-bold ${task.completed ? "line-through" : ""}`}>{task.title}</p>
                    {task.steps.length > 0 && (
                      <div className="mt-0.5 space-y-0.5">
                        {task.steps.map((step, i) => {
                          const stepDone = task.stepsDone.includes(i);
                          const stepOwner = step.assigneeId ? memberById.get(step.assigneeId) : null;
                          const lockedForMe = me.member.role === "child" && !!step.assigneeId && step.assigneeId !== me.member.id;
                          return (
                            <button key={i} type="button" disabled={lockedForMe}
                              title={lockedForMe && stepOwner ? `${stepOwner.name}'s step` : undefined}
                              onClick={() => mutations.toggleStep.mutate(
                                { id: task.id, stepIndex: i, occurrenceDate: task.occurrenceDate },
                                { onError: (err) => showToast(err.message, "error") },
                              )}
                              className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs font-semibold ${
                                lockedForMe ? "opacity-50" : "hover:bg-cream"
                              }`}>
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
                                stepDone ? "border-leaf bg-leaf text-white" : "border-ink-soft/40 bg-cream"
                              }`}>{stepDone ? "✓" : ""}</span>
                              <span className={`min-w-0 flex-1 truncate ${stepDone ? "text-ink-soft line-through" : "text-ink-soft"}`}>{step.text}</span>
                              {step.points ? <span className="shrink-0 text-[10px] font-extrabold text-sun">★{step.points}</span> : null}
                              {stepOwner && <Avatar member={stepOwner} size="sm" />}
                            </button>
                          );
                        })}
                      </div>
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
  const [steps, setSteps] = useState<TaskStep[]>(task?.steps ?? []);
  const busy = mutations.create.isPending || mutations.update.isPending;

  const setStep = (index: number, patch: Partial<TaskStep>) =>
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: TaskInput = {
      title, icon, notes: task?.notes ?? "", kind: "chore",
      assigneeId, dueAt: task?.dueAt ?? null,
      repeat: repeat === "" ? null : repeat,
      points: points ? Number(points) : null,
      steps: steps.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() })),
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
          <label className={labelCls}>
            Steps — the chore finishes when every step is checked. Give a step
            to a person to make this a family job; give it points to reward
            whoever does it.
          </label>
          <div className="space-y-1.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input className={`${inputCls} flex-1 py-1.5 text-sm`} placeholder="vacuum the rug"
                  value={step.text} onChange={(e) => setStep(i, { text: e.target.value })} maxLength={120} />
                <input className="w-14 rounded-xl border-2 border-line bg-cream px-2 py-1.5 text-sm font-bold"
                  type="number" min={0} max={1000} placeholder="★"
                  title="Points for this step"
                  value={step.points ?? ""}
                  onChange={(e) => setStep(i, { points: e.target.value ? Number(e.target.value) : null })} />
                <select className="w-24 rounded-xl border-2 border-line bg-cream px-1.5 py-1.5 text-sm font-bold"
                  title="Whose step?"
                  value={step.assigneeId ?? ""}
                  onChange={(e) => setStep(i, { assigneeId: e.target.value || null })}>
                  <option value="">anyone</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>
                  ))}
                </select>
                <button type="button" aria-label="Remove step" className="rounded-lg p-1 text-ink-soft hover:bg-line"
                  onClick={() => setSteps((current) => current.filter((_, idx) => idx !== i))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" className={`${ghostBtn} text-sm`}
              onClick={() => setSteps((current) => [...current, { text: "", assigneeId: null, points: null }])}>
              <Plus size={14} className="mr-1 inline" /> Add step
            </button>
          </div>
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
