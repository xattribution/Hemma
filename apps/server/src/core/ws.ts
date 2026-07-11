import type { WsServerMessage } from "@coord/shared";
import type { WebSocket } from "ws";

/** Registry of live client sockets; broadcast() fans a message out to all. */
export function createWsHub() {
  const sockets = new Set<WebSocket>();

  return {
    add(socket: WebSocket) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => sockets.delete(socket));
      send(socket, { type: "hello", onlineCount: sockets.size });
    },
    broadcast(msg: WsServerMessage) {
      const data = JSON.stringify(msg);
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.send(data);
      }
    },
    get size() {
      return sockets.size;
    },
  };
}

function send(socket: WebSocket, msg: WsServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}
