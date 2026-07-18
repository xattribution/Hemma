import { useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { showToast } from "../../components/Toast";

/**
 * "Phones & tablets" — get Sett onto everyone's devices without app stores:
 * the server's own address (big + copyable), a QR that downloads the Android
 * app straight from the latest GitHub release, and home-screen instructions
 * for iPhone. Written for the least technical person in the family.
 */
const REPO = "https://github.com/xattribution/Sett";
const APK_URL = `${REPO}/releases/latest/download/sett-android.apk`;
const RELEASES_URL = `${REPO}/releases/latest`;

export function AppsSection() {
  const address = window.location.origin;
  const [apkQr, setApkQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(APK_URL, { width: 180, margin: 1 }).then(setApkQr).catch(() => setApkQr(""));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy — long-press the address instead", "error");
    }
  };

  return (
    <section className="rounded-card bg-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 font-extrabold"><Smartphone size={18} /> Phones & tablets</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Everyone in the house connects to this same address — hand it to them
        once and their device stays signed in.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-cream px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-bold">{address}</code>
        <button type="button" onClick={() => void copy()} title="Copy the address"
          className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-sm font-bold">
          {copied ? <Check size={14} className="text-leaf" /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 font-bold">📱 iPhone & iPad</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold text-ink-soft">
            <li>Open the address above in <b>Safari</b>.</li>
            <li>Tap the Share button (square with an arrow).</li>
            <li>Tap <b>Add to Home Screen</b>.</li>
          </ol>
          <p className="mt-1 text-sm font-semibold text-ink-soft">
            It looks and works like a real app from then on.
          </p>
        </div>

        <div>
          <h4 className="mb-1 font-bold">🤖 Android</h4>
          <p className="text-sm font-semibold text-ink-soft">
            Same home-screen trick works in Chrome — or install the Sett app:
            scan this with the phone's camera to download it.
          </p>
          <div className="mt-2 flex items-center gap-3">
            {apkQr && <img src={apkQr} alt="QR code to download the Android app" className="h-28 w-28 rounded-lg border border-line bg-white p-1" />}
            <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold text-ink-soft">
              <li>Scan → download → open the file.</li>
              <li>Allow the install if the phone asks (it's outside the Play Store for now).</li>
              <li>Open Sett and type the address above.</li>
            </ol>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm font-semibold text-ink-soft">
        Computers: the web address just works, or grab the desktop app
        (Windows / Mac / Linux) from the{" "}
        <a className="font-bold text-sky underline" href={RELEASES_URL} target="_blank" rel="noreferrer">
          latest release
        </a>.
      </p>
    </section>
  );
}
