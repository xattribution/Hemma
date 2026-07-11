import { useState } from "react";
import { Pin, PinOff, Plus, Trash2, X } from "lucide-react";
import type { Checklist, Me } from "@coord/shared";
import { can } from "@coord/shared";
import { useChecklistMutations, useChecklists } from "../../api/queries";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

const LIST_ICONS = ["🛒", "🏖️", "🎒", "🎁", "🧳", "🏕️", "📦", "🎄"];

export function ListsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data: lists } = useChecklists();
  const mutations = useChecklistMutations();
  const [creating, setCreating] = useState(false);
  const isParent = can(me.member.role, "checklist.manage");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Family lists</h2>
        {isParent && (
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setCreating(true)}>
            <Plus size={18} /> List
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(lists ?? []).map((list) => (
          <ListCard key={list.id} list={list} isParent={isParent} />
        ))}
        {lists?.length === 0 && (
          <p className="rounded-card bg-card p-8 text-center font-semibold text-ink-soft shadow-card">
            No lists yet — start a shopping list! 🛒
          </p>
        )}
      </div>

      {creating && <NewListModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function ListCard({ list, isParent }: { list: Checklist; isParent: boolean }) {
  const mutations = useChecklistMutations();
  const [text, setText] = useState("");
  const done = list.items.filter((i) => i.checked).length;

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    // "Milk x2" → quantity shorthand
    const match = /^(.*?)\s+x(\S+)$/i.exec(text.trim());
    mutations.addItem.mutate(
      { listId: list.id, text: match?.[1] ?? text.trim(), quantity: match?.[2] ?? null },
      { onError: (err) => showToast(err.message, "error") },
    );
    setText("");
  };

  return (
    <div className="rounded-card bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">{list.icon}</span>
        <h3 className="font-extrabold">{list.title}</h3>
        <span className="text-xs font-bold text-ink-soft">{done}/{list.items.length}</span>
        {isParent && (
          <span className="ml-auto flex gap-1">
            <button type="button" title={list.pinnedToDashboard ? "Unpin from dashboard" : "Pin to dashboard"}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
              onClick={() => mutations.update.mutate({ id: list.id, pinnedToDashboard: !list.pinnedToDashboard })}>
              {list.pinnedToDashboard ? <Pin size={15} className="text-coral" /> : <PinOff size={15} />}
            </button>
            <button type="button" title="Delete list" className="rounded-lg p-1.5 text-ink-soft hover:bg-line hover:text-coral"
              onClick={() => mutations.remove.mutate(list.id)}>
              <Trash2 size={15} />
            </button>
          </span>
        )}
      </div>

      {list.items.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${(done / list.items.length) * 100}%` }} />
        </div>
      )}

      <ul className="space-y-1">
        {list.items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2">
            <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-cream">
              <input type="checkbox" checked={item.checked} className="h-5 w-5 accent-leaf"
                onChange={() => mutations.toggleItem.mutate({ listId: list.id, itemId: item.id })} />
              <span className={`text-sm font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                {item.text}
                {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
              </span>
            </label>
            <button type="button" aria-label="Remove item"
              className="rounded p-1 text-ink-soft opacity-0 transition group-hover:opacity-100 hover:text-coral"
              onClick={() => mutations.removeItem.mutate({ listId: list.id, itemId: item.id })}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={addItem} className="mt-2 flex gap-2">
        <input className={`${inputCls} py-1.5 text-sm`} placeholder="Add item… (try “Milk x2”)" value={text}
          onChange={(e) => setText(e.target.value)} maxLength={200} />
        <button className={`${primaryBtn} px-3 py-1.5`} aria-label="Add">
          <Plus size={16} />
        </button>
      </form>
    </div>
  );
}

function NewListModal({ onClose }: { onClose: () => void }) {
  const mutations = useChecklistMutations();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🛒");

  return (
    <Modal title="New list" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutations.create.mutate(
            { title, icon, kind: "shopping", pinnedToDashboard: false },
            { onSuccess: onClose, onError: (err) => showToast(err.message, "error") },
          );
        }}
        className="space-y-4"
      >
        <input className={inputCls} placeholder="Groceries, packing, gifts…" value={title}
          onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={80} />
        <div>
          <label className={labelCls}>Icon</label>
          <div className="flex flex-wrap gap-1">
            {LIST_ICONS.map((i) => (
              <button key={i} type="button" onClick={() => setIcon(i)}
                className={`rounded-lg p-1.5 text-xl ${icon === i ? "bg-coral-soft ring-2 ring-coral" : "hover:bg-line"}`}>
                {i}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!title.trim()}>Create</button>
        </div>
      </form>
    </Modal>
  );
}
