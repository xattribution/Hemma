import { useState } from "react";
import { Bot, Copy, Trash2 } from "lucide-react";
import { useApiTokenMutations, useApiTokens } from "../../api/queries";
import { inputCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied! 📋");
  } catch {
    window.prompt("Copy the token:", text);
  }
}

/** Bearer tokens for AI assistants and automations (the HAL hookup). */
export function AiAccessSection() {
  const { data: tokens } = useApiTokens();
  const mutations = useApiTokenMutations();
  const [label, setLabel] = useState("");

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Bot size={18} /> AI & API access</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Connect an AI assistant or automation. It acts with full permissions and shows up in
        History under its name — machine-readable instructions live at{" "}
        <a href="/llms.txt" target="_blank" className="text-coral underline">/llms.txt</a>, and the
        repo ships an MCP server (<code className="text-xs">apps/mcp</code>) that plugs straight
        into Claude and other MCP clients.
      </p>

      <div className="space-y-2">
        {(tokens ?? []).map((token) => (
          <div key={token.id} className="rounded-xl border-2 border-line p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-extrabold">{token.label}</span>
              <button type="button" title="Copy token" className="rounded-lg p-1.5 text-ink-soft hover:bg-line"
                onClick={() => void copyText(token.token)}>
                <Copy size={15} />
              </button>
              <button type="button" title="Revoke (disconnects it immediately)"
                className="rounded-lg p-1.5 text-ink-soft hover:bg-line hover:text-coral"
                onClick={() => mutations.remove.mutate(token.id)}>
                <Trash2 size={15} />
              </button>
            </div>
            <input readOnly value={token.token} onFocus={(e) => e.target.select()}
              className="mt-2 w-full rounded-lg border-2 border-line bg-cream px-2 py-1 font-mono text-[11px] text-ink-soft" />
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutations.create.mutate(
            { label },
            { onSuccess: () => setLabel(""), onError: (err) => showToast(err.message, "error") },
          );
        }}
        className="mt-3 flex gap-2"
      >
        <input className={inputCls} placeholder="HAL, Home Assistant, …" value={label}
          onChange={(e) => setLabel(e.target.value)} required maxLength={60} />
        <button className={`${primaryBtn} shrink-0`}>Connect</button>
      </form>
    </section>
  );
}
