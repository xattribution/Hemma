import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "@coord/shared";
import { showToast } from "../components/Toast";

/**
 * Notify-only socket: the server broadcasts thin invalidation messages and we
 * refetch through TanStack Query. Reconnects with backoff; a full refetch on
 * reconnect and on tab wake covers anything missed while asleep.
 */
export function WsProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const qc = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/api/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (attempt > 0) void qc.invalidateQueries(); // catch up after an outage
        attempt = 0;
      };
      socket.onmessage = (raw) => {
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(raw.data as string);
        } catch {
          return;
        }
        if (msg.type === "invalidate") {
          for (const key of msg.keys) void qc.invalidateQueries({ queryKey: [key] });
        } else if (msg.type === "reminder") {
          showToast(`${msg.payload.title} — ${msg.payload.body}`, "reminder");
        }
      };
      socket.onclose = () => {
        if (closed) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
      };
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void qc.invalidateQueries();
      if (socketRef.current?.readyState === WebSocket.CLOSED) connect();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      socketRef.current?.close();
    };
  }, [enabled, qc]);

  return <>{children}</>;
}
