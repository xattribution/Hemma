import { useEffect, useState } from "react";

interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "reminder" | "error";
}

type Listener = (toast: ToastItem) => void;
let listener: Listener | null = null;
let nextId = 1;

export function showToast(text: string, kind: ToastItem["kind"] = "info") {
  listener?.({ id: nextId++, text, kind });
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((current) => [...current, toast]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), 6000);
    };
    return () => {
      listener = null;
    };
  }, []);

  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 sm:bottom-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-slide-up rounded-card px-4 py-3 text-sm font-semibold shadow-card ${
            toast.kind === "error"
              ? "bg-coral text-white"
              : toast.kind === "reminder"
                ? "bg-sun/95 text-ink"
                : "bg-ink text-cream"
          }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
