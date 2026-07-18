/**
 * Coord MCP server — gives AI assistants structured tools over a Coord
 * family-calendar instance (events, chores, lists, search, history).
 *
 * Env:
 *   COORD_URL   e.g. https://coord.example.com or http://localhost:49733
 *   COORD_TOKEN a bearer token from Settings → AI & API access
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TZDate } from "@date-fns/tz";
import { z } from "zod";

const BASE = (process.env.COORD_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.COORD_TOKEN ?? "";
if (!BASE || !TOKEN) {
  console.error("Set COORD_URL and COORD_TOKEN environment variables.");
  process.exit(1);
}

async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ---------- household context ----------

let tzCache: string | null = null;
async function householdTz(): Promise<string> {
  if (!tzCache) {
    const me = await api<{ household: { timezone: string } }>("/api/auth/me");
    tzCache = me.household.timezone;
  }
  return tzCache;
}

/** "2026-07-14" + "17:30" in the household timezone → UTC ms. */
async function toMs(date: string, time = "00:00"): Promise<number> {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new TZDate(y!, mo! - 1, d!, h ?? 0, mi ?? 0, 0, await householdTz()).getTime();
}

interface Member { id: string; name: string; role: string }
async function resolveMember(name: string): Promise<Member> {
  const { members } = await api<{ members: Member[] }>("/api/members");
  const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!member) {
    throw new Error(`No family member named "${name}". Members: ${members.map((m) => m.name).join(", ")}`);
  }
  return member;
}

interface Checklist { id: string; title: string; items: { id: string; text: string; checked: boolean; store: string | null }[] }
async function resolveList(ref: string): Promise<Checklist> {
  const { checklists } = await api<{ checklists: Checklist[] }>("/api/checklists");
  const list =
    checklists.find((c) => c.id === ref) ??
    checklists.find((c) => c.title.toLowerCase() === ref.toLowerCase());
  if (!list) {
    throw new Error(`No list "${ref}". Lists: ${checklists.map((c) => c.title).join(", ")}`);
  }
  return list;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });

const server = new McpServer({ name: "hemma", version: "0.1.0" });

// ---------- discovery ----------

server.tool(
  "get_overview",
  "Household name/timezone, family members (with ids and roles), and today's dashboard: events today & tomorrow, each member's chores, pinned lists.",
  {},
  async () => {
    const [me, members, today] = await Promise.all([
      api("/api/auth/me"),
      api("/api/members"),
      api("/api/dashboard/today"),
    ]);
    return ok({ me, ...(members as object), today });
  },
);

server.tool(
  "search",
  "Search everything at once — events, tasks, list items (by text or store tag), and family history.",
  { query: z.string() },
  async ({ query }) => ok(await api(`/api/search?q=${encodeURIComponent(query)}`)),
);

server.tool(
  "get_history",
  "The family activity feed: who added/completed/swapped/changed what, newest first.",
  { query: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) },
  async ({ query, limit }) =>
    ok(await api(`/api/audit?limit=${limit}${query ? `&q=${encodeURIComponent(query)}` : ""}`)),
);

// ---------- calendar ----------

server.tool(
  "list_events",
  "Calendar occurrences between two dates (inclusive start, exclusive end). Recurring events appear once per occurrence with occurrenceStart (needed to edit/delete a single occurrence).",
  { start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string().describe("YYYY-MM-DD") },
  async ({ start_date, end_date }) =>
    ok(await api(`/api/events?start=${await toMs(start_date)}&end=${await toMs(end_date)}`)),
);

