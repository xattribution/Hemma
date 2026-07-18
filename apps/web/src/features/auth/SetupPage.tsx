import { useState } from "react";
import { AVATARS, MEMBER_COLORS } from "@coord/shared";
import { deviceTimezone, useSetup } from "../../api/queries";
import { inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

export function SetupPage() {
  const setup = useSetup();
  const [householdName, setHouseholdName] = useState("");
  const [name, setName] = useState("");
  const [credential, setCredential] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setup.mutate(
      {
        householdName,
        timezone: deviceTimezone(),
        owner: { name, credential, avatar, color },
      },
      { onError: (err) => showToast(err.message, "error") },
    );
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="mb-2 text-6xl">🏡</div>
        <h1 className="text-3xl font-extrabold">Welcome to Hemma!</h1>
        <p className="mt-1 font-semibold text-ink-soft">Let's set up your family's home base.</p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-card bg-card p-6 shadow-card">
        <div>
          <label className={labelCls}>Family name</label>
          <input className={inputCls} placeholder="The Kotvas Family" value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)} required maxLength={60} />
        </div>
        <div>
          <label className={labelCls}>Your name</label>
          <input className={inputCls} placeholder="Jared" value={name}
            onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </div>
        <div>
          <label className={labelCls}>Your password</label>
          <input className={inputCls} type="password" placeholder="At least 6 characters" value={credential}
            onChange={(e) => setCredential(e.target.value)} required minLength={6} />
        </div>
        <div>
          <label className={labelCls}>Pick your look</label>
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.slice(0, 10).map((a) => (
              <button key={a} type="button" onClick={() => setAvatar(a)}
                className={`rounded-full p-1.5 text-2xl transition ${avatar === a ? "bg-coral-soft ring-2 ring-coral" : "hover:bg-line"}`}>
                {a}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MEMBER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`color ${c}`}
                className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <button className={`${primaryBtn} w-full`} disabled={setup.isPending}>
          {setup.isPending ? "Setting up…" : "Create our home base"}
        </button>
      </form>
      <p className="mt-4 text-center text-xs font-semibold text-ink-soft">
        You'll add the rest of the family in Settings → Family.
      </p>
    </div>
  );
}
