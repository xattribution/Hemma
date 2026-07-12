import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Monitor, QrCode, Trash2 } from "lucide-react";
import type { DisplayConfig, DisplayInfo } from "@coord/shared";
import { useDisplayMutations, useDisplays } from "../../api/queries";
import { Modal, inputCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

const displayUrl = (token: string) => `${location.origin}/dashboard?device=${token}`;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied! 📋");
  } catch {
    // Clipboard API needs HTTPS; fall back to a prompt the user can copy from.
    window.prompt("Copy the link:", text);
  }
}

/**
 * Shared displays — tablets or screens anywhere in the house. Links are
 * retrievable and shareable (family-trust model), with a QR code for
 * quick setup and per-display control over what's shown.
 */
export function DisplaysSection() {
  const { data: displays } = useDisplays();
  const mutations = useDisplayMutations();
  const [label, setLabel] = useState("");
  const [qrFor, setQrFor] = useState<DisplayInfo | null>(null);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    mutations.create.mutate(
      { label },
      { onSuccess: () => setLabel(""), onError: (err) => showToast(err.message, "error") },
    );
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Monitor size={18} /> Displays</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Tablets and screens around the house — kitchen, living room, bedroom. Open a display's
        link once on the device (or scan its QR code) and it stays signed in. Choose what each
        display shows below.
      </p>

      <div className="space-y-3">
        {(displays ?? []).map((display) => (
          <div key={display.id} className="rounded-xl border-2 border-line p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-extrabold">{display.label}</span>
              {display.token && (
                <>
                  <button type="button" title="Copy display link" className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
                    onClick={() => void copyText(displayUrl(display.token!))}>
                    <Copy size={15} />
                  </button>
                  <button type="button" title="Show QR code" className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
                    onClick={() => setQrFor(display)}>
                    <QrCode size={15} />
                  </button>
                </>
              )}
              <button type="button" title="Remove display (signs it out)" className="rounded-lg p-1.5 text-ink-soft hover:bg-line hover:text-coral"
                onClick={() => mutations.remove.mutate(display.id)}>
                <Trash2 size={15} />
              </button>
            </div>

            {display.token && (
              <input readOnly value={displayUrl(display.token)} onFocus={(e) => e.target.select()}
                className="mt-2 w-full rounded-lg border-2 border-line bg-cream px-2 py-1 font-mono text-[11px] text-ink-soft" />
            )}

            <DisplayConfigEditor display={display} onChange={(config) => mutations.update.mutate({ id: display.id, config })} />
          </div>
        ))}
      </div>

      <form onSubmit={create} className="mt-3 flex gap-2">
        <input className={inputCls} placeholder="Living room tablet" value={label}
          onChange={(e) => setLabel(e.target.value)} required maxLength={60} />
        <button className={`${primaryBtn} shrink-0`}>Create</button>
      </form>

      {qrFor?.token && (
        <Modal title={`Scan on the ${qrFor.label}`} onClose={() => setQrFor(null)}>
          <QrImage text={displayUrl(qrFor.token)} />
          <p className="mt-2 text-center text-xs font-semibold text-ink-soft">
            Opens the display view, signed in and ready.
          </p>
        </Modal>
      )}
    </section>
  );
}

function DisplayConfigEditor({ display, onChange }: { display: DisplayInfo; onChange: (config: DisplayConfig) => void }) {
  const config = display.config;
  const set = (patch: Partial<DisplayConfig>) => onChange({ ...config, ...patch });

  const Toggle = ({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) => (
    <button type="button" onClick={onToggle}
      className={`rounded-full px-2.5 py-1 text-xs font-extrabold transition ${value ? "bg-leaf/15 text-leaf" : "bg-line text-ink-soft"}`}>
      {label} {value ? "✓" : "✕"}
    </button>
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-extrabold uppercase tracking-wide text-ink-soft">Shows:</span>
      <button type="button"
        onClick={() => set({ layout: config.layout === "dashboard" ? "calendar" : "dashboard" })}
        className="rounded-full bg-coral-soft px-2.5 py-1 text-xs font-extrabold text-coral">
        {config.layout === "dashboard" ? "📋 Dashboard" : "📅 Full calendar"}
      </button>
      <Toggle label="Events" value={config.showEvents} onToggle={() => set({ showEvents: !config.showEvents })} />
      <Toggle label="Chores" value={config.showChores} onToggle={() => set({ showChores: !config.showChores })} />
      <Toggle label="Lists" value={config.showLists} onToggle={() => set({ showLists: !config.showLists })} />
    </div>
  );
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(text, { width: 320, margin: 1, color: { dark: "#3a3330", light: "#fdf8f0" } }).then(setSrc);
  }, [text]);
  return src ? <img src={src} alt="Display link QR code" className="mx-auto rounded-xl" /> : null;
}
