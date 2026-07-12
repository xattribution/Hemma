import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Me, Member } from "@coord/shared";
import { api } from "../../api/client";
import { useLoginMembers } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { Modal, inputCls, primaryBtn } from "../../components/Modal";
import { PatternPad } from "../../components/PatternPad";
import { showToast } from "../../components/Toast";

/**
 * Display elevation: the screen is always-on and readable; the moment
 * someone changes something we ask who they are. A successful check acts
 * as that member for a few minutes (server-enforced), shown in a banner.
 */
interface ElevationState {
  /** Resolve to true when the caller may proceed with a change. */
  ensure: () => Promise<boolean>;
  actingAs: Member | null;
}

const ElevationContext = createContext<ElevationState>({ ensure: async () => true, actingAs: null });
export const useElevation = () => useContext(ElevationContext);

export function ElevationProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const [actingAs, setActingAs] = useState<Member | null>(
    me.kind === "device" ? (me.elevation?.member ?? null) : null,
  );
  const [until, setUntil] = useState(me.kind === "device" ? (me.elevation?.until ?? 0) : 0);
  const [asking, setAsking] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const needsAuth = me.kind === "device" && me.config.requireAuthToChange;

  // Drop the banner when the server-side window lapses.
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => {
      if (Date.now() > until) {
        setActingAs(null);
        setUntil(0);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [until]);

  const ensure = useCallback(async (): Promise<boolean> => {
    if (!needsAuth) return true;
    if (actingAs && Date.now() < until) return true;
    setAsking(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, [needsAuth, actingAs, until]);

  const finish = (ok: boolean, member?: Member, newUntil?: number) => {
    setAsking(false);
    if (ok && member && newUntil) {
      setActingAs(member);
      setUntil(newUntil);
      void qc.invalidateQueries({ queryKey: ["me"] });
    }
    resolver.current?.(ok);
    resolver.current = null;
  };

  const done = async () => {
    setActingAs(null);
    setUntil(0);
    await api("/api/auth/device/deelevate", { method: "POST" }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <ElevationContext.Provider value={{ ensure, actingAs: actingAs && Date.now() < until ? actingAs : null }}>
      {children}
      {actingAs && Date.now() < until && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-cream shadow-card">
          <Avatar member={actingAs} size="sm" />
          <span className="text-sm font-bold">Acting as {actingAs.name}</span>
          <button type="button" onClick={() => void done()}
            className="rounded-full bg-cream/20 px-2.5 py-0.5 text-xs font-extrabold hover:bg-cream/30">
            Done
          </button>
        </div>
      )}
      {asking && <ElevateModal onCancel={() => finish(false)} onSuccess={(m, u) => finish(true, m, u)} />}
    </ElevationContext.Provider>
  );
}

function ElevateModal({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: (member: Member, until: number) => void }) {
  const { data } = useLoginMembers();
  const [selected, setSelected] = useState<Member | null>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [attempt, setAttempt] = useState(0);

  const submit = async (credential: string) => {
    if (!selected) return;
    try {
      const result = await api<{ member: Member; until: number }>("/api/auth/device/elevate", {
        method: "POST",
        body: { memberId: selected.id, credential },
      });
      onSuccess(result.member, result.until);
    } catch (err) {
      showToast((err as Error).message, "error");
      setPin("");
      setAttempt((a) => a + 1);
    }
  };

  const pressDigit = (digit: string) => {
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  return (
    <Modal title={selected ? `Hi ${selected.name}!` : "Who's changing things?"} onClose={onCancel}>
      {!selected ? (
        <div className="grid grid-cols-3 gap-3">
          {data?.members.map((member) => (
            <button key={member.id} type="button" onClick={() => { setSelected(member); setPin(""); setPassword(""); }}
              className="flex flex-col items-center gap-1.5 rounded-card bg-card p-3 shadow-card transition active:scale-95">
              <Avatar member={member} size="lg" />
              <span className="text-sm font-extrabold">{member.name}</span>
            </button>
          ))}
        </div>
      ) : selected.credentialType === "pattern" ? (
        <PatternPad resetKey={attempt} onComplete={(encoded) => void submit(encoded)} />
      ) : selected.credentialType === "pin" ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-4 w-4 rounded-full border-2 border-line ${pin.length > i ? "bg-coral" : "bg-cream"}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, i) =>
              key === "" ? (
                <span key={i} />
              ) : (
                <button key={i} type="button"
                  onClick={() => (key === "⌫" ? setPin((p) => p.slice(0, -1)) : pressDigit(key))}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-cream text-xl font-extrabold shadow-card active:scale-90">
                  {key}
                </button>
              ),
            )}
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(password); }}>
          <input className={inputCls} type="password" placeholder="Password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)} />
          <button className={primaryBtn}>Continue</button>
        </form>
      )}
      {selected && (
        <button type="button" className="mt-3 w-full text-center text-sm font-bold text-ink-soft hover:text-coral"
          onClick={() => setSelected(null)}>
          ← Not {selected.name}?
        </button>
      )}
    </Modal>
  );
}