server.tool(
  "create_event",
  "Add a calendar event. For recurring events pass an RFC-5545 rrule like FREQ=WEEKLY or FREQ=WEEKLY;BYDAY=MO,WE.",
  {
    title: z.string(),
    date: z.string().describe("YYYY-MM-DD"),
    start_time: z.string().default("09:00").describe("HH:MM 24h, household timezone"),
    end_time: z.string().optional().describe("defaults to one hour after start"),
    all_day: z.boolean().default(false),
    category: z.enum(["family", "school", "sports", "work", "appointment", "birthday", "holiday", "other"]).default("family"),
    rrule: z.string().nullable().default(null),
    assignee_names: z.array(z.string()).default([]).describe("family member names this event is for"),
    reminder_minutes: z.number().int().nullable().default(null),
    location: z.string().default(""),
    description: z.string().default(""),
  },
  async (args) => {
    const startAt = await toMs(args.date, args.all_day ? "00:00" : args.start_time);
    const endAt = args.all_day
      ? startAt + 24 * 3600_000
      : args.end_time
        ? await toMs(args.date, args.end_time)
        : startAt + 3600_000;
    const assigneeIds = await Promise.all(args.assignee_names.map(async (n) => (await resolveMember(n)).id));
    const result = await api("/api/events", {
      method: "POST",
      body: {
        title: args.title, startAt, endAt, allDay: args.all_day, timezone: await householdTz(),
        category: args.category, rrule: args.rrule, assigneeIds,
        reminderMinutes: args.reminder_minutes, location: args.location, description: args.description,
      },
    });
    return ok(result);
  },
);

server.tool(
  "update_event",
  "Edit an event. scope: 'single' (just one occurrence — occurrence_start required), 'future' (this and following), or 'all'. Only pass fields you're changing.",
  {
    event_id: z.string(),
    scope: z.enum(["single", "future", "all"]).default("all"),
    occurrence_start: z.number().optional().describe("occurrenceStart ms from list_events, required for single/future"),
    title: z.string().optional(),
    date: z.string().optional().describe("YYYY-MM-DD — with start_time moves the event"),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    category: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    rrule: z.string().nullable().optional(),
    reminder_minutes: z.number().int().nullable().optional(),
  },
  async (args) => {
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "category", "location", "description", "rrule"] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    if (args.reminder_minutes !== undefined) patch.reminderMinutes = args.reminder_minutes;
    if (args.date && args.start_time) {
      patch.startAt = await toMs(args.date, args.start_time);
      patch.endAt = args.end_time ? await toMs(args.date, args.end_time) : (patch.startAt as number) + 3600_000;
    }
    return ok(await api(`/api/events/${args.event_id}`, {
      method: "PATCH",
      body: { scope: args.scope, occurrenceStart: args.occurrence_start, patch },
    }));
  },
);

server.tool(
  "delete_event",
  "Delete an event (scope as in update_event). Destructive — only when clearly asked.",
  {
    event_id: z.string(),
    scope: z.enum(["single", "future", "all"]).default("all"),
    occurrence_start: z.number().optional(),
  },
  async ({ event_id, scope, occurrence_start }) =>
    ok(await api(
      `/api/events/${event_id}?scope=${scope}${occurrence_start !== undefined ? `&occurrenceStart=${occurrence_start}` : ""}`,
      { method: "DELETE" },
    )),
);

// ---------- chores & to-dos ----------

server.tool(
  "list_tasks",
  "Chores and to-dos as they stand on a date (default today). Recurring chores appear only on days they repeat, with per-day completion.",
  { date: z.string().optional().describe("YYYY-MM-DD") },
  async ({ date }) => ok(await api(`/api/tasks${date ? `?date=${date}` : ""}`)),
);

