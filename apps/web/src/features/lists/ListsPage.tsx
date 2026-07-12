import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import QRCode from "qrcode";
import {
  Eraser, CalendarClock, Link2, Pin, PinOff, Plus, Share2, Tag, Trash2, X,
} from "lucide-react";
import type { Checklist, ChecklistItem, Me, StoreTag } from "@coord/shared";
import { can } from "@coord/shared";
import { useChecklistMutations, useChecklists, useEventsRange, useSharedLists, useSharedListToggle, useStores } from "../../api/queries";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

const LIST_ICONS = ["🛒", "🏖️", "🎒", "🎁", "🧳", "🏕️", "📦", "🎄"];

export function StoreChip({ store, stores, onClick, muted }: { store: string; stores: StoreTag[]; onClick?: () => void; muted?: boolean }) {
  const color = stores.find((s) => s.name.toLowerCase() === store.toLowerCase())?.color ?? "#5a7d8c";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-extrabold text-white transition ${onClick ? "hover:brightness-110" : ""}`}
      style={{ backgroundColor: color, opacity: muted ? 0.55 : 1 }}>
      <Tag size={10} /> {store}
    </button>
  );
}

export function ListsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const { data: lists } = useChecklists();
  const { data: stores } = useStores();
  const [editing, setEditing] = useState<Checklist | "new" | null>(null);
  const isParent = can(me.member.role, "checklist.manage", me.member.grants);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Family lists</h2>
        {isParent && (
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={() => setEditing("new")}>
            <Plus size={18} /> List
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(lists ?? []).map((list) => (
          <ListCard key={list.id} list={list} isParent={isParent} stores={stores ?? []} onEdit={() => setEditing(list)} />
        ))}
        {lists?.length === 0 && (
          <p className="rounded-card bg-card p-8 text-center font-semibold text-ink-soft shadow-card">
            No lists yet — start a shopping list! 🛒
          </p>
        )}
      </div>

      <SharedInLists stores={stores ?? []} />

      {editing && <ListModal list={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Lists other families shared with us — live, checkable, and they simply
    vanish if the other side revokes. */
function SharedInLists({ stores }: { stores: StoreTag[] }) {
  const { data: shared } = useSharedLists();
  const toggle = useSharedListToggle();
  if (!shared?.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-extrabold">Shared with us</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {shared.map(({ peerId, peerName, list }) => {
          const done = list.items.filter((i) => i.checked).length;
          return (
            <div key={`${peerId}:${list.id}`} className="rounded-card border-2 border-dashed border-sky/40 bg-card p-4 shadow-card">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-2xl">{list.icon}</span>
                <h3 className="font-extrabold">{list.title}</h3>
                <span className="text-xs font-bold text-ink-soft">{done}/{list.items.length}</span>
                <span className="ml-auto rounded-full bg-sky/10 px-2 py-0.5 text-xs font-extrabold text-sky">
                  from {peerName}
                </span>
              </div>
              <ul className="space-y-1">
                {list.items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-cream">
                      <input type="checkbox" checked={item.checked} className="h-5 w-5 accent-leaf"
                        onChange={() => toggle.mutate({ peerId, remoteId: list.id, itemId: item.id })} />
                      <span className={`flex-1 truncate text-sm font-semibold ${item.checked ? "text-ink-soft line-through" : ""}`}>
                        {item.text}
                        {item.quantity && <span className="ml-1 text-xs font-bold text-ink-soft">× {item.quantity}</span>}
                      </span>
                      {item.store && <StoreChip store={item.store} stores={stores} muted={item.checked} />}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListCard({ list, isParent, stores, onEdit }: { list: Checklist; isParent: boolean; stores: StoreTag[]; onEdit: () => void }) {
  const mutations = useChecklistMutations();
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [tagging, setTagging] = useState<ChecklistItem | null>(null);
  const [sharing, setSharing] = useState(false);
  const done = list.items.filter((i) => i.checked).length;

  const usedStores = [...new Set(list.items.map((i) => i.store).filter(Boolean) as string[])].sort();
  const visibleItems = storeFilter ? list.items.filter((i) => i.store === storeFilter) : list.items;

  return (
    <div className="rounded-card bg-card p-4 shadow-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className="text-2xl" onClick={isParent ? onEdit : undefined} title={isParent ? "Edit list" : undefined}>
          {list.icon}
        </button>
        <h3 className="font-extrabold">{list.title}</h3>
        <span className="text-xs font-bold text-ink-soft">{done}/{list.items.length}</span>
        {list.needBy !== null && (
          <span className="flex items-center gap-1 rounded-full bg-sun/20 px-2 py-0.5 text-xs font-extrabold text-ink">
            <CalendarClock size={12} /> {format(list.needBy, "EEE MMM d")}
          </span>
        )}
        {list.linkedEventTitle && (
          <span className="flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-xs font-extrabold text-coral">
            <Link2 size={12} /> {list.linkedEventTitle}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button type="button" title="Share this list" className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
            onClick={() => setSharing(true)}>
            <Share2 size={15} />
          </button>
          {done > 0 && (
            <button type="button" title="Clear done items" className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
              onClick={() =>
                mutations.clearChecked.mutate(list.id, {
                  onSuccess: (r) => showToast(`Cleared ${r.removed} done item${r.removed === 1 ? "" : "s"} ✨`),
                })
              }>
              <Eraser size={15} />
            </button>
          )}
          {isParent && (
            <>
              <button type="button" title={list.pinnedToDashboard ? "Unpin from displays" : "Pin to displays"}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
                onClick={() => mutations.update.mutate({ id: list.id, pinnedToDashboard: !list.pinnedToDashboard })}>
                {list.pinnedToDashboard ? <Pin size={15} className="text-coral" /> : <PinOff size={15} />}
              </button>
              <button type="button" title="Delete list" className="rounded-lg p-1.5 text-ink-soft hover:bg-line hover:text-coral"
                onClick={() => mutations.remove.mutate(list.id)}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </span>
      </div>

      {usedStores.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          <button type="button" onClick={() => setStoreFilter(null)}
            className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${storeFilter === null ? "bg-ink text-cream" : "bg-line text-ink-soft"}`}>
            All
          </button>
          {usedStores.map((store) => (
            <StoreChip key={store} store={store} stores={stores} muted={storeFilter !== null && storeFilter !== store}
              onClick={() => setStoreFilter(storeFilter === store ? null : store)} />
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
            {item.store ? (
              <StoreChip store={item.store} stores={stores} muted={item.checked} onClick={() => setTagging(item)} />
            ) : (
              <button type="button" title="Tag a store" onClick={() => setTagging(item)}
                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold text-ink-soft opacity-0 transition group-hover:opacity-100 hover:bg-line">
                <Tag size={11} className="inline" /> store
              </button>
            )}
            <button type="button" aria-label="Remove item"
              className="shrink-0 rounded p-1 text-ink-soft opacity-0 transition group-hover:opacity-100 hover:text-coral"
              onClick={() => mutations.removeItem.mutate({ listId: list.id, itemId: item.id })}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      <AddItemRow listId={list.id} stores={stores} isMealPlan={list.kind === "meal"} />

      {tagging && (
        <Modal title={`Where is "${tagging.text}" from?`} onClose={() => setTagging(null)}>
          <StorePicker current={tagging.store} stores={stores}
            onPick={(store) => {
              mutations.updateItem.mutate({ listId: list.id, itemId: tagging.id, patch: { store } });
              setTagging(null);
            }} />
        </Modal>
      )}
      {sharing && <ShareModal list={list} onClose={() => setSharing(false)} />}
    </div>
  );
}

/** Structured quick-add: item, optional quantity (defaults to 1), optional store quick-tag. */
function AddItemRow({ listId, stores, isMealPlan }: { listId: string; stores: StoreTag[]; isMealPlan?: boolean }) {
  const mutations = useChecklistMutations();
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [store, setStore] = useState("");
  const [newStore, setNewStore] = useState("");
  const [alsoGrocery, setAlsoGrocery] = useState(true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const chosenStore = store === "__new" ? newStore.trim() || null : store || null;
    mutations.addItem.mutate(
      { listId, text: text.trim(), quantity: quantity.trim() || null, store: chosenStore, alsoGrocery: isMealPlan && alsoGrocery },
      { onError: (err) => showToast(err.message, "error") },
    );
    setText("");
    setQuantity("");
    if (store === "__new") setStore(newStore.trim());
    setNewStore("");
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input className={`${inputCls} min-w-0 flex-1 py-1.5 text-sm`} placeholder="Add item…" value={text}
          onChange={(e) => setText(e.target.value)} maxLength={200} />
        <input
          className="w-14 shrink-0 rounded-xl border-2 border-line bg-card px-1 py-1.5 text-center text-sm font-semibold text-ink outline-none focus:border-coral"
          placeholder="qty" title="Quantity (blank = 1)"
          value={quantity} onChange={(e) => setQuantity(e.target.value)} maxLength={8} />
        <button className={`${primaryBtn} shrink-0 px-3 py-1.5`} aria-label="Add" disabled={!text.trim()}>
          <Plus size={16} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setStore("")}
          className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${store === "" ? "bg-ink text-cream" : "bg-line text-ink-soft"}`}>
          any store
        </button>
        {stores.map((s) => (
          <button key={s.name} type="button" onClick={() => setStore(store === s.name ? "" : s.name)}
            className="rounded-full px-2 py-0.5 text-xs font-extrabold text-white transition"
            style={{ backgroundColor: s.color, opacity: store === "" || store === s.name ? 1 : 0.45 }}>
            {s.name}
          </button>
        ))}
        <button type="button" onClick={() => setStore(store === "__new" ? "" : "__new")}
          className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${store === "__new" ? "bg-sky text-white" : "bg-line text-ink-soft"}`}>
          + store
        </button>
        {store === "__new" && (
          <input className={`${inputCls} w-32 px-2 py-0.5 text-xs`} placeholder="Store name" value={newStore} autoFocus
            onChange={(e) => setNewStore(e.target.value)} maxLength={40} />
        )}
        {isMealPlan && (
          <label className="ml-auto flex items-center gap-1.5 text-xs font-extrabold text-ink-soft">
            <input type="checkbox" className="h-4 w-4 accent-leaf" checked={alsoGrocery}
              onChange={(e) => setAlsoGrocery(e.target.checked)} />
            also add to groceries
          </label>
        )}
      </div>
    </form>
  );
}

