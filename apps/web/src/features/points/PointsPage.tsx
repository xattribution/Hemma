import { useState } from "react";
import { Crown, Minus, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { GoalInput, GoalStanding, Me, Member, PointGoal } from "@coord/shared";
import { can } from "@coord/shared";
import { useMembers, usePointsMutations, usePointsSummary } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

/**
 * Points central: your total up top, every active goal as a fillable bar
 * with milestone ticks, family standings, and the recent ledger (every
 * plus and minus has a reason). Parents get adjust + goal management.
 */
export function PointsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data } = usePointsSummary();
  const { data: members } = useMembers();
  const isParent = can(me.member.role, "settings.manage");
  const [adjusting, setAdjusting] = useState(false);
  const [editingGoal, setEditingGoal] = useState<PointGoal | "new" | null>(null);

  if (!data) return null;
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const myTotal = data.totals.find((t) => t.memberId === me.member.id)?.total ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Points</h2>
        {isParent && (
          <div className="flex gap-2">
            <button type="button" className={ghostBtn} onClick={() => setAdjusting(true)}>
              <Star size={16} className="mr-1 inline text-sun" /> Adjust
            </button>
            <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setEditingGoal("new")}>
              <Plus size={18} /> Goal
            </button>
          </div>
        )}
      </div>

      {/* my total + family totals */}
      <section className="rounded-card bg-card p-4 shadow-card">
        <div className="mb-3 flex items-center gap-3">
          <Avatar member={me.member} size="lg" />
          <div>
            <p className="text-3xl font-extrabold text-sun">★ {myTotal}</p>
            <p className="text-sm font-bold text-ink-soft">your points, all time</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.totals.map(({ memberId, total }) => {
            const member = memberById.get(memberId);
            if (!member || memberId === me.member.id) return null;
            return (
              <span key={memberId} className="flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-sm font-bold">
                <Avatar member={member} size="sm" /> {member.name} <span className="text-sun">★{total}</span>
              </span>
            );
          })}
        </div>
      </section>

      {/* goals */}
      {data.goals.length === 0 && (
        <section className="rounded-card bg-card p-6 text-center shadow-card">
          <p className="text-3xl">🏆</p>
          <p className="mt-1 font-extrabold">No goals yet</p>
          <p className="text-sm font-semibold text-ink-soft">
            {isParent ? "Set one up — “50 points by Saturday”, “first to 100”, monthly streaks…" : "Ask a parent to set one up!"}
          </p>
        </section>
      )}
      {data.goals.map(({ goal, windowEnd, standings }) => (
        <GoalCard key={goal.id} goal={goal} windowEnd={windowEnd} standings={standings}
          memberById={memberById} isParent={isParent} onEdit={() => setEditingGoal(goal)} />
      ))}

      {/* recent ledger */}
      <section className="rounded-card bg-card p-4 shadow-card">
        <h3 className="mb-2 font-extrabold">Recent</h3>
        <div className="space-y-1">
          {data.recent.length === 0 && <p className="text-sm font-semibold text-ink-soft">Nothing yet — go do a chore! 🧹</p>}
          {data.recent.map((entry) => {
            const member = memberById.get(entry.memberId);
            return (
              <div key={entry.id} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm">
                {member && <Avatar member={member} size="sm" />}
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-soft">{entry.reason}</span>
                <span className={`shrink-0 font-extrabold ${entry.delta >= 0 ? "text-leaf" : "text-coral"}`}>
                  {entry.delta >= 0 ? "+" : ""}{entry.delta}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {adjusting && <AdjustModal members={members ?? []} onClose={() => setAdjusting(false)} />}
      {editingGoal && (
        <GoalModal goal={editingGoal === "new" ? null : editingGoal} members={members ?? []}
          onClose={() => setEditingGoal(null)} />
      )}
    </div>
  );
}

// ---------- goal card: fillable bar with milestone ticks ----------

function GoalCard({ goal, windowEnd, standings, memberById, isParent, onEdit }: {
  goal: PointGoal; windowEnd: number | null; standings: GoalStanding[];
  memberById: Map<string, Member>; isParent: boolean; onEdit: () => void;
}) {
  const mutations = usePointsMutations();
  // race mode: the winner is whoever crossed the line first
  const winner = goal.mode === "race"
    ? standings.filter((s) => s.reachedAt !== null).sort((a, b) => a.reachedAt! - b.reachedAt!)[0]
    : null;

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-2xl">{goal.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{goal.title}</p>
          <p className="text-xs font-bold text-ink-soft">
            {goal.mode === "race" ? "First to" : "Reach"} {goal.target} ★
            {goal.repeat === "monthly" ? " · resets monthly" : windowEnd ? ` · by ${new Date(windowEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
            {goal.reward ? ` · 🎁 ${goal.reward}` : ""}
          </p>
        </div>
        {isParent && (
          <>
            <button type="button" className="rounded-lg p-1.5 text-ink-soft hover:bg-line" onClick={onEdit} aria-label="Edit goal">
              <Pencil size={14} />
            </button>
            <button type="button" className="rounded-lg p-1.5 text-ink-soft hover:text-coral" aria-label="Delete goal"
              onClick={() => mutations.removeGoal.mutate(goal.id, { onError: (err) => showToast(err.message, "error") })}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      <div className="space-y-2">
        {standings.map((standing) => {
          const member = memberById.get(standing.memberId);
          if (!member) return null;
          const clamped = Math.max(0, Math.min(standing.earned, goal.target));
          const pct = (clamped / goal.target) * 100;
          const isWinner = winner?.memberId === standing.memberId;
          return (
            <div key={standing.memberId} className="flex items-center gap-2">
              <Avatar member={member} size="sm" />
              <div className="relative h-6 flex-1 overflow-hidden rounded-full bg-cream">
                {/* milestone ticks at quarters */}
                {[25, 50, 75].map((tick) => (
                  <span key={tick} className="absolute top-0 h-full w-px bg-line" style={{ left: `${tick}%` }} />
                ))}
                <span className={`absolute inset-y-0 left-0 rounded-full transition-all ${standing.reached ? "bg-leaf" : "bg-sun"}`}
                  style={{ width: `${pct}%`, backgroundColor: standing.reached ? undefined : member.color }} />
                <span className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-extrabold text-ink">
                  {standing.earned}/{goal.target}
                </span>
              </div>
              {standing.reached && (isWinner ? <Crown size={18} className="text-sun" /> : <span>🎉</span>)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- parent modals ----------

function AdjustModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const mutations = usePointsMutations();
  const [memberId, setMemberId] = useState(members.find((m) => m.role === "child")?.id ?? members[0]?.id ?? "");
  const [amount, setAmount] = useState("5");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [reason, setReason] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const delta = direction * Math.abs(Number(amount));
    mutations.adjust.mutate(
      { memberId, delta, reason },
      {
        onSuccess: () => { showToast(delta > 0 ? "Points given ⭐" : "Points taken"); onClose(); },
        onError: (err) => showToast(err.message, "error"),
      },
    );
  };

  return (
    <Modal title="Adjust points" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Who</label>
          <select className={inputCls} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDirection(1)}
            className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold ${direction === 1 ? "border-leaf bg-leaf/10 text-leaf" : "border-line"}`}>
            <Plus size={14} className="mr-1 inline" /> Give
          </button>
          <button type="button" onClick={() => setDirection(-1)}
            className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold ${direction === -1 ? "border-coral bg-coral-soft text-coral" : "border-line"}`}>
            <Minus size={14} className="mr-1 inline" /> Take away
          </button>
        </div>
        <div>
          <label className={labelCls}>How many</label>
          <input className={inputCls} type="number" min={1} max={1000} value={amount}
            onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Why (shows in their history)</label>
          <input className={inputCls} placeholder={direction === 1 ? "Helped grandma carry groceries" : "Left the bike out in the rain"}
            value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200} />
        </div>
        <button className={`${primaryBtn} w-full`} disabled={mutations.adjust.isPending || !reason.trim() || !Number(amount)}>
          {direction === 1 ? "Give points" : "Take points"}
        </button>
      </form>
    </Modal>
  );
}

function GoalModal({ goal, members, onClose }: { goal: PointGoal | null; members: Member[]; onClose: () => void }) {
  const mutations = usePointsMutations();
  const kids = members.filter((m) => m.role === "child");
  const [title, setTitle] = useState(goal?.title ?? "");
  const [mode, setMode] = useState<"target" | "race">(goal?.mode ?? "target");
  const [target, setTarget] = useState(goal?.target.toString() ?? "50");
  const [reward, setReward] = useState(goal?.reward ?? "");
  const [monthly, setMonthly] = useState(goal?.repeat === "monthly");
  const [deadline, setDeadline] = useState(goal?.endsAt ? new Date(goal.endsAt).toISOString().slice(0, 10) : "");
  const [memberIds, setMemberIds] = useState<string[] | null>(goal?.memberIds ?? null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: GoalInput = {
      title, icon: goal?.icon ?? "🏆", mode, target: Number(target),
      memberIds, reward,
      startsAt: goal?.startsAt ?? Date.now(),
      endsAt: monthly || !deadline ? null : new Date(`${deadline}T23:59:59`).getTime(),
      repeat: monthly ? "monthly" : "none",
    };
    const options = {
      onSuccess: onClose,
      onError: (err: Error) => showToast(err.message, "error"),
    };
    if (goal) mutations.updateGoal.mutate({ id: goal.id, ...input }, options);
    else mutations.createGoal.mutate(input, options);
  };

  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input className={inputCls} placeholder="Movie night fund" value={title}
          onChange={(e) => setTitle(e.target.value)} required maxLength={80} autoFocus />
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("target")}
            className={`flex-1 rounded-xl border-2 px-3 py-2 text-left ${mode === "target" ? "border-coral bg-coral-soft" : "border-line"}`}>
            <span className="block font-bold">📊 Everyone fills a bar</span>
            <span className="text-xs font-semibold text-ink-soft">each person works toward the target</span>
          </button>
          <button type="button" onClick={() => setMode("race")}
            className={`flex-1 rounded-xl border-2 px-3 py-2 text-left ${mode === "race" ? "border-coral bg-coral-soft" : "border-line"}`}>
            <span className="block font-bold">🏁 First past the post</span>
            <span className="text-xs font-semibold text-ink-soft">first to reach it wins</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Target points</label>
            <input className={inputCls} type="number" min={1} max={100000} value={target}
              onChange={(e) => setTarget(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Reward (optional)</label>
            <input className={inputCls} placeholder="Pizza pick, $10…" value={reward}
              onChange={(e) => setReward(e.target.value)} maxLength={120} />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-line px-3 py-2">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
          <span className="text-sm font-bold">Resets every month</span>
        </label>
        {!monthly && (
          <div>
            <label className={labelCls}>Finish by (optional)</label>
            <input className={inputCls} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        )}
        <div>
          <label className={labelCls}>Who's in?</label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setMemberIds(null)}
              className={`rounded-full border-2 px-2.5 py-1 text-sm font-bold ${memberIds === null ? "border-coral bg-coral-soft" : "border-line"}`}>
              🧒 All kids
            </button>
            {(memberIds === null ? kids : members).map((m) => {
              const active = memberIds?.includes(m.id) ?? false;
              return (
                <button key={m.id} type="button" disabled={memberIds === null}
                  onClick={() =>
                    setMemberIds((current) =>
                      current === null ? [m.id]
                        : current.includes(m.id) ? current.filter((id) => id !== m.id) : [...current, m.id],
                    )
                  }
                  className={`rounded-full border-2 px-2.5 py-1 text-sm font-bold ${
                    memberIds === null ? "border-line opacity-40" : active ? "text-white" : "border-line"
                  }`}
                  style={active ? { backgroundColor: m.color, borderColor: m.color } : undefined}>
                  {m.avatar} {m.name}
                </button>
              );
            })}
            {memberIds !== null && (
              <button type="button" className={`${ghostBtn} px-2 py-1 text-xs`} onClick={() => setMemberIds(null)}>
                back to all kids
              </button>
            )}
          </div>
        </div>
        <button className={`${primaryBtn} w-full`} disabled={!title.trim() || !Number(target) || (memberIds !== null && memberIds.length === 0)}>
          {goal ? "Save goal" : "Create goal"}
        </button>
      </form>
    </Modal>
  );
}
