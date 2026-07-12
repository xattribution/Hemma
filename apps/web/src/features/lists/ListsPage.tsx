import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Pin, PinOff, Plus, Tag, Trash2, X } from "lucide-react";
import type { Checklist, ChecklistItem, Me } from "@coord/shared";
import { can } from "@coord/shared";
import { useChecklistMutations, useChecklists } from "../../api/queries";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

const LIST_ICONS = ["🛒", "🏖️", "🎒", "🎁", "🧳", "🏕️", "📦", "🎄"];

/** "Milk x2 @costco" → { text: "Milk", quantity: "2", store: "costco" } */
function parseQuickAdd(raw: string): { text: string; quantity: string | null; store: string | null } {
  let text = raw.trim();
  let store: string | null = null;
  let quantity: string | null = null;
  const storeMatch = /\s@([\w& '-]+)$/.exec(text);
  if (storeMatch) {
    store = storeMatch[1]!.trim();
    text = text.slice(0, storeMatch.index).trim();
  }
  const qtyMatch = /^(.*?)\s+x(\S+)$/i.exec(text);
  if (qtyMatch) {
    text = qtyMatch[1]!.trim();
    quantity = qtyMatch[2]!;
  }
  return { text, quantity, store };
}

export function ListsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data: lists } = useChecklists();
  const mutations = useChecklistMutations();
  const [creating, setCreating] = useState(false);
  const isParent = can(me.member.role, "checklist.manage");

  // Stores already used anywhere — offered when tagging items.
  const knownStores = useMemo(
    () => [...new Set((lists ?? []).flatMap((l) => l.items.map((i) => i.store)).filter(Boolean) as string[])].sort(),
    [lists],
  );

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
          <ListCard key={list.id} list={list} isParent={isParent} knownStores={knownStores} />
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

function ListCard({ list, isParent, knownStores }: { list: Checklist; isParent: boolean; knownStores: string[] }) {
  const mutations = useChecklistMutations();
  const [text, setText] = useState("");
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [tagging, setTagging] = useState<ChecklistItem | null>(null);
  const done = list.items.filter((i) => i.checked).length;

  const stores = [...new Set(list.items.map((i) => i.store).filter(Boolean) as string[])].sort();
  const visibleItems = storeFilter ? list.items.filter((i) => i.store === storeFilter) : list.items;

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const parsed = parseQuickAdd(text);
    mutations.addItem.mutate(
      { listId: list.id, ...parsed },
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
        {list.needBy !== null && (
          <span className="flex items-center gap-1 rounded-full bg-sun/20 px-2 py-0.5 text-xs font-extrabold text-ink">
            <CalendarClock size={12} /> {format(list.needBy, "EEE MMM d")}
          </span>
        )}
        {isParent && (
          <span className="ml-auto flex gap-1">
            <NeedByButton list={list} />
            <button type="button" title={list.pinnedToDashboard ? "Unpin from displays" : "Pin to displays"}
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

      {stores.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          <button type="button" onClick={() => setStoreFilter(null)}
            className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${storeFilter === null ? "bg-ink text-cream" : "bg-line text-ink-soft"}`}>
            All
          </button>
          {stores.map((store) => (
            <button key={store} type="button" onClick={() => setStoreFilter(storeFilter === store ? null : store)}
              className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${storeFilter === store ? "bg-sky text-white" : "bg-sky/10 text-sky"}`}>
              {store}
            </button>
          ))}
        </div>
      )}

      {list.items.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${(done / list.items.length) * 100}%` }} />
        </div>
      )}

      <ul className="space-y-1">
        {visibleItems.map((item) => (
          <li key={item.id} className="group flex items-center gap-1.5">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-cream">
              <input type="checkbox" checked={item.checked} className="h-5 w-5 shrink-0 accent-leaf"
                onChange={() => mutations.toggleItem.mutate({ listId: list.id, itemId: item.id })} />
              <span className={`truncate text-sm font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                {item.text}
                {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
              </span>
            </label>
            <button type="button" title={item.store ? `From ${item.store} — tap to change` : "Tag a store"}
              onClick={() => setTagging(item)}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-extrabold transition ${
                item.store ? "bg-sky/10 text-sky" : "text-ink-soft opacity-0 group-hover:opacity-100 hover:bg-line"
              }`}>
              <Tag size={11} />
              {item.store ?? "store"}
            </button>
            <button type="button" aria-label="Remove item"
              className="shrink-0 rounded p-1 text-ink-soft opacity-0 transition group-hover:opacity-100 hover:text-coral"
              onClick={() => mutations.removeItem.mutate({ listId: list.id, itemId: item.id })}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={addItem} className="mt-2 flex gap-2">
        <input className={`${inputCls} py-1.5 text-sm`} placeholder="Add item… (try “Milk x2 @Costco”)" value={text}
          onChange={(e) => setText(e.target.value)} maxLength={260} />
        <button className={`${primaryBtn} px-3 py-1.5`} aria-label="Add">
          <Plus size={16} />
        </button>
      </form>

      {tagging && (
        <Modal title={`Where is "${tagging.text}" from?`} onClose={() => setTagging(null)}>
          <StorePicker
            current={tagging.store}
            knownStores={knownStores}
            onPick={(store) => {
              mutations.updateItem.mutate({ listId: list.id, itemId: tagging.id, patch: { store } });
              setTagging(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function StorePicker({ current, knownStores, onPick }: { current: string | null; knownStores: string[]; onPick: (store: string | null) => void }) {
  const [newStore, setNewStore] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {knownStores.map((store) => (
          <button key={store} type="button" onClick={() => onPick(store)}
            className={`rounded-full px-3 py-1.5 text-sm font-extrabold ${current === store ? "bg-sky text-white" : "bg-sky/10 text-sky"}`}>
            {store}
          </button>
        ))}
        {current && (
          <button type="button" className={ghostBtn} onClick={() => onPick(null)}>No store</button>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newStore.trim()) onPick(newStore.trim());
        }}
      >
        <input className={inputCls} placeholder="New store…" value={newStore} onChange={(e) => setNewStore(e.target.value)} maxLength={40} />
        <button className={`${primaryBtn} shrink-0 px-3`}>Tag</button>
      </form>
    </div>
  );
}

function NeedByButton({ list }: { list: Checklist }) {
  const mutations = useChecklistMutations();
  return (
    <label title="Need this list by a date? It'll show up in that day's summary."
      className="relative cursor-pointer rounded-lg p-1.5 text-ink-soft hover:bg-line">
      <CalendarClock size={15} />
      <input
        type="date"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={list.needBy ? format(list.needBy, "yyyy-MM-dd") : ""}
        onChange={(e) => {
          const value = e.target.value;
          mutations.update.mutate({
            id: list.id,
            needBy: value ? new Date(`${value}T12:00:00`).getTime() : null,
          });
        }}
      />
    </label>
  );
}

function NewListModal({ onClose }: { onClose: () => void }) {
  const mutations = useChecklistMutations();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🛒");
  const [needBy, setNeedBy] = useState("");

  return (
    <Modal title="New list" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutations.create.mutate(
            {
              title, icon, kind: "shopping", pinnedToDashboard: false,
              needBy: needBy ? new Date(`${needBy}T12:00:00`).getTime() : null,
            },
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
        <div>
          <label className={labelCls}>Need it by (optional)</label>
          <input className={inputCls} type="date" value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!title.trim()}>Create</button>
        </div>
      </form>
    </Modal>
  );
}
