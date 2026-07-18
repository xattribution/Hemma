/**
 * WebSocket protocol: the socket is notify-only. Mutations happen over REST;
 * the server broadcasts thin "invalidate" messages and clients refetch.
 */

export type QueryKeyPattern =
  | "events"
  | "tasks"
  | "checklists"
  | "members"
  | "federation"
  | "dashboard"
  | "audit"
  | "me"; // display config changes propagate to signed-in kiosks

export type WsServerMessage =
  | { type: "hello"; onlineCount: number }
  | { type: "invalidate"; keys: QueryKeyPattern[] }
  | {
      type: "reminder";
      payload: { title: string; body: string; entityType: "event" | "task"; entityId: string };
    };

export type WsClientMessage = { type: "ping" };
