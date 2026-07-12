import { useState } from "react";
import type { Member } from "@coord/shared";
import { useLogin, useLoginMembers } from "../api/queries";
import { Avatar } from "./Avatar";
import { Modal, inputCls, primaryBtn } from "./Modal";
import { PatternPad } from "./PatternPad";
import { showToast } from "./Toast";

/**
 * Quick account switch on a shared device: pick who you are, verify with
 * your password / PIN / picture pattern, and the session swaps in place.
 */
export function SwitchPersonModal({ currentId, onClose }: { currentId: string; onClose: () => void }) {
  const { data } = useLoginMembers();
  const login = useLogin();
  const [selected, setSelected] = useState<Member | null>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [attempt, setAttempt] = useState(0);

  const submit = (credential: string) => {
    if (!selected) return;
    login.mutate(
      { memberId: selected.id, credential },
      {
        onSuccess: () => {
          showToast(`Hi, ${selected.name}! 👋`);
          onClose();
        },
        onError: (err) => {
          showToast(err.message, "error");
          setPin("");
          setAttempt((a) => a + 1);
        },
      },
    );
  };

  const pressDigit = (digit: string) => {
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  };

  return (
    <Modal title={selected ? `Hi ${selected.name}!` : "Who's this?"} onClose={onClose}>
      {!selected ? (
        <div className="grid grid-cols-3 gap-3">
          {data?.members
            .filter((member) => member.id !== currentId)
            .map((member) => (
              <button key={member.id} type="button"
                onClick={() => { setSelected(member); setPin(""); setPassword(""); }}
                className="flex flex-col items-center gap-1.5 rounded-card bg-card p-3 shadow-card transition active:scale-95">
                <Avatar member={member} size="lg" />
                <span className="text-sm font-extrabold">{member.name}</span>
              </button>
            ))}
        </div>
      ) : selected.credentialType === "pattern" ? (
        <PatternPad resetKey={attempt} onComplete={submit} />
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
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(password); }}>
          <input className={inputCls} type="password" placeholder="Password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)} />
          <button className={primaryBtn} disabled={login.isPending}>Switch</button>
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
