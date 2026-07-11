/**
 * Coord plugin SDK — the stable surface plugins build against.
 *
 * Core features (calendar, tasks, checklists, reminders, dashboard) are
 * themselves registered through this interface, so the seams future plugins
 * need (AI assistant, voice, email ingest, federation, external calendar
 * sync, drawing) are exercised from day one rather than speculative.
 */
import type { WsServerMessage } from "@coord/shared";

// ---------- Event bus ----------

export interface ActorRef {
  memberId: string | null;
  name: string;
}

/** Every core mutation emits one of these. Plugins subscribe to react. */
export interface CoordEvents {
  "event.created": { eventId: string; title: string; actor: ActorRef };
  "event.updated": { eventId: string; title: string; actor: ActorRef };
  "event.deleted": { eventId: string; title: string; actor: ActorRef };
  "task.created": { taskId: string; title: string; actor: ActorRef };
  "task.completed": { taskId: string; title: string; occurrenceDate: string | null; actor: ActorRef };
  "task.reassigned": { taskId: string; title: string; toMemberId: string; actor: ActorRef };
  "checklist.item.checked": { checklistId: string; itemId: string; text: string; checked: boolean; actor: ActorRef };
  "reminder.fired": { entityType: "event" | "task"; entityId: string; title: string; body: string; targetMemberIds: string[] | null };
  "member.updated": { memberId: string; actor: ActorRef };
}

export type CoordEventName = keyof CoordEvents;

export interface EventBus {
  emit<E extends CoordEventName>(event: E, payload: CoordEvents[E]): void;
  on<E extends CoordEventName>(event: E, handler: (payload: CoordEvents[E]) => void): () => void;
}

// ---------- Scheduler ----------

export interface Scheduler {
  /** Run `fn` roughly every `seconds`; returns a cancel function. */
  every(name: string, seconds: number, fn: () => void | Promise<void>): () => void;
}

// ---------- Settings ----------

export interface SettingsStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

// ---------- Plugin context ----------

export interface PluginContext {
  /**
   * The Fastify instance. Typed loosely here so the SDK doesn't drag server
   * dependencies into the frontend bundle; the server passes the real thing.
   * Plugins register routes under `/api/p/<pluginId>/...`.
   */
  app: {
    get: (path: string, handler: (req: any, reply: any) => unknown) => unknown;
    post: (path: string, handler: (req: any, reply: any) => unknown) => unknown;
  };
  db: unknown; // better-sqlite3 Database; server-side plugins cast via their own dep
  bus: EventBus;
  scheduler: Scheduler;
  settings: SettingsStore;
  broadcast: (msg: WsServerMessage) => void;
  log: (msg: string) => void;
}

export interface CoordPlugin {
  id: string;
  name: string;
  description?: string;
  register(ctx: PluginContext): void | Promise<void>;
}

// ---------- Frontend slots ----------

/** Extension points core UI renders through. */
export type SlotId =
  | "dashboard.card"
  | "settings.section"
  | "calendar.toolbar"
  | "calendar.day-cell.overlay" // pre-cut seam for the future drawable layer
  | "event.detail.section";
