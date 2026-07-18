import { useEffect, useState } from "react";
import { Images } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { usePlugins } from "../../api/queries";
import { ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

interface ImmichSettings { url: string; albumId: string; configured: boolean }
interface NasSettings { root: string; configured: boolean }
interface SourceState {
  source: "none" | "immich" | "nas";
  options: { id: string; label: string; comingSoon?: boolean }[];
}

/**
 * Photos — pick the household's photo source and configure it. Slideshows
 * (displays' photo screen + the avatar-menu slideshow/screensaver) all pull
 * from whichever source is selected here.
 */
export function PhotosSection() {
  const qc = useQueryClient();
  const { data: plugins } = usePlugins();
  const immichEnabled = plugins?.find((p) => p.id === "immich")?.enabled ?? false;
  const nasEnabled = plugins?.find((p) => p.id === "nas")?.enabled ?? false;
  const { data: sourceState } = useQuery({
    queryKey: ["photo-source"],
    queryFn: () => api<SourceState>("/api/photos/source"),
  });

  if (!immichEnabled && !nasEnabled) return null; // flip one on under Plugins

  const setSource = async (source: string) => {
    try {
      await api("/api/photos/source", { method: "POST", body: { source } });
      void qc.invalidateQueries({ queryKey: ["photo-source"] });
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Images size={18} /> Photos</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Slideshows — the 🖼️ display screen and the screensaver in your avatar
        menu — show photos from the source you pick here.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {(sourceState?.options ?? []).map((option) => {
          const active = sourceState?.source === option.id;
          const available =
            (option.id === "immich" && immichEnabled) || (option.id === "nas" && nasEnabled);
          return (
            <button key={option.id} type="button"
              disabled={!!option.comingSoon || !available}
              title={option.comingSoon ? "Planned — alongside Google Calendar sync" : !available ? "Enable the plugin under Plugins first" : undefined}
              onClick={() => void setSource(active ? "none" : option.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition ${
                active ? "border-sky bg-sky text-white"
                  : option.comingSoon || !available ? "border-line text-ink-soft opacity-50"
                  : "border-line hover:border-ink-soft"
              }`}>
              {option.label}{option.comingSoon ? " · soon" : ""}
            </button>
          );
        })}
      </div>

      {immichEnabled && <ImmichBlock />}
      {nasEnabled && <NasBlock />}
    </section>
  );
}

// ---------- Immich ----------

function ImmichBlock() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["immich-settings"],
    queryFn: () => api<ImmichSettings>("/api/p/immich/settings"),
  });
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [albums, setAlbums] = useState<{ id: string; name: string; count: number }[] | null>(null);
  const [albumId, setAlbumId] = useState("");
  useEffect(() => {
    if (data) {
      setUrl(data.url);
      setAlbumId(data.albumId);
    }
  }, [data]);

  const save = async () => {
    try {
      await api("/api/p/immich/settings", { method: "POST", body: { url, ...(apiKey ? { apiKey } : {}), albumId } });
      setApiKey("");
      void qc.invalidateQueries({ queryKey: ["immich-settings"] });
      showToast("Immich saved");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };
  const test = async () => {
    try {
      const result = await api<{ version: string }>("/api/p/immich/test", { method: "POST" });
      showToast(`Connected — Immich ${result.version}`);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };
  const loadAlbums = async () => {
    try {
      setAlbums((await api<{ albums: { id: string; name: string; count: number }[] }>("/api/p/immich/albums")).albums);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <div className="border-t border-line pt-3">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-ink-soft">Immich</p>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Address</label>
            <input className={inputCls} type="url" placeholder="https://photos.yourfamily.com"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>API key {data?.configured ? "(saved)" : ""}</label>
            <input className={inputCls} type="password" placeholder={data?.configured ? "••••••••" : "Immich → Account → API keys"}
              value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {albums ? (
            <select className={`${inputCls} max-w-60`} value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              <option value="">All photos</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>{album.name} ({album.count})</option>
              ))}
            </select>
          ) : (
            <button type="button" className={ghostBtn} onClick={() => void loadAlbums()} disabled={!data?.configured}>
              Pick an album…
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className={ghostBtn} onClick={() => void test()}>Test</button>
            <button type="button" className={primaryBtn} onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- NAS folder ----------

function NasBlock() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["nas-settings"],
    queryFn: () => api<NasSettings>("/api/p/nas/settings"),
  });
  const [root, setRoot] = useState("");
  const [counts, setCounts] = useState<{ photoCount: number; fileCount: number } | null>(null);
  useEffect(() => {
    if (data) setRoot(data.root);
  }, [data]);

  const saveAndTest = async () => {
    try {
      await api("/api/p/nas/settings", { method: "POST", body: { root } });
      const result = await api<{ photoCount: number; fileCount: number }>("/api/p/nas/test", { method: "POST" });
      setCounts(result);
      void qc.invalidateQueries({ queryKey: ["nas-settings"] });
      showToast("NAS folder connected");
    } catch (err) {
      setCounts(null);
      showToast((err as Error).message, "error");
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-ink-soft">NAS folder</p>
      <p className="mb-2 text-sm font-semibold text-ink-soft">
        Mount your NFS/SMB share on the server and bind it into the container
        (e.g. <code className="rounded bg-cream px-1">/mnt/family-nas:/nas</code> in docker-compose.yml), then point
        Hemma at it. Hemma creates <code className="rounded bg-cream px-1">photos/</code> for slideshows and{" "}
        <code className="rounded bg-cream px-1">files/</code> for family file sharing (coming with federation).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-72`} placeholder="/nas"
          value={root} onChange={(e) => setRoot(e.target.value)} />
        <button type="button" className={primaryBtn} onClick={() => void saveAndTest()} disabled={!root.trim()}>
          Connect
        </button>
        {counts && (
          <span className="text-sm font-bold text-ink-soft">
            {counts.photoCount} photo{counts.photoCount === 1 ? "" : "s"} · {counts.fileCount} file{counts.fileCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
