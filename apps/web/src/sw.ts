/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// A briefly-offline kitchen tablet still renders the last-known day.
registerRoute(
  ({ url, request }) => url.pathname.startsWith("/api/") && request.method === "GET",
  new NetworkFirst({ cacheName: "api", networkTimeoutSeconds: 5 }),
);

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title?: string; body?: string };
    } catch {
      return null;
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data?.title ?? "Coord", {
      body: data?.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (client) return client.focus();
      return self.clients.openWindow("/");
    }),
  );
});
