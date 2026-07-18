import { useEffect, useState } from "react";
import { Images } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { usePlugins } from "../../api/queries";
import { ghostBtn, inputCls, labelCls, primaryBtn } from "../../components/Modal";
import { showToast } from "../../components/Toast";

interface ImmichSettings {
  url: string;
  albumId: string;
  configured: boolean;
}

/**
 * Photos (Immich) — connect the family's own photo server. The API key is
 * write-only: it's stored server-side and never comes back to the browser.
 */
export function PhotosSection() {
  const qc = useQueryClient();
  const { data: plugins } = usePlugins();
  const enabled = plugins?.find((p) => p.id === "immich")?.enabled ?? false;
  const { data } = useQuery({
    queryKey: ["immich-settings"],
    queryFn: () => api<ImmichSettings>("/api/p/immich/settings"),
    enabled,
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

  if (!enabled) return null; // flip it on under Settings → Plugins

  const save = async () => {
    try {
      await api("/api/p/immich/settings", {
        method: "POST",
        body: { url, ...(apiKey ? { apiKey } : {}), albumId },
      });
      setApiKey("");
      void qc.invalidateQueries({ queryKey: ["immich-settings"] });
      showToast("Photo settings saved 🖼️");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  const test = async () => {
    try {
      const result = await api<{ version: string }>("/api/p/immich/test", { method: "POST" });
      showToast(`Connected! Immich ${result.version} 🎉`);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  const loadAlbums = async () => {
    try {
      const result = await api<{ albums: { id: string; name: string; count: number }[] }>("/api/p/immich/albums");
      setAlbums(result.albums);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Images size={18} /> Photos (Immich)</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Point Coord at your Immich server and any display can be a photo frame
        (Settings → Displays → Screen → 🖼️ Photos). The API key stays on your server.
      </p>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Immich address</label>
          <input className={inputCls} type="url" placeholder="https://photos.yourfamily.com"
            value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>
            API key {data?.configured ? "(saved — enter a new one to replace it)" : "(Immich → Account settings → API keys)"}
          </label>
          <input className={inputCls} type="password" placeholder={data?.configured ? "••••••••" : "Paste the key"}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Slideshow album (optional — otherwise random from everything)</label>
          {albums ? (
            <select className={inputCls} value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              <option value="">🎲 All photos</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>{album.name} ({album.count})</option>
              ))}
            </select>
          ) : (
            <button type="button" className={ghostBtn} onClick={() => void loadAlbums()} disabled={!data?.configured}>
              Pick an album…
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className={primaryBtn} onClick={() => void save()}>Save</button>
          <button type="button" className={ghostBtn} onClick={() => void test()}>Test connection</button>
        </div>
      </div>
    </section>
  );
}
