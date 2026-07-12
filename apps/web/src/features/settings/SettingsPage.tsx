import { useState } from "react";
import { Bell, Pencil, Plus, Puzzle, Trash2, Users } from "lucide-react";
import type { Me, Member, Role } from "@coord/shared";
import { AVATARS, MEMBER_COLORS, can } from "@coord/shared";
import { useMemberMutations, useMembers, usePlugins, useTogglePlugin } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";
import { usePush } from "./usePush";
import { DisplaysSection } from "./DisplaysSection";
import { AiAccessSection } from "./AiAccessSection";

export function SettingsPage({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const isParent = can(me.member.role, "settings.manage");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-xl font-extrabold">Settings</h2>
      <FamilySection isParent={isParent} />
      <NotificationsSection />
      {isParent && <DisplaysSection />}
      {isParent && <AiAccessSection />}
      {isParent && <PluginsSection />}
      <section className="rounded-card bg-card p-4 shadow-card text-sm font-semibold text-ink-soft">
        Coord v0.1 — your family's data lives on your own server. 💛
      </section>
    </div>
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const options = { onSuccess: onClose, onError: (err: Error) => showToast(err.message, "error") };
    if (member) {
      mutations.update.mutate(
        { id: member.id, name, role, avatar, color, ...(credential ? { credential } : {}) },
        options,
      );
    } else {
      mutations.create.mutate({ name, role, avatar, color, credential }, options);
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
        <div>
          <label className={labelCls}>{role === "child" ? `4-digit PIN${member ? " (leave blank to keep)" : ""}` : `Password${member ? " (leave blank to keep)" : ""}`}</label>
          <input className={inputCls} type={role === "child" ? "tel" : "password"}
            inputMode={role === "child" ? "numeric" : undefined}
            pattern={role === "child" ? "\\d{4}" : undefined}
            placeholder={role === "child" ? "1234" : "At least 6 characters"}
            value={credential} onChange={(e) => setCredential(e.target.value)}
            required={!member} minLength={role === "child" ? 4 : 6} maxLength={role === "child" ? 4 : 72} />
        </div>
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
    "needs-install": "On iPhone/iPad: add Coord to your Home Screen first (Share → Add to Home Screen), then enable reminders here.",
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

// ---------- Plugins ----------

function PluginsSection() {
  const { data: plugins } = usePlugins();
  const toggle = useTogglePlugin();

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Puzzle size={18} /> Plugins</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Coord grows with your family — AI assistant, voice, email import and family-to-family sharing will appear here.
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
