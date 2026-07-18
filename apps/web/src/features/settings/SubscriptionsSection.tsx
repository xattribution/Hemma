import { useState } from "react";
import { CalendarPlus, ChevronDown, ChevronRight, RefreshCw, Settings2, Trash2 } from "lucide-react";
import type { CalSubscription } from "@coord/shared";
import { EVENT_CATEGORIES } from "@coord/shared";
import { useMembers, useSubscriptionMutations, useSubscriptions } from "../../api/queries";
import { ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

/**
 * "Other calendars" — follow ICS feeds (Google/iCloud/Outlook/team apps).
 * The copy here is written for a non-technical parent: no protocol names,
 * no jargon, a walkthrough for finding the link in each app they may use.
 */
export function SubscriptionsSection() {
  const { data: subs } = useSubscriptions();
  const { create } = useSubscriptionMutations();
  const [url, setUrl] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const add = async () => {
    if (!url.trim()) return;
    try {
      const sub = await create.mutateAsync({ url: url.trim() });
      setUrl("");
      if (sub.lastStatus?.startsWith("ok")) {
        showToast(`Added "${sub.label || "calendar"}" — ${sub.eventCount} events are on your calendar now`, "info");
      } else {
        showToast(sub.lastStatus ?? "That didn't work — check the link", "error");
      }
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><CalendarPlus size={18} /> Other calendars</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Already keep a calendar somewhere else — the soccer team's schedule, the
        school calendar, your work calendar? Paste its link here and it shows up
        in Hemma, and stays up to date by itself. Hemma only reads it: nothing
        is ever changed or sent back.
      </p>

      <div className="mb-2 flex gap-2">
        <input
          className={`${inputCls} flex-1`}
          placeholder="Paste the calendar link here"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <button type="button" className={primaryBtn} disabled={create.isPending || !url.trim()} onClick={() => void add()}>
          {create.isPending ? "Checking…" : "Add"}
        </button>
      </div>

      <button type="button" onClick={() => setHelpOpen((v) => !v)}
        className="mb-3 flex items-center gap-1 text-sm font-bold text-sky">
        {helpOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Where do I find the link?
      </button>
      {helpOpen && <LinkHelp />}

      <div className="divide-y divide-line">
        {(subs ?? []).map((sub) => <SubscriptionRow key={sub.id} sub={sub} />)}
      </div>
    </section>
  );
}

/** Step-by-step link hunting, one recipe per place people keep calendars. */
function LinkHelp() {
  const recipes: { app: string; steps: string[] }[] = [
    {
      app: "Google Calendar",
      steps: [
        "On a computer, open calendar.google.com and sign in.",
        "On the left, under \"My calendars\", hover the calendar you want and click the three dots → Settings and sharing.",
        "Scroll down to \"Integrate calendar\".",
        "Copy the long link under Secret address in iCal format (it ends in .ics).",
        "Paste it above. Keep it to yourself — anyone with that link can see this calendar.",
      ],
    },
    {
      app: "iPhone / iCloud calendar",
      steps: [
        "Open the Calendar app on your iPhone and tap Calendars at the bottom.",
        "Tap the ⓘ next to the calendar you want to share.",
        "Turn on Public Calendar, then tap Share Link → Copy.",
        "Paste it above (links that start with \"webcal://\" work fine).",
      ],
    },
    {
      app: "Outlook / work calendar",
      steps: [
        "In Outlook on the web, click the gear icon → Calendar → Shared calendars.",
        "Under \"Publish a calendar\", pick your calendar, choose \"Can view all details\", and click Publish.",
        "Copy the ICS link (not the HTML one) and paste it above.",
      ],
    },
    {
      app: "Team & school apps (TeamSnap, SportsEngine, school portals…)",
      steps: [
        "Look for a button or menu item called \"Subscribe\", \"Sync to my calendar\", \"iCal\", or \"Export\" — most team and school sites have one, often near the schedule.",
        "If it offers a link (or a \"copy address\" option), copy it and paste it above.",
        "If tapping it opens your phone's calendar instead, press and hold (or right-click) the button and choose \"Copy link\".",
      ],
    },
  ];
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-line bg-cream p-3">
      {recipes.map((r) => (
        <details key={r.app}>
          <summary className="cursor-pointer text-sm font-bold">{r.app}</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-6 text-sm font-semibold text-ink-soft">
            {r.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </details>
      ))}
      <p className="text-sm font-semibold text-ink-soft">
        Stuck? As long as you can find a link that mentions "iCal", "ICS", or
        "Subscribe", it will work here.
      </p>
    </div>
  );
}

function statusLine(sub: CalSubscription): { text: string; ok: boolean } {
  if (!sub.lastStatus) return { text: "Not checked yet", ok: true };
  if (!sub.lastStatus.startsWith("ok")) return { text: sub.lastStatus, ok: false };
  const mins = sub.lastSyncAt ? Math.round((Date.now() - sub.lastSyncAt) / 60000) : null;
  const when = mins === null ? "" : mins < 1 ? " · updated just now" : mins < 90 ? ` · updated ${mins} min ago` : ` · updated ${Math.round(mins / 60)} h ago`;
  return { text: `${sub.eventCount} events on your calendar${when}`, ok: true };
}

function SubscriptionRow({ sub }: { sub: CalSubscription }) {
  const { update, sync, remove } = useSubscriptionMutations();
  const { data: members } = useMembers();
  const [open, setOpen] = useState(false);
  const status = statusLine(sub);

  const patch = async (fields: Record<string, unknown>) => {
    try {
      await update.mutateAsync({ id: sub.id, ...fields });
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{sub.label || sub.url}</div>
          <div className={`truncate text-sm font-semibold ${status.ok ? "text-ink-soft" : "text-coral"}`}>{status.text}</div>
        </div>
        <button type="button" title="Update now" aria-label="Update now"
          className={ghostBtn} disabled={sync.isPending}
          onClick={() => void sync.mutateAsync(sub.id).then(
            (s) => showToast(s.lastStatus?.startsWith("ok") ? "Up to date" : (s.lastStatus ?? "Couldn't update"), s.lastStatus?.startsWith("ok") ? "info" : "error"),
            (err: Error) => showToast(err.message, "error"),
          )}>
          <RefreshCw size={16} className={sync.isPending ? "animate-spin" : undefined} />
        </button>
        <button type="button" title="Options" aria-label="Options" className={ghostBtn} onClick={() => setOpen((v) => !v)}>
          <Settings2 size={16} />
        </button>
        <button type="button" title="Remove" aria-label="Remove" className={ghostBtn}
          onClick={() => {
            if (confirm(`Remove "${sub.label || sub.url}" and take its events off your calendar?`)) {
              void remove.mutateAsync(sub.id).catch((err: Error) => showToast(err.message, "error"));
            }
          }}>
          <Trash2 size={16} />
        </button>
      </div>

      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Name</span>
            <input className={inputCls} defaultValue={sub.label}
              onBlur={(e) => e.target.value !== sub.label && void patch({ label: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Show events as</span>
            <select className={inputCls} value={sub.category}
              onChange={(e) => void patch({ category: e.target.value })}>
              {Object.entries(EVENT_CATEGORIES).map(([key, c]) => (
                <option key={key} value={key}>{c.icon} {c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Whose calendar is it?</span>
            <select className={inputCls} value={sub.assigneeId ?? ""}
              onChange={(e) => void patch({ assigneeId: e.target.value || null })}>
              <option value="">The whole family's</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Who sees it?</span>
            <select className={inputCls} value={sub.visibility}
              onChange={(e) => void patch({ visibility: e.target.value })}>
              <option value="family">Everyone in the family</option>
              <option value="private">Just me (and other parents)</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Only bring in titles containing… <span className="font-normal">(optional, comma-separated)</span></span>
            <input className={inputCls} defaultValue={sub.includeKeywords} placeholder="practice, game"
              onBlur={(e) => e.target.value !== sub.includeKeywords && void patch({ includeKeywords: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Skip titles containing… <span className="font-normal">(optional)</span></span>
            <input className={inputCls} defaultValue={sub.excludeKeywords} placeholder="board meeting"
              onBlur={(e) => e.target.value !== sub.excludeKeywords && void patch({ excludeKeywords: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={sub.skipAllDay}
              onChange={(e) => void patch({ skipAllDay: e.target.checked })} />
            <span className="text-sm font-bold">Skip all-day entries (holidays, spirit days…)</span>
          </label>
        </div>
      )}
    </div>
  );
}