server.tool(
  "create_task",
  "Add a chore or to-do. repeat: 'daily', 'weekdays', comma-separated weekday numbers (0=Sun…6=Sat), or omit for one-time. Steps with their own assignee make it a FAMILY chore ('Mia: floor, Leo: dishes') — it completes only when every step is checked, and step points go to whoever does each step (awarded when the whole chore finishes).",
  {
    title: z.string(),
    icon: z.string().default("⭐").describe("a single emoji"),
    kind: z.enum(["chore", "todo"]).default("chore"),
    assignee_name: z.string().nullable().default(null).describe("family member name, or null for up-for-grabs"),
    repeat: z.string().nullable().default(null),
    due_date: z.string().nullable().default(null).describe("YYYY-MM-DD for one-time tasks"),
    due_time: z.string().default("18:00"),
    points: z.number().int().nullable().default(null),
    steps: z.array(z.object({
      text: z.string(),
      assignee_name: z.string().nullable().default(null),
      points: z.number().int().nullable().default(null),
    })).default([]),
  },
  async (args) => {
    const assigneeId = args.assignee_name ? (await resolveMember(args.assignee_name)).id : null;
    const steps = await Promise.all(args.steps.map(async (s) => ({
      text: s.text,
      assigneeId: s.assignee_name ? (await resolveMember(s.assignee_name)).id : null,
      points: s.points,
    })));
    return ok(await api("/api/tasks", {
      method: "POST",
      body: {
        title: args.title, icon: args.icon, kind: args.kind, assigneeId,
        repeat: args.repeat, points: args.points, steps,
        dueAt: args.due_date ? await toMs(args.due_date, args.due_time) : null,
      },
    }));
  },
);

server.tool(
  "complete_task",
  "Toggle a task's completion. Recurring chores need occurrence_date (the day being completed).",
  { task_id: z.string(), occurrence_date: z.string().nullable().default(null).describe("YYYY-MM-DD") },
  async ({ task_id, occurrence_date }) =>
    ok(await api(`/api/tasks/${task_id}/complete`, { method: "POST", body: { occurrenceDate: occurrence_date } })),
);

server.tool(
  "reassign_task",
  "Hand a chore to someone else (or null → up for grabs). This is how chores get swapped.",
  { task_id: z.string(), to_member_name: z.string().nullable() },
  async ({ task_id, to_member_name }) => {
    const toMemberId = to_member_name ? (await resolveMember(to_member_name)).id : null;
    return ok(await api(`/api/tasks/${task_id}/reassign`, { method: "POST", body: { toMemberId } }));
  },
);

// ---------- points ----------

server.tool(
  "get_points",
  "The family points picture: all-time totals per member, every goal with per-member standings, and the recent ledger (every entry has a reason).",
  {},
  async () => ok(await api("/api/points/summary")),
);

server.tool(
  "adjust_points",
  "Give or take points with a reason (negative delta = deduction). The reason shows on the family's Points page — be honest and specific. Deduct only when a parent asks.",
  { member_name: z.string(), delta: z.number().int(), reason: z.string() },
  async ({ member_name, delta, reason }) => {
    const memberId = (await resolveMember(member_name)).id;
    return ok(await api("/api/points/adjust", { method: "POST", body: { memberId, delta, reason } }));
  },
);

server.tool(
  "create_point_goal",
  "Set up a reward goal: mode 'target' (everyone fills their own bar) or 'race' (first past the post). repeat 'monthly' resets each month; ends_at (ms) sets a deadline; member_names null = all kids.",
  {
    title: z.string(),
    mode: z.enum(["target", "race"]).default("target"),
    target: z.number().int().min(1),
    member_names: z.array(z.string()).nullable().default(null),
    ends_at: z.number().int().nullable().default(null),
    repeat: z.enum(["none", "monthly"]).default("none"),
    reward: z.string().default(""),
  },
  async ({ title, mode, target, member_names, ends_at, repeat, reward }) => {
    const memberIds = member_names ? await Promise.all(member_names.map(async (n) => (await resolveMember(n)).id)) : null;
    return ok(await api("/api/points/goals", {
      method: "POST",
      body: { title, mode, target, memberIds, startsAt: Date.now(), endsAt: ends_at, repeat, reward },
    }));
  },
);

// ---------- photos & screens ----------

server.tool(
  "get_screen_photos",
  "What every screen is showing right now: [{screen: 'Kitchen', kind: 'device'|'member', assetId, assetUrl, secondsAgo}]. Use to answer 'what's the picture on the kitchen display?' or to grab the assetId for sharing.",
  {},
  async () => ok(await api("/api/photos/current")),
);

