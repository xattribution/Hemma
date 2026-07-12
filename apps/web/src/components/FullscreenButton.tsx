import { useState } from "react";
import { Maximize, Minimize } from "lucide-react";

/** Wall-calendar mode: fill the whole screen (great for mounted displays). */
export function FullscreenButton() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const toggle = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => undefined);
    setFull(!!document.fullscreenElement);
  };
  return (
    <button type="button" onClick={() => void toggle()} title={full ? "Exit fullscreen" : "Fullscreen"}
      className="rounded-xl bg-card p-2 text-ink-soft shadow-card transition hover:text-ink active:scale-95">
      {full ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