function StorePicker({ current, stores, onPick }: { current: string | null; stores: StoreTag[]; onPick: (store: string | null) => void }) {
  const [newStore, setNewStore] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {stores.map((s) => (
          <button key={s.name} type="button" onClick={() => onPick(s.name)}
            className="rounded-full px-3 py-1.5 text-sm font-extrabold text-white"
            style={{ backgroundColor: s.color, opacity: current && current !== s.name ? 0.55 : 1 }}>
            {s.name}
          </button>
        ))}
        {current && <button type="button" className={ghostBtn} onClick={() => onPick(null)}>No store</button>}
      </div>
      <form className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (newStore.trim()) onPick(newStore.trim()); }}>
        <input className={inputCls} placeholder="New store…" value={newStore} onChange={(e) => setNewStore(e.target.value)} maxLength={40} />
        <button className={`${primaryBtn} shrink-0 px-3`}>Tag</button>
      </form>
    </div>
  );
}

// ---------- Share: native share sheet, clipboard, email, QR ----------

function listAsText(list: Checklist): string {
  const lines = list.items
    .filter((i) => !i.checked)
    .map((i) => `• ${i.text}${i.quantity ? ` ×${i.quantity}` : ""}${i.store ? ` (${i.store})` : ""}`);
  const header = `${list.icon} ${list.title}${list.needBy ? ` — need by ${format(list.needBy, "EEE MMM d")}` : ""}`;
  return [header, ...lines].join("\n");
}

