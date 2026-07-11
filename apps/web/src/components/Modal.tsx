import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className={`animate-slide-up max-h-[92dvh] w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} overflow-y-auto rounded-t-card bg-cream p-5 shadow-card sm:rounded-card`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-soft hover:bg-line" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border-2 border-line bg-card px-3 py-2.5 font-semibold text-ink outline-none focus:border-coral";
export const labelCls = "mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink-soft";
export const primaryBtn =
  "rounded-xl bg-coral px-5 py-2.5 font-extrabold text-white shadow-card transition hover:brightness-105 active:scale-95 disabled:opacity-50";
export const ghostBtn =
  "rounded-xl border-2 border-line bg-card px-4 py-2 font-bold text-ink-soft transition hover:border-coral hover:text-coral";
