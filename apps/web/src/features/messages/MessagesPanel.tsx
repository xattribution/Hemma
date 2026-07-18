import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Paperclip, Send, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { FedMessage, FedTransfer } from "@coord/shared";
import { useMessageMutations, useThread, useThreads } from "../../api/queries";
import { ghostBtn, inputCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

/**
 * The message box: one thread per connected family. Text plus file sends —
 * incoming files show an accept card (save to the family folder or the NAS)
 * before a single byte transfers. Everything crosses the wire sealed with
 * the pair key. Parents always see every thread; kids need the
 * "messages.use" grant a parent switches on.
 */
export function MessagesPanel({ onClose }: { onClose: () => void }) {
  const { data: threads } = useThreads();
  const [openPeer, setOpenPeer] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <div
        className="animate-slide-up flex h-full w-full flex-col border-l border-line bg-cream sm:w-[26rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-extrabold">Messages</h2>
            <p className="text-[11px] font-bold text-ink-soft">Between families · parents can read everything</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 hover:bg-card">
            <X size={18} />
          </button>
        </div>

        {openPeer ? (
          <ThreadView
            peerId={openPeer}
            peerName={threads?.find((t) => t.peerId === openPeer)?.peerName ?? ""}
            onBack={() => setOpenPeer(null)}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-3">
            {(threads ?? []).length === 0 && (
              <p className="mt-8 px-4 text-center text-sm font-semibold text-ink-soft">
                No connected families yet — pair with one in Settings → Other
                families, and their thread appears here.
              </p>
            )}
            {(threads ?? []).map((t) => (
              <button
                key={t.peerId}
                type="button"
                onClick={() => setOpenPeer(t.peerId)}
                className="mb-2 flex w-full items-center gap-3 rounded-card bg-card p-3 text-left shadow-card"
              >
                <span className="text-2xl">👨‍👩‍👧‍👦</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between">
                    <span className="truncate font-extrabold">{t.peerName}</span>
                    {t.unread > 0 && (
                      <span className="ml-2 rounded-full bg-coral px-2 py-0.5 text-[11px] font-extrabold text-white">
                        {t.unread}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm font-semibold text-ink-soft">
                    {t.lastMessage
                      ? `${t.lastMessage.kind === "file" ? "📎 " : ""}${t.lastMessage.body}`
                      : "Say hi 👋"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const fmtSize = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

function ThreadView({ peerId, peerName, onBack }: { peerId: string; peerName: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data } = useThread(peerId);
  const { send, markRead, accept, decline } = useMessageMutations();
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const count = data?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
    if (count > 0) markRead.mutate(peerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, count]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    send.mutate({ peerId, text: trimmed }, { onError: (err) => showToast((err as Error).message, "error") });
  };

  const sendFile = async (file: File) => {
    if (file.size > 200 * 1024 * 1024) {
      showToast("Files up to 200 MB for now", "error");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/messages/${peerId}/file?name=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Upload failed");
      void qc.invalidateQueries({ queryKey: ["messages"] });
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" onClick={onBack} aria-label="Back" className="rounded-lg p-1.5 hover:bg-card">
          <ArrowLeft size={18} />
        </button>
        <span className="font-extrabold">{peerName}</span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {(data?.messages ?? []).map((m) => (
          <MessageBubble key={m.id} m={m} transfer={m.transferId ? data?.transfers[m.transferId] : undefined}
            onAccept={(dest) => accept.mutate({ transferId: m.transferId!, dest }, { onError: (err) => showToast((err as Error).message, "error") })}
            onDecline={() => decline.mutate(m.transferId!)} />
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
        <button type="button" title="Send a file" aria-label="Send a file" disabled={uploading}
          onClick={() => fileInput.current?.click()} className={ghostBtn}>
          <Paperclip size={16} className={uploading ? "animate-pulse" : undefined} />
        </button>
        <input ref={fileInput} type="file" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendFile(f); e.target.value = ""; }} />
        <input className={`${inputCls} flex-1`} placeholder={uploading ? "Sending the file…" : "Write a message"}
          value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        <button className={primaryBtn} disabled={!text.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </>
  );
}

function MessageBubble({ m, transfer, onAccept, onDecline }: {
  m: FedMessage;
  transfer?: FedTransfer;
  onAccept: (dest: "nas" | "app") => void;
  onDecline: () => void;
}) {
  const mine = m.direction === "out";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-card px-3 py-2 shadow-card ${mine ? "bg-coral-soft" : "bg-card"}`}>
        <p className="text-[11px] font-extrabold text-ink-soft">{mine ? m.sender : m.sender}</p>
        {m.kind === "text" ? (
          <p className="whitespace-pre-wrap break-words text-sm font-semibold">{m.body}</p>
        ) : (
          <FileCard m={m} transfer={transfer} onAccept={onAccept} onDecline={onDecline} />
        )}
      </div>
    </div>
  );
}

function FileCard({ m, transfer, onAccept, onDecline }: {
  m: FedMessage;
  transfer?: FedTransfer;
  onAccept: (dest: "nas" | "app") => void;
  onDecline: () => void;
}) {
  if (!transfer) return <p className="text-sm font-semibold">📎 {m.body}</p>;
  const pct = transfer.chunks ? Math.round((transfer.progress / transfer.chunks) * 100) : 0;
  const incoming = transfer.direction === "in";
  return (
    <div className="min-w-48">
      <p className="text-sm font-extrabold">📎 {transfer.name}</p>
      <p className="text-[11px] font-bold text-ink-soft">{fmtSize(transfer.size)}</p>

      {incoming && (transfer.status === "offered" || transfer.status === "failed") && (
        <div className="mt-2 space-y-1.5">
          {transfer.status === "failed" && <p className="text-[11px] font-bold text-coral">{transfer.error}</p>}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={`${primaryBtn} !px-2.5 !py-1 text-xs`} onClick={() => onAccept("app")}>
              Save it
            </button>
            <button type="button" className={`${ghostBtn} !px-2.5 !py-1 text-xs`} onClick={() => onAccept("nas")}>
              Save to NAS
            </button>
            {transfer.status === "offered" && (
              <button type="button" className={`${ghostBtn} !px-2.5 !py-1 text-xs`} onClick={onDecline}>
                No thanks
              </button>
            )}
          </div>
        </div>
      )}

      {(transfer.status === "receiving" || transfer.status === "sending") && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-cream">
            <div className="h-full bg-sky transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-0.5 text-[11px] font-bold text-ink-soft">
            {transfer.status === "receiving" ? "Receiving" : "Sending"} · {pct}%
          </p>
        </div>
      )}

      {transfer.status === "done" && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[11px] font-extrabold text-leaf">✓ {incoming ? "Saved" : "Delivered"}</span>
          {incoming && (
            <a href={`/api/messages/transfers/${transfer.id}/download`} download
              className="flex items-center gap-1 text-[11px] font-extrabold text-sky underline">
              <Download size={12} /> Download
            </a>
          )}
        </div>
      )}
      {transfer.status === "declined" && (
        <p className="mt-1 text-[11px] font-bold text-ink-soft">{incoming ? "Declined" : "They passed on this one"}</p>
      )}
      {!incoming && transfer.status === "offered" && (
        <p className="mt-1 text-[11px] font-bold text-ink-soft">Waiting for them to accept…</p>
      )}
      {!incoming && transfer.status === "failed" && (
        <p className="mt-1 text-[11px] font-bold text-coral">{transfer.error}</p>
      )}
    </div>
  );
}
