import { useState } from "react";
import { Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAudit } from "../../api/queries";
import { inputCls } from "../../components/Modal";

const ACTION_EMOJI: Record<string, string> = {
  create: "✨", update: "✏️", delete: "🗑️", complete: "✅",
  uncomplete: "↩️", reassign: "🔄", check: "🛒",
};

/** "Remember and recall" — the family's activity feed, searchable. */
export function HistoryPage() {
  const [q, setQ] = useState("");
  const { data: entries } = useAudit(q);

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h2 className="text-xl font-extrabold">What's been happening</h2>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input className={`${inputCls} pl-9`} placeholder="Search — try “soccer” or “dishes”" value={q}
          onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        {(entries ?? []).map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 rounded-card bg-card px-4 py-2.5 shadow-card">
            <span className="text-lg">{ACTION_EMOJI[entry.action] ?? "📌"}</span>
            <p className="flex-1 text-sm font-semibold">{entry.summary}</p>
            <span className="shrink-0 text-xs font-bold text-ink-soft">
              {formatDistanceToNow(entry.createdAt, { addSuffix: true })}
            </span>
          </div>
        ))}
        {entries?.length === 0 && (
          <p className="rounded-card bg-card p-8 text-center font-semibold text-ink-soft shadow-card">
            Nothing here yet{q ? ` for “${q}”` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
