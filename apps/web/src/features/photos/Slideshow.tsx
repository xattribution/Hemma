import { useEffect, useRef, useState } from "react";
import { Images, Play } from "lucide-react";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

/**
 * The in-app slideshow / screensaver. Photos come from the household's
 * chosen source (Settings → Photos) via the unified /api/photos endpoints.
 * Three ways in: start now, start once after N minutes, or let it come on
 * by itself after N idle minutes on this device (screensaver).
 */

const IDLE_KEY = "coord.slideshow.idleMinutes";
export const readIdleMinutes = () => Number(localStorage.getItem(IDLE_KEY) ?? 0) || 0;

export function SlideshowOverlay({ onExit }: { onExit: () => void }) {
  const [batch, setBatch] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const batchRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/photos/random?count=30")
        .then(async (res) => {
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Photos unavailable");
          return res.json() as Promise<{ assets: { id: string }[] }>;
        })
        .then((data) => {
          if (cancelled) return;
          batchRef.current = data.assets.map((a) => a.id);
          setBatch(batchRef.current);
          setIndex(0);
          setError(null);
        })
        .catch((err) => !cancelled && setError((err as Error).message));
    void load();
    const rotate = setInterval(() => {
      const current = batchRef.current;
      if (!current.length) {
        void load();
        return;
      }
      setIndex((i) => {
        if (i + 1 >= current.length) void load();
        return current.length ? (i + 1) % current.length : 0;
      });
    }, 15_000);
    const onKey = () => onExit();
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; clearInterval(rotate); window.removeEventListener("keydown", onKey); };
  }, [onExit]);

  const current = batch[index];
  return (
    <div className="fixed inset-0 z-50 bg-black" onPointerDown={onExit} title="Tap to exit">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-white/80">
          <Images size={40} />
          <p className="max-w-md font-bold">{error}</p>
        </div>
      ) : (
        current && (
          <img key={current} src={`/api/photos/asset/${current}`} alt=""
            className="animate-pop h-full w-full object-contain" />
        )
      )}
    </div>
  );
}

export function SlideshowSetupModal({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const [delay, setDelay] = useState("10");
  const [idle, setIdle] = useState(() => (readIdleMinutes() ? String(readIdleMinutes()) : ""));

  return (
    <Modal title="Slideshow" onClose={onClose}>
      <div className="space-y-4">
        <button type="button" className={`${primaryBtn} flex w-full items-center justify-center gap-2`}
          onClick={() => { onClose(); onStart(); }}>
          <Play size={16} /> Start now
        </button>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={labelCls}>Start once, in</label>
            <div className="flex items-center gap-2">
              <input className={`${inputCls} w-20`} type="number" min={1} max={720}
                value={delay} onChange={(e) => setDelay(e.target.value)} />
              <span className="text-sm font-bold text-ink-soft">minutes</span>
            </div>
          </div>
          <button type="button" className={ghostBtn}
            onClick={() => {
              const min = Number(delay);
              if (!min) return;
              window.setTimeout(onStart, min * 60_000);
              showToast(`Slideshow starts in ${min} min`);
              onClose();
            }}>
            Schedule
          </button>
        </div>

        <div className="border-t border-line pt-3">
          <label className={labelCls}>Screensaver — start by itself after this device sits idle</label>
          <div className="flex items-center gap-2">
            <input className={`${inputCls} w-20`} type="number" min={0} max={720} placeholder="off"
              value={idle} onChange={(e) => setIdle(e.target.value)} />
            <span className="text-sm font-bold text-ink-soft">minutes (0 = off)</span>
            <button type="button" className={`${ghostBtn} ml-auto`}
              onClick={() => {
                const min = Math.max(0, Number(idle) || 0);
                if (min) localStorage.setItem(IDLE_KEY, String(min));
                else localStorage.removeItem(IDLE_KEY);
                showToast(min ? `Screensaver after ${min} min idle` : "Screensaver off");
                onClose();
              }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Watches for inactivity; fires onIdle after the saved threshold. */
export function useIdleSlideshow(onIdle: () => void, active: boolean) {
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const check = window.setInterval(() => {
      const minutes = readIdleMinutes();
      if (!minutes || active) return;
      if (Date.now() - last >= minutes * 60_000) {
        last = Date.now(); // don't refire immediately after exit
        onIdle();
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(check);
    };
  }, [onIdle, active]);
}
