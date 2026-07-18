import { useState } from "react";
import { Bell, ChevronDown, ChevronRight, DatabaseBackup, Home, Pencil, Plus, Puzzle, Trash2, Users } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Grant, Me, Member, Role } from "@coord/shared";
import { AVATARS, GRANTS, MEMBER_COLORS, PATTERN_ANIMALS, can } from "@coord/shared";
import { api } from "../../api/client";
import { useMemberMutations, useMembers, usePlugins, useTogglePlugin } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { PatternPad } from "../../components/PatternPad";
import { showToast } from "../../components/Toast";
import { usePush } from "./usePush";
import { DisplaysSection } from "./DisplaysSection";
import { FamiliesSection } from "./FamiliesSection";
import { AiAccessSection } from "./AiAccessSection";
import { PhotosSection } from "./PhotosSection";
import { SubscriptionsSection } from "./SubscriptionsSection";
import { AppsSection } from "./AppsSection";

export function SettingsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const isParent = can(me.member.role, "settings.manage");
  if (!isParent) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-xl font-extrabold">Settings</h2>
        <FamilySection isParent={false} />
        <NotificationsSection />
        <VersionFooter />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-xl font-extrabold">Settings</h2>
      <SettingsGroup id="family" title="Family & home">
        <HouseholdSection currentName={me.household.name} />
        <FamilySection isParent />
        <NotificationsSection />
      </SettingsGroup>
      <SettingsGroup id="devices" title="Screens & apps">
        <DisplaysSection />
        <AppsSection />
      </SettingsGroup>
      <SettingsGroup id="content" title="Calendars & photos">
        <SubscriptionsSection />
        <PhotosSection />
      </SettingsGroup>
      <SettingsGroup id="connections" title="Other families">
        <FamiliesSection />
      </SettingsGroup>
      <SettingsGroup id="advanced" title="System & backup" defaultOpen={false}>
        <BackupSection />
        <AiAccessSection />
        <PluginsSection />
      </SettingsGroup>
      <VersionFooter />
    </div>
  );
}

/** A labeled, collapsible band of settings cards; open state is remembered
    per device so the page stays as tidy as each family leaves it. */
function SettingsGroup({ id, title, children, defaultOpen = true }: {
  id: string; title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(`coord.settings.group.${id}`);
    return saved === null ? defaultOpen : saved === "1";
  });
  const toggle = () =>
    setOpen((current) => {
      localStorage.setItem(`coord.settings.group.${id}`, current ? "0" : "1");
      return !current;
    });
  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-line pb-1.5 text-left">
        <span className="text-xs font-extrabold uppercase tracking-widest text-ink-soft">{title}</span>
        {open ? <ChevronDown size={16} className="text-ink-soft" /> : <ChevronRight size={16} className="text-ink-soft" />}
      </button>
      {open && <div className="mt-3 space-y-4">{children}</div>}
    </div>
  );
}

function VersionFooter() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean; version: string }>("/api/health"),
    staleTime: Infinity,
  });
  return (
    <p className="pb-2 text-center text-sm font-semibold text-ink-soft">
      Hemma {data?.version && data.version !== "dev" ? `v${data.version}` : "(dev)"} — your family's data lives on your own server. 💛
    </p>
  );
}

// ---------- Household ----------

function HouseholdSection({ currentName }: { currentName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(currentName);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/household", { method: "PATCH", body: { name } });
      void qc.invalidateQueries({ queryKey: ["me"] });
      showToast("Family name updated 🏡");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Home size={18} /> Our home</h3>
      <form onSubmit={save} className="flex gap-2">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        <button className={`${primaryBtn} shrink-0`} disabled={name.trim() === currentName}>Save</button>
      </form>
    </section>
  );
}

// ---------- Family ----------

