import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, Copy, Images, Play, Share2 } from "lucide-react";
import { api } from "../../api/client";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

/**
 * The photo rotation engine + slideshow overlay + share panel.
 * Photos come from the household's chosen source (Settings → Photos) via
 * the unified /api/photos endpoints. Every rotation reports what's on
 * screen so a connected AI can answer "what's on the kitchen display?".
 */

const IDLE_KEY = "coord.slideshow.idleMinutes";
const SPEED_KEY = "coord.slideshow.speedSec";
const ORDER_KEY = "coord.slideshow.order";
export const readIdleMinutes = () => Number(localStorage.getItem(IDLE_KEY) ?? 0) || 0;
export const readSpeedSec = () => Math.min(600, Math.max(3, Number(localStorage.getItem(SPEED_KEY) ?? 15) || 15));
export const readOrder = (): "shuffle" | "seq" => (localStorage.getItem(ORDER_KEY) === "seq" ? "seq" : "shuffle");

// ---------- rotation engine (shared by the overlay and display layout) ----------

export function usePhotoRotation(options: { speedSec: number; order: "shuffle" | "seq" }) {
  const [shown, setShown] = useState<string[]>([]); // everything shown so far, in order
  const [index, setIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const state = useRef({ shown: [] as string[], index: -1, offset: 0, loading: false });

  const report = (assetId: string) => {
    void fetch("/api/photos/current", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    }).catch(() => undefined);
  };

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (state.current.loading) return false;
    state.current.loading = true;
    try {
      const res = await fetch(`/api/photos/random?count=20&order=${options.order}&offset=${state.current.offset}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Photos unavailable");
      const data = (await res.json()) as { assets: { id: string }[] };
      const fresh = data.assets.map((a) => a.id);
      state.current.offset += fresh.length;
      state.current.shown = [...state.current.shown, ...fresh].slice(-200);
      setShown(state.current.shown);
      setError(null);
      return fresh.length > 0;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      state.current.loading = false;
    }
  }, [options.order]);

  const step = useCallback(async (direction: 1 | -1) => {
    if (direction === -1) {
      if (state.current.index > 0) {
        state.current.index -= 1;
        setIndex(state.current.index);
        const id = state.current.shown[state.current.index];
        if (id) report(id);
      }
      return;
    }
    if (state.current.index + 1 >= state.current.shown.length) {
      const got = await loadMore();
      if (!got && !state.current.shown.length) return;
    }
    if (state.current.index + 1 < state.current.shown.length) {
      state.current.index += 1;
    } else if (state.current.shown.length) {
      state.current.index = 0; // wrap (small libraries loop)
    }
    setIndex(state.current.index);
    const id = state.current.shown[state.current.index];
    if (id) report(id);
  }, [loadMore]);

  useEffect(() => {
    void step(1); // first photo
    const timer = setInterval(() => void step(1), options.speedSec * 1000);
    return () => clearInterval(timer);
  }, [step, options.speedSec]);

  return { current: index >= 0 ? shown[index] : undefined, error, next: () => void step(1), prev: () => void step(-1) };
}

// ---------- the viewer: photo + edge arrows + share ----------

export function PhotoStage({ current, error, next, prev, onCenterTap, showShare }: {
  current: string | undefined;
  error: string | null;
  next: () => void;
  prev: () => void;
  /** Tap on the photo itself: exit for the overlay; omit to open share (wall displays). */
  onCenterTap?: () => void;
  showShare?: boolean;
}) {
  const [sharing, setSharing] = useState(false);
  const edge = "absolute top-0 z-10 flex h-full w-16 items-center justify-center text-white/20 transition hover:text-white/70";

  return (
    <div className="relative h-full w-full bg-black">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-white/80">
          <Images size={40} />
          <p className="max-w-md font-bold">{error}</p>
        </div>
      ) : (
        <>
          {current && (
            <img key={current} src={`/api/photos/asset/${encodeURIComponent(current)}`} alt=""
              onPointerDown={(e) => { e.stopPropagation(); onCenterTap ? onCenterTap() : setSharing(true); }}
              className="animate-pop h-full w-full object-contain" />
          )}
          <button type="button" aria-label="Previous photo" title="Previous"
            onPointerDown={(e) => e.stopPropagation()} onClick={prev} className={`${edge} left-0`}>
            <ChevronLeft size={44} />
          </button>
          <button type="button" aria-label="Next photo" title="Next"
            onPointerDown={(e) => e.stopPropagation()} onClick={next} className={`${edge} right-0`}>
            <ChevronRight size={44} />
          </button>
          {showShare !== false && current && (
            <button type="button" aria-label="Share this photo" title="Share this photo"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => setSharing(true)}
              className="absolute bottom-4 right-4 z-10 rounded-full bg-white/10 p-2.5 text-white/40 transition hover:bg-white/20 hover:text-white">
              <Share2 size={20} />
            </button>
          )}
        </>
      )}
      {sharing && current && <SharePanel assetId={current} onClose={() => setSharing(false)} />}
    </div>
  );
}

// ---------- share panel: link + QR + connected families ----------

function SharePanel({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [share, setShare] = useState<{ url: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [peers, setPeers] = useState<{ id: string; name: string; status: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const minted = await api<{ url: string }>("/api/photos/share", { method: "POST", body: { assetId } });
        setShare(minted);
        setQr(await QRCode.toDataURL(minted.url, { width: 220, margin: 1 }));
        const fed = await api<{ peers: { id: string; name: string; status: string }[] }>("/api/federation");
        setPeers(fed.peers.filter((p) => p.status === "active"));
      } catch (err) {
        showToast((err as Error).message, "error");
        onClose();
      }
    })();
  }, [assetId, onClose]);

  const sendToPeer = async (peer: { id: string; name: string }) => {
    if (!share) return;
    try {
      await api(`/api/federation/peers/${peer.id}/share-photo`, { method: "POST", body: { url: share.url } });
      showToast(`Sent to ${peer.name} 📷`);
      onClose();
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-sm rounded-card bg-card p-4 shadow-card" onPointerDown={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-extrabold">Share this photo</h3>
        {!share ? (
          <p className="py-6 text-center text-sm font-semibold text-ink-soft">Making a link…</p>
        ) : (
          <div className="space-y-3">
            {qr && (
              <div className="flex justify-center rounded-lg bg-white p-3">
                <img src={qr} alt="Scan to open the photo" className="h-40 w-40" />
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className={`${ghostBtn} flex-1`}
                onClick={() => { void navigator.clipboard.writeText(share.url); showToast("Link copied"); }}>
                <Copy size={14} className="mr-1 inline" /> Copy link
              </button>
              {"share" in navigator && (
                <button type="button" className={`${ghostBtn} flex-1`}
                  onClick={() => void navigator.share({ url: share.url }).catch(() => undefined)}>
                  <Share2 size={14} className="mr-1 inline" /> Share…
                </button>
              )}
            </div>
            {peers.length > 0 && (
              <div className="border-t border-line pt-2">
                <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-ink-soft">Send to a family</p>
                <div className="flex flex-wrap gap-1.5">
                  {peers.map((peer) => (
                    <button key={peer.id} type="button" className={ghostBtn} onClick={() => void sendToPeer(peer)}>
                      👨‍👩‍👧 {peer.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs font-semibold text-ink-soft">The link works for 7 days, no sign-in needed.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- fullscreen overlay (in-app slideshow / screensaver) ----------

export function SlideshowOverlay({ onExit }: { onExit: () => void }) {
  const rotation = usePhotoRotation({ speedSec: readSpeedSec(), order: readOrder() });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") rotation.next();
      else if (e.key === "ArrowLeft") rotation.prev();
      else onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, rotation]);

  return (
    <div className="fixed inset-0 z-50" onPointerDown={onExit}>
      <PhotoStage {...rotation} onCenterTap={onExit} />
    </div>
  );
}

// ---------- setup modal ----------

export function SlideshowSetupModal({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const [delay, setDelay] = useState("10");
  const [idle, setIdle] = useState(() => (readIdleMinutes() ? String(readIdleMinutes()) : ""));
  const [speed, setSpeed] = useState(() => String(readSpeedSec()));
  const [order, setOrder] = useState<"shuffle" | "seq">(readOrder());

  const savePrefs = () => {
    localStorage.setItem(SPEED_KEY, String(Math.min(600, Math.max(3, Number(speed) || 15))));
    localStorage.setItem(ORDER_KEY, order);
  };

  return (
    <Modal title="Slideshow" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Seconds per photo</label>
            <input className={inputCls} type="number" min={3} max={600} value={speed}
              onChange={(e) => setSpeed(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Order</label>
            <div className="flex rounded-lg bg-cream shadow-card">
              {(["shuffle", "seq"] as const).map((o, i) => (
                <button key={o} type="button" onClick={() => setOrder(o)}
                  title={o === "seq" ? "Follows the folder/album order (random sources stay shuffled)" : undefined}
                  className={`flex-1 px-2 py-1.5 text-sm font-bold transition ${i > 0 ? "border-l border-line" : ""} ${
                    order === o ? "bg-sky text-white" : "text-ink-soft"
                  } ${i === 0 ? "rounded-l-lg" : "rounded-r-lg"}`}>
                  {o === "shuffle" ? "Shuffle" : "In order"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button type="button" className={`${primaryBtn} flex w-full items-center justify-center gap-2`}
          onClick={() => { savePrefs(); onClose(); onStart(); }}>
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
              savePrefs();
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
                savePrefs();
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