function ShareModal({ list, onClose }: { list: Checklist; onClose: () => void }) {
  const text = listAsText(list);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    void QRCode.toDataURL(text, { width: 280, margin: 1, color: { dark: "#3a3330", light: "#fdf8f0" } }).then(setQr);
  }, [text]);

  const nativeShare = async () => {
    try {
      await navigator.share({ title: list.title, text });
    } catch {
      // user dismissed the sheet — fine
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("List copied 📋");
    } catch {
      window.prompt("Copy the list:", text);
    }
  };

  return (
    <Modal title={`Share "${list.title}"`} onClose={onClose}>
      <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-card p-3 text-sm font-semibold">{text}</pre>
      <div className="mb-3 flex flex-wrap gap-2">
        {"share" in navigator && (
          <button type="button" className={primaryBtn} onClick={() => void nativeShare()}>Share…</button>
        )}
        <button type="button" className={ghostBtn} onClick={() => void copy()}>Copy</button>
        <a className={ghostBtn}
          href={`mailto:?subject=${encodeURIComponent(list.title)}&body=${encodeURIComponent(text)}`}>
          Email
        </a>
      </div>
      {qr && (
        <>
          <img src={qr} alt="List as QR code" className="mx-auto rounded-xl" />
          <p className="mt-1 text-center text-xs font-semibold text-ink-soft">
            Scan with any phone camera — the list text appears, ready to save to notes.
          </p>
        </>
      )}
    </Modal>
  );
}

