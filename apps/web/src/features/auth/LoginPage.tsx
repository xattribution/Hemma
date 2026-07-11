import { useState } from "react";
import type { Member } from "@coord/shared";
import { Delete } from "lucide-react";
import { useLogin, useLoginMembers } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { inputCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

export function LoginPage() {
  const { data } = useLoginMembers();
  const login = useLogin();
  const [selected, setSelected] = useState<Member | null>(null);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");

  const submit = (credential: string) => {
    if (!selected) return;
    login.mutate(
      { memberId: selected.id, credential },
      {
        onError: (err) => {
          showToast(err.message, "error");
          setPin("");
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
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="mb-2 text-6xl">🏡</div>
        <h1 className="text-3xl font-extrabold">Who's there?</h1>
      </div>

      {!selected && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {data?.members.map((member) => (
            <button key={member.id} type="button"
              onClick={() => { setSelected(member); setPin(""); setPassword(""); }}
              className="flex flex-col items-center gap-2 rounded-card bg-card p-5 shadow-card transition hover:scale-105 active:scale-95">
              <Avatar member={member} size="xl" />
              <span className="text-lg font-extrabold">{member.name}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-card bg-card p-6 shadow-card">
          <Avatar member={selected} size="xl" />
          <span className="text-xl font-extrabold">{selected.name}</span>

          {selected.role === "child" ? (
            <>
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
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-cream text-xl font-extrabold shadow-card transition active:scale-90">
                      {key === "⌫" ? <Delete size={20} /> : key}
                    </button>
                  ),
                )}
              </div>
            </>
          ) : (
            <form className="flex w-full flex-col gap-3"
              onSubmit={(e) => { e.preventDefault(); submit(password); }}>
              <input className={inputCls} type="password" placeholder="Password" value={password} autoFocus
                onChange={(e) => setPassword(e.target.value)} />
              <button className={primaryBtn} disabled={login.isPending}>Sign in</button>
            </form>
          )}

          <button type="button" className="text-sm font-bold text-ink-soft hover:text-coral"
            onClick={() => setSelected(null)}>
            ← Not {selected.name}?
          </button>
        </div>
      )}
    </div>
  );
}