server.tool(
  "share_photo",
  "Mint a PUBLIC 7-day link for a photo (asset_id from get_screen_photos), and optionally send it to a connected family (they get a toast + History entry). For people outside Hemma (e.g. 'send it to my mom'), mint the link and deliver it through whatever channel you have.",
  { asset_id: z.string(), family_name: z.string().nullable().default(null) },
  async ({ asset_id, family_name }) => {
    const share = (await api("/api/photos/share", { method: "POST", body: { assetId: asset_id } })) as { url: string };
    if (family_name) {
      const fed = (await api("/api/federation")) as { peers: { id: string; name: string; status: string }[] };
      const peer = fed.peers.find((p) => p.status === "active" && p.name.toLowerCase().includes(family_name.toLowerCase()));
      if (!peer) throw new Error(`No connected family matching "${family_name}"`);
      await api(`/api/federation/peers/${peer.id}/share-photo`, { method: "POST", body: { url: share.url } });
    }
    return ok(share);
  },
);

// ---------- lists ----------

server.tool(
  "list_checklists",
  "All lists with their items (text, quantity, store tag, checked) and optional needBy deadline.",
  {},
  async () => ok(await api("/api/checklists")),
);

server.tool(
  "create_checklist",
  "Create a list (shopping/packing/checklist), optionally pinned to displays and with a need-by date.",
  {
    title: z.string(),
    icon: z.string().default("🛒"),
    kind: z.enum(["shopping", "packing", "checklist"]).default("shopping"),
    pinned_to_displays: z.boolean().default(true),
    need_by_date: z.string().nullable().default(null).describe("YYYY-MM-DD"),
  },
  async (args) =>
    ok(await api("/api/checklists", {
      method: "POST",
      body: {
        title: args.title, icon: args.icon, kind: args.kind,
        pinnedToDashboard: args.pinned_to_displays,
        needBy: args.need_by_date ? await toMs(args.need_by_date, "12:00") : null,
      },
    })),
);

server.tool(
  "add_list_item",
  "Add an item to a list (by title or id). 'I need eggs from Costco tomorrow' → text 'Eggs', store 'Costco', and set the list's need-by via update_checklist if asked. Check the list first to avoid duplicates.",
  {
    list: z.string().describe("list title or id"),
    text: z.string(),
    quantity: z.string().nullable().default(null),
    store: z.string().nullable().default(null),
  },
  async ({ list, text, quantity, store }) => {
    const target = await resolveList(list);
    return ok(await api(`/api/checklists/${target.id}/items`, { method: "POST", body: { text, quantity, store } }));
  },
);

server.tool(
  "update_list_item",
  "Edit an item — change its text, quantity, or store tag (e.g. move eggs from Costco to Walmart).",
  {
    list: z.string(),
    item_text_or_id: z.string(),
    text: z.string().optional(),
    quantity: z.string().nullable().optional(),
    store: z.string().nullable().optional(),
  },
  async ({ list, item_text_or_id, ...patch }) => {
    const target = await resolveList(list);
    const item =
      target.items.find((i) => i.id === item_text_or_id) ??
      target.items.find((i) => i.text.toLowerCase() === item_text_or_id.toLowerCase());
    if (!item) throw new Error(`No item "${item_text_or_id}" in ${target.title}`);
    return ok(await api(`/api/checklists/${target.id}/items/${item.id}`, { method: "PATCH", body: patch }));
  },
);

server.tool(
  "toggle_list_item",
  "Check or uncheck an item (marking it bought/done).",
  { list: z.string(), item_text_or_id: z.string() },
  async ({ list, item_text_or_id }) => {
    const target = await resolveList(list);
    const item =
      target.items.find((i) => i.id === item_text_or_id) ??
      target.items.find((i) => i.text.toLowerCase() === item_text_or_id.toLowerCase());
    if (!item) throw new Error(`No item "${item_text_or_id}" in ${target.title}`);
    return ok(await api(`/api/checklists/${target.id}/items/${item.id}/toggle`, { method: "POST" }));
  },
);

