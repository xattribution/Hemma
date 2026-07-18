# Hemma apps — .exe, .apk, Linux packages

The native apps are a thin shell (`apps/shell`, Tauri 2): a small window that
asks for your family's server address **once**, remembers it, and then loads
the same Hemma PWA the browser gets. All the real UI ships from your server —
so the apps never go stale when you update the server.

## Building the installers

Everything is built by GitHub Actions (`.github/workflows/apps.yml`):

```bash
scripts/release.sh 0.1.0 --push-image   # the full pipeline (see README)
# or just:  git tag v0.1.0 && git push --tags   # client apps only
```

That produces a GitHub release with:

| Artifact | For |
| --- | --- |
| `Hemma_x.y.z_x64-setup.exe` / `.msi` | Windows |
| `Hemma_x.y.z_amd64.deb` / `.AppImage` | Linux |
| `Hemma_x.y.z_*.dmg` | macOS |
| `coord-android.apk` | Android (sideload) |

You can also run the workflow manually (Actions → apps → Run workflow) to get
the same files as workflow artifacts without cutting a release.

To build just the Linux app locally: install the WebKitGTK dev packages
(`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`), then
`pnpm --filter @coord/shell build`.

## Installing

- **Windows**: run the `.exe` installer. SmartScreen will warn because the
  binary isn't code-signed — "More info → Run anyway".
- **Linux**: `sudo apt install ./Hemma_*.deb`, or `chmod +x` the AppImage and
  run it.
- **Android**: easiest path — in the web app, **Settings → Phones &
  tablets** shows a QR code; scanning it downloads the latest APK straight
  from GitHub. (Or send the `.apk` any other way.) Allow "install from
  unknown sources" when asked.
  The APK is debug-signed — fine for family sideloading; installing a newer
  build straight over it keeps working because the signing key is stable per
  machine only. If an update refuses to install, uninstall the old one first.
- **iPhone/iPad**: there is no APK-equivalent without an Apple developer
  account — use the PWA: open the server address in Safari → Share →
  **Add to Home Screen**. It looks and behaves like the app.

## First launch

The app asks for the server address — the same thing you'd type in a browser:

- at home: `192.168.1.20:49733` (plain addresses default to `http://`)
- with a domain: `https://hemma.yourfamily.com`

It checks the address is reachable, saves it, and connects. Launching again
skips straight to your calendar ("Use a different server" appears for a
second on the way in if you ever need to change it).

## Notes & limitations

- The shell needs to reach your server: same Wi-Fi at home, or a
  reverse-proxied HTTPS domain (e.g. Nginx Proxy Manager) from anywhere.
- Plain-`http` LAN addresses work in all shells (the Android build explicitly
  allows cleartext for home setups). Web-push notifications still require
  HTTPS — that's a browser/OS rule, not a Hemma one.
- The APK is a client, not the server. "The wall tablet IS the server"
  (bundling the Node server into the APK) stays on the roadmap in
  [packaging-plan.md](./packaging-plan.md).