// ---------- Create / edit list ----------

type ListType = "running" | "dated" | "event" | "meal";

function ListModal({ list, onClose }: { list: Checklist | null; onClose: () => void }) {
  const mutations = useChecklistMutations();
  const [title, setTitle] = useState(list?.title ?? "");
  const [icon, setIcon] = useState(list?.icon ?? "🛒");
  const [type, setType] = useState<ListType>(list?.kind === "meal" ? "meal" : list?.linkedEventId ? "event" : list?.needBy ? "dated" : "running");
  const [needBy, setNeedBy] = useState(list?.needBy ? format(list.needBy, "yyyy-MM-dd") : "");
  const [eventId, setEventId] = useState(list?.linkedEventId ?? "");

  // Upcoming events (next 60 days) for the event picker.
  const windowStart = useMemo(() => startOfDay(new Date()).getTime(), []);
  const { data: instances } = useEventsRange(windowStart, addDays(windowStart, 60).getTime());
  const upcoming = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const i of instances ?? []) {
      if (!seen.has(i.id)) seen.set(i.id, { id: i.id, label: `${i.title} — ${format(i.occurrenceStart, "EEE MMM d")}` });
    }
    return [...seen.values()];
  }, [instances]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title, icon, kind: (type === "meal" ? "meal" : "shopping") as "meal" | "shopping",
      pinnedToDashboard: list?.pinnedToDashboard ?? false,
      needBy: type === "dated" && needBy ? new Date(`${needBy}T12:00:00`).getTime() : null,
      linkedEventId: type === "event" && eventId ? eventId : null,
    };
    const options = { onSuccess: onClose, onError: (err: Error) => showToast(err.message, "error") };
    if (list) mutations.update.mutate({ id: list.id, ...payload }, options);
    else mutations.create.mutate(payload, options);
  };

  return (
    <Modal title={list ? "Edit list" : "New list"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
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
          <label className={labelCls}>What kind of list?</label>
          <div className="flex gap-2">
            {([["running", "🔄 Running"], ["dated", "📆 Need by"], ["event", "🔗 For an event"], ["meal", "🍽️ Meal plan"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setType(key)}
                className={`flex-1 rounded-xl border-2 px-2 py-2 text-sm font-bold ${type === key ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs font-semibold text-ink-soft">
            {type === "running" && "Always going — add, check off, clear, repeat (like groceries)."}
            {type === "dated" && "Has a deadline; shows up in that day's summary."}
            {type === "event" && "Rides along with a calendar event (like a packing list)."}
            {type === "meal" && "Plan meals & ingredients — items can hop onto the grocery list too."}
          </p>
        </div>
        {type === "dated" && (
          <input className={inputCls} type="date" value={needBy} required onChange={(e) => setNeedBy(e.target.value)} />
        )}
        {type === "event" && (
          <select className={inputCls} value={eventId} required onChange={(e) => setEventId(e.target.value)}>
            <option value="" disabled>Pick an upcoming event…</option>
            {upcoming.map((event) => (
              <option key={event.id} value={event.id}>{event.label}</option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!title.trim()}>{list ? "Save" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