function FamilySection({ isParent }: { isParent: boolean }) {
  const { data: members } = useMembers();
  const [editing, setEditing] = useState<Member | "new" | null>(null);

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-extrabold"><Users size={18} /> Family</h3>
        {isParent && (
          <button type="button" className={`${primaryBtn} flex items-center gap-1 px-3 py-1.5 text-sm`} onClick={() => setEditing("new")}>
            <Plus size={16} /> Add
          </button>
        )}
      </div>
      <div className="space-y-2">
        {(members ?? []).map((member) => (
          <div key={member.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3 py-2">
            <Avatar member={member} size="sm" />
            <div className="flex-1">
              <p className="font-extrabold">{member.name}</p>
              <p className="text-xs font-bold capitalize text-ink-soft">{member.role}</p>
            </div>
            {isParent && (
              <button type="button" className="rounded-lg p-1.5 text-ink-soft hover:bg-line" onClick={() => setEditing(member)}>
                <Pencil size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && <MemberModal member={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const mutations = useMemberMutations();
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState<Role>(member?.role ?? "child");
  const [avatar, setAvatar] = useState(member?.avatar ?? AVATARS[1]);
  const [color, setColor] = useState(member?.color ?? MEMBER_COLORS[3]);
  const [credential, setCredential] = useState("");
  const [credType, setCredType] = useState<"pin" | "pattern">(
    member?.credentialType === "pattern" ? "pattern" : "pin",
  );
  const [grants, setGrants] = useState<Grant[]>(member?.grants ?? []);
  const [uiLevel, setUiLevel] = useState<"little" | "teen">(member?.uiLevel ?? "little");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!member && role === "child" && credType === "pattern" && !credential) {
      showToast("Tap the picture pattern first", "error");
      return;
    }
    const options = { onSuccess: onClose, onError: (err: Error) => showToast(err.message, "error") };
    const credentialType = role === "parent" ? ("password" as const) : credType;
    const payload = {
      name, role, avatar, color, credentialType,
      grants: role === "child" ? grants : [],
      uiLevel: role === "child" ? uiLevel : null,
    };
    if (member) {
      mutations.update.mutate({ id: member.id, ...payload, ...(credential ? { credential } : {}) }, options);
    } else {
      mutations.create.mutate({ ...payload, credential }, options);
    }
  };

  return (
    <Modal title={member ? `Edit ${member.name}` : "Add family member"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        <div>
          <label className={labelCls}>Role</label>
          <div className="flex gap-2">
            {(["parent", "child"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold capitalize ${role === r ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                {r === "parent" ? "🧑 Parent" : "🧒 Kid"}
              </button>
            ))}
          </div>
        </div>

        {role === "child" && (
          <div>
            <label className={labelCls}>Their app</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setUiLevel("little")}
                className={`flex-1 rounded-xl border-2 px-3 py-2 text-left ${uiLevel === "little" ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                <span className="block font-bold">🧸 Little kid</span>
                <span className="text-xs font-semibold text-ink-soft">Big, simple screens — just their jobs, days & lists</span>
              </button>
              <button type="button" onClick={() => setUiLevel("teen")}
                className={`flex-1 rounded-xl border-2 px-3 py-2 text-left ${uiLevel === "teen" ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                <span className="block font-bold">🚲 Big kid</span>
                <span className="text-xs font-semibold text-ink-soft">The full app, minus settings & history</span>
              </button>
            </div>
          </div>
        )}

        {role === "child" && (
          <div>
            <label className={labelCls}>Sign-in style</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setCredType("pin"); setCredential(""); }}
                className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold ${credType === "pin" ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                🔢 4-digit PIN
              </button>
              <button type="button" onClick={() => { setCredType("pattern"); setCredential(""); }}
                className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold ${credType === "pattern" ? "border-coral bg-coral-soft" : "border-line bg-card"}`}>
                🐱 Picture pattern
              </button>
            </div>
          </div>
        )}

        {role === "child" && credType === "pattern" ? (
          <div>
            <label className={labelCls}>
              {credential ? "Pattern set! Tap again to change it" : `Tap 4 pictures in order${member ? " (skip to keep current)" : ""}`}
            </label>
            <PatternPad resetKey={credential} onComplete={setCredential} />
            {credential && (
              <p className="mt-1 text-center text-lg">
                {credential.slice(4).split("").map((i) => PATTERN_ANIMALS[Number(i)]).join(" → ")}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className={labelCls}>{role === "child" ? `4-digit PIN${member ? " (leave blank to keep)" : ""}` : `Password${member ? " (leave blank to keep)" : ""}`}</label>
            <input className={inputCls} type={role === "child" ? "tel" : "password"}
              inputMode={role === "child" ? "numeric" : undefined}
              pattern={role === "child" ? "\\d{4}" : undefined}
              placeholder={role === "child" ? "1234" : "At least 6 characters"}
              value={credential} onChange={(e) => setCredential(e.target.value)}
              required={!member} minLength={role === "child" ? 4 : 6} maxLength={role === "child" ? 4 : 72} />
          </div>
        )}

        {role === "child" && (
          <div>
            <label className={labelCls}>Can also…</label>
            <div className="space-y-1.5">
              {GRANTS.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-line px-3 py-2">
                  <input type="checkbox" className="h-5 w-5 accent-leaf" checked={grants.includes(key)}
                    onChange={() =>
                      setGrants((current) =>
                        current.includes(key) ? current.filter((g) => g !== key) : [...current, key],
                      )
                    } />
                  <span className="text-sm font-bold">{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>Look</label>
          <div className="flex flex-wrap gap-1">
            {AVATARS.map((a) => (
              <button key={a} type="button" onClick={() => setAvatar(a)}
                className={`rounded-full p-1 text-xl ${avatar === a ? "bg-coral-soft ring-2 ring-coral" : "hover:bg-line"}`}>
                {a}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MEMBER_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`color ${c}`} onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          {member ? (
            <button type="button" className="flex items-center gap-1.5 rounded-xl px-3 py-2 font-bold text-coral hover:bg-coral-soft"
              onClick={() => mutations.remove.mutate(member.id, { onSuccess: onClose, onError: (err) => showToast(err.message, "error") })}>
              <Trash2 size={16} /> Remove
            </button>
          ) : (
            <span />
          )}
          <button className={primaryBtn} disabled={!name.trim()}>{member ? "Save" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Notifications ----------

function NotificationsSection() {
  const { state, enable, disable } = usePush();
  const label = {
    unsupported: "Push isn't supported in this browser — in-app reminders still work.",
    "needs-install": "On iPhone/iPad: add Hemma to your Home Screen first (Share → Add to Home Screen), then enable reminders here.",
    denied: "Notifications are blocked in your browser settings.",
    off: "Get a nudge on this device before events and chores.",
    on: "Reminders are on for this device. 🎉",
  }[state];

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Bell size={18} /> Reminders on this device</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">{label}</p>
      {state === "off" && (
        <button type="button" className={primaryBtn} onClick={() => void enable().catch((err) => showToast(String(err), "error"))}>
          Enable reminders
        </button>
      )}
      {state === "on" && (
        <button type="button" className={ghostBtn} onClick={() => void disable()}>Turn off</button>
      )}
    </section>
  );
}

// ---------- Backup ----------

function BackupSection() {
  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><DatabaseBackup size={18} /> Backup</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Everything — calendar, chores, lists, points, members, settings — is one
        file. Download it to this device (or save it onto your NAS) and you can
        restore the whole household from it. Restore: stop the server, put the
        file back as <code className="rounded bg-cream px-1">coord.db</code> in the data folder, start it again.
      </p>
      <a href="/api/backup" download className={`${primaryBtn} inline-block`}>
        Download backup
      </a>
    </section>
  );
}

// ---------- Plugins ----------

function PluginsSection() {
  const { data: plugins } = usePlugins();
  const toggle = useTogglePlugin();

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Puzzle size={18} /> Plugins</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Hemma grows with your family — AI assistant, voice, email import and family-to-family sharing will appear here.
      </p>
      <div className="space-y-2">
        {(plugins ?? []).map((plugin) => (
          <div key={plugin.id} className="flex items-center gap-3 rounded-xl border-2 border-line px-3 py-2">
            <div className="flex-1">
              <p className="font-extrabold">{plugin.name}</p>
              <p className="text-xs font-semibold text-ink-soft">{plugin.description}</p>
            </div>
            {plugin.optional ? (
              <button type="button" role="switch" aria-checked={plugin.enabled}
                onClick={() => toggle.mutate({ id: plugin.id, enabled: !plugin.enabled })}
                className={`h-7 w-12 rounded-full p-1 transition ${plugin.enabled ? "bg-leaf" : "bg-line"}`}>
                <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${plugin.enabled ? "translate-x-5" : ""}`} />
              </button>
            ) : (
              <span className="text-xs font-bold uppercase text-ink-soft">Core</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
