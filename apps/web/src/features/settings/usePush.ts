import { useEffect, useState } from "react";
import { api } from "../../api/client";

function base64ToUint8(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = "unsupported" | "needs-install" | "off" | "on" | "denied";

/** Web-push subscription for reminders. iOS requires the PWA to be installed first. */
export function usePush() {
  const [state, setState] = useState<PushState>("unsupported");

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // iOS Safari (not installed) lands here too — nudge to install.
        const isIos = /iPhone|iPad/.test(navigator.userAgent);
        setState(isIos && !matchMedia("(display-mode: standalone)").matches ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      setState(subscription ? "on" : "off");
    })();
  }, []);

  const enable = async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("denied");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const { publicKey } = await api<{ publicKey: string }>("/api/push/vapid-key");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8(publicKey) as BufferSource,
    });
    await api("/api/push/subscriptions", { method: "POST", body: subscription.toJSON() });
    setState("on");
  };

  const disable = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api("/api/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
    }
    setState("off");
  };

  return { state, enable, disable };
}
