import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, HeartHandshake, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import { useChecklists } from "../../api/queries";
import { Modal, ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

interface FedState {
  relayUrl: string;
  relayEnabled: boolean;
  allowPairing: boolean;
  peers: { id: string; name: string; transport: string; status: string; shares: string[] }[];
  requests: { id: string; name: string; transport: string }[];
}

/** Connect with extended family — one-time codes, per-list sharing, silent revoke. */
export function FamiliesSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["federation"],
    queryFn: () => api<FedState>("/api/federation"),
    refetchInterval: 15_000, // pairing requests arrive out-of-band
  });
  const { data: lists } = useChecklists();
  const [code, setCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["federation"] });

  const post = async (path: string, body?: unknown, method = "POST") => {
    try {
      const result = await api<Record<string, unknown>>(path, { method, body });
      refresh();
      return result;
    } catch (err) {
      showToast((err as Error).message, "error");
      return null;
    }
  };

  if (!data) return null;

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><HeartHandshake size={18} /> Family connections</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Share chosen lists and events with grandma's or your brother's Hemma. Everything between
        families is end-to-end encrypted; the optional connection server only relays sealed blobs
        and keeps nothing.
      </p>

      {/* incoming requests */}
      {data.requests.map((request) => (
        <div key={request.id} className="mb-2 flex items-center gap-2 rounded-xl bg-sun/15 px-3 py-2">
          <span className="flex-1 text-sm font-extrabold">🤝 {request.name} wants to connect</span>
          <button type="button" className="rounded-full bg-leaf p-1.5 text-white" title="Approve"
            onClick={() => void post(`/api/federation/requests/${request.id}/approve`)}>
            <Check size={16} />
          </button>
          <button type="button" className="rounded-full bg-line p-1.5 text-ink-soft" title="Decline"
            onClick={() => void post(`/api/federation/requests/${request.id}`, undefined, "DELETE")}>
            <X size={16} />
          </button>
        </div>
      ))}

      {/* connected families with per-list share toggles */}
      <div className="space-y-2">
        {data.peers.map((peer) => (
          <div key={peer.id} className="rounded-xl border-2 border-line p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-extrabold">
                {peer.status === "active" ? "👨‍👩‍👧" : "⏳"} {peer.name}
              </span>
              <span className="text-[10px] font-bold uppercase text-ink-soft">
                {peer.status === "active" ? peer.transport
                  : peer.name === "(waiting…)" ? "open invite code"
                  : "waiting for their approval"}
              </span>
              {peer.status === "active" ? (
                <button type="button" title="Disconnect" className="rounded-lg p-1.5 text-ink-soft hover:text-coral"
                  onClick={() => void post(`/api/federation/peers/${peer.id}`, undefined, "DELETE")}>
                  <Trash2 size={15} />
                </button>
              ) : (
                <button type="button"
                  className="rounded-lg px-2 py-1 text-xs font-extrabold text-ink-soft hover:bg-coral-soft hover:text-coral"
                  onClick={() => void post(`/api/federation/peers/${peer.id}`, undefined, "DELETE")}>
                  Cancel
                </button>
              )}
            </div>
            {peer.status === "active" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-xs font-extrabold uppercase tracking-wide text-ink-soft">Sharing:</span>
                {(lists ?? []).map((list) => {
                  const shared = peer.shares.includes(list.id);
                  return (
                    <button key={list.id} type="button"
                      onClick={() =>
                        void post(
                          shared
                            ? `/api/federation/peers/${peer.id}/share/${list.id}`
                            : `/api/federation/peers/${peer.id}/share`,
                          shared ? undefined : { checklistId: list.id },
                          shared ? "DELETE" : "POST",
                        )
                      }
                      className={`rounded-full px-2.5 py-1 text-xs font-extrabold transition ${
                        shared ? "bg-leaf text-white" : "bg-line text-ink-soft"
                      }`}>
                      {list.icon} {list.title} {shared ? "✓" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryBtn}
          onClick={async () => {
            const result = await post("/api/federation/code", { mode: data.relayEnabled ? "relay" : "local" });
            if (result?.code) setCode(result.code as string);
          }}>
          Create connect code
        </button>
        <button type="button" className={ghostBtn} onClick={() => setConnecting(true)}>Enter a code</button>
      </div>

      {/* trust switches */}
      <div className="mt-3 space-y-1.5 border-t-2 border-line pt-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={data.allowPairing}
            onChange={(e) => void post("/api/federation/settings", { allowPairing: e.target.checked })} />
          Accept connection requests
        </label>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={data.relayEnabled}
            onChange={(e) => void post("/api/federation/settings", { relayEnabled: e.target.checked })} />
          Use the connection server (for families you can't reach directly)
        </label>
        {data.relayEnabled && (
          <>
            <input className={`${inputCls} text-sm`} defaultValue={data.relayUrl}
              onBlur={(e) => void post("/api/federation/settings", { relayUrl: e.target.value })}
              placeholder="https://coord.tinbadger.com" />
            <p className="text-xs font-semibold text-ink-soft">
              The connection server only relays sealed, encrypted blobs — it can't read anything.
              Prefer running your own? It's one command on any small VPS:{" "}
              <a href="https://github.com/xattribution/coord/tree/claude/family-coordination-calendar-bs4zqo/apps/relay"
                target="_blank" rel="noreferrer" className="text-coral underline">
                self-host guide on GitHub
              </a>{" "}
              — then paste your relay's address above.
            </p>
          </>
        )}
      </div>

      {code && (
        <Modal title="Your connect code" onClose={() => setCode(null)}>
          <p className="mb-2 text-center text-5xl font-extrabold tracking-widest text-coral">{code}</p>
          <p className="text-center text-sm font-semibold text-ink-soft">
            Tell the other family this code (good for 10 minutes). They enter it under
            Settings → Family connections → Enter a code{data.relayEnabled ? "." : ", along with your Hemma address."}
          </p>
        </Modal>
      )}
      {connecting && (
        <ConnectModal relayEnabled={data.relayEnabled} onClose={() => { setConnecting(false); refresh(); }} />
      )}
    </section>
  );
}

function ConnectModal({ relayEnabled, onClose }: { relayEnabled: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const connect = useMutation({
    mutationFn: () =>
      api("/api/federation/connect", { method: "POST", body: { code, url: url.trim() || undefined } }),
    onSuccess: () => {
      showToast("Request sent — waiting for their approval 🤝");
      onClose();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  return (
    <Modal title="Connect with a family" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }}>
        <div>
          <label className={labelCls}>Their connect code</label>
          <input className={`${inputCls} text-center text-2xl font-extrabold uppercase tracking-widest`}
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TIGER-42" required maxLength={12} />
        </div>
        <div>
          <label className={labelCls}>Their Hemma address {relayEnabled ? "(leave blank to use the connection server)" : ""}</label>
          <input className={inputCls} type="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://coord.theirfamily.com" required={!relayEnabled} />
        </div>
        <button className={`${primaryBtn} w-full`} disabled={connect.isPending}>
          {connect.isPending ? "Connecting…" : "Send request"}
        </button>
      </form>
    </Modal>
  );
}