server.tool(
  "update_checklist",
  "Update a list: rename, pin/unpin from displays, set/clear its need-by date, or link it to a calendar event (it then shows on that event's days).",
  {
    list: z.string(),
    title: z.string().optional(),
    pinned_to_displays: z.boolean().optional(),
    need_by_date: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear"),
    linked_event_id: z.string().nullable().optional().describe("event id from list_events, or null to unlink"),
  },
  async ({ list, title, pinned_to_displays, need_by_date, linked_event_id }) => {
    const target = await resolveList(list);
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.title = title;
    if (pinned_to_displays !== undefined) body.pinnedToDashboard = pinned_to_displays;
    if (need_by_date !== undefined) body.needBy = need_by_date ? await toMs(need_by_date, "12:00") : null;
    if (linked_event_id !== undefined) body.linkedEventId = linked_event_id;
    return ok(await api(`/api/checklists/${target.id}`, { method: "PATCH", body }));
  },
);

server.tool(
  "clear_checked_items",
  "Remove all checked-off items from a list — the after-shopping sweep on a running list like Groceries.",
  { list: z.string() },
  async ({ list }) => {
    const target = await resolveList(list);
    return ok(await api(`/api/checklists/${target.id}/clear-checked`, { method: "POST" }));
  },
);

// ---------- family federation ----------

server.tool(
  "list_families",
  "Connected extended families (peers) and which of our lists are shared with each.",
  {},
  async () => ok(await api("/api/federation")),
);

server.tool(
  "share_list_with_family",
  "Share one of our lists with a connected family — e.g. 'send Jonathan's family the Costco list'. Only that list is shared; changes sync both ways.",
  { family_name: z.string(), list: z.string().describe("list title or id") },
  async ({ family_name, list }) => {
    const fed = (await api("/api/federation")) as { peers: { id: string; name: string }[] };
    const peer = fed.peers.find((p) => p.name.toLowerCase().includes(family_name.toLowerCase()));
    if (!peer) throw new Error(`No connected family matching "${family_name}". Families: ${fed.peers.map((p) => p.name).join(", ") || "none"}`);
    const target = await resolveList(list);
    return ok(await api(`/api/federation/peers/${peer.id}/share`, { method: "POST", body: { checklistId: target.id } }));
  },
);

server.tool(
  "unshare_list_with_family",
  "Stop sharing a list with a family — it silently disappears from their devices.",
  { family_name: z.string(), list: z.string() },
  async ({ family_name, list }) => {
    const fed = (await api("/api/federation")) as { peers: { id: string; name: string }[] };
    const peer = fed.peers.find((p) => p.name.toLowerCase().includes(family_name.toLowerCase()));
    if (!peer) throw new Error(`No connected family matching "${family_name}"`);
    const target = await resolveList(list);
    return ok(await api(`/api/federation/peers/${peer.id}/share/${target.id}`, { method: "DELETE" }));
  },
);

server.tool(
  "send_event_to_family",
  "Copy one of our calendar events onto a connected family's calendar (e.g. the wedding).",
  { family_name: z.string(), event_id: z.string().describe("event id from list_events or search") },
  async ({ family_name, event_id }) => {
    const fed = (await api("/api/federation")) as { peers: { id: string; name: string }[] };
    const peer = fed.peers.find((p) => p.name.toLowerCase().includes(family_name.toLowerCase()));
    if (!peer) throw new Error(`No connected family matching "${family_name}"`);
    return ok(await api(`/api/federation/peers/${peer.id}/send-event`, { method: "POST", body: { eventId: event_id } }));
  },
);

await server.connect(new StdioServerTransport());
console.error(`coord-mcp connected to ${BASE}`);
