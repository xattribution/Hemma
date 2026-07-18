# Gaps register — pending & incomplete work

The honest list. Each entry: what's missing, where the seam is, and any
existing plan doc. If you're a fresh agent looking for "what's next",
start here (and confirm priorities with the project owner first).

## Not built yet (planned features)

| Feature | State | Seam / plan |
| --- | --- | --- |
| **Cross-family file sharing** | **SHIPPED v12**: message threads per family + sealed chunked transfers (offer/accept, save to NAS `files/` or app folder, download). Still open: sending straight FROM a NAS folder browser (today you attach from the device), per-person DMs, group chats, sharing lists/events inside a thread | wiki/federation.md §Messages |
| External calendars & photos (ICS subs → iCloud CalDAV → Google Calendar OAuth → Google Photos Picker, iCloud shared albums) | **ICS subscriptions SHIPPED** (`core.calsync`, Settings → Other calendars, read-only imports w/ filters); the OAuth/CalDAV rungs are next | `docs/integrations-plan.md` (note: Google killed third-party full-library Photos access in 2025 — Picker/album mirror only) |
| AI assistant plugin (chat box, "magic add", recall answers) | Not started (Phase 2 of original plan) | Provider-agnostic adapter (Ollama/Anthropic/OpenAI); local-first, **no external APIs by default**; reuse REST services + audit grounding |
| Voice control (wake word + STT) | Not started (Phase 3) | **Whisper preferred**; feeds the Phase-2 intent parser |
| Email → calendar ingest | Not started (Phase 5) | IMAP watcher plugin → extraction → **direct-add by default, approval tray optional** (user's explicit choice) |
| Google / Outlook 2-way sync | Not started (Phase 5) | External calendar APIs; per-member account linking |
| Drawable calendar overlay | Not started (Phase 6) | `calendar.day-cell.overlay` plugin slot is the reserved seam |
| Home Assistant integration | Not started (Phase 6) | Bus → MQTT relay plugin |
| Points redemption / allowance payout | Goals + ledger + races/deadlines/monthly resets shipped; no "spend points" flow | Ledger supports it: negative `manual` entries; needs UI concept |
| Server-in-a-box packaging | **SHIPPED**: guided Docker installer (`deploy/install.sh`), standalone Windows-zip + Linux-tarball server bundles, `scripts/release.sh` pipeline, Settings → Phones & tablets (APK QR). Still open: Play Store / App Store listings, release-signed APK, desktop-bundled server, tablet-as-server | `docs/packaging-plan.md`, wiki/apps-shell.md |

## Partial implementations (works, but bounded)

- **Federated lists are toggle-only for the receiving family** — no remote
  add/edit/delete of items. Extend the sealed `list.op` protocol.
- **`event.copy` is one-shot** — no continuing cross-family event sync.
- **`todo` task kind** exists in the schema; UI presents everything as
  chores.
- **Backup is one-way** — download endpoint + NAS patterns shipped; no
  in-app restore/upload (restore = file swap, documented in the README).
- **Week/day calendar views** are functional but plain (no drag/resize).
- **API tokens are all-or-nothing** parent-level; no scoped/read-only
  tokens.
- **Relay has never been exercised against the live coord.tinbadger.com**
  — covered by unit-level flows and the direct-mode two-instance tests;
  deploy + one real relay pairing is outstanding.
- **APK is debug-signed** (sideload-friendly); no store-grade signing.
- **iOS push** requires HTTPS + installed PWA (platform rule) — in-app WS
  toasts are the fallback; the native shells don't add push.

## Known behavioral decisions (not bugs)

- Revoked shares vanish silently on the other side — by design.
- Conflicts resolve by arrival order at the owning family — by design.
- Displays act as a member for only ~60s after verification — by design.
- New kid accounts default to the `little` UI tier; pre-v8 kids default to
  the standard (teen) tier until a parent flips them.

## Debt / hygiene

- `docs/design-decisions.md` predates several systems; the wiki supersedes
  it for architecture (kept for decision rationale).
- E2E golden flows in `/e2e` cover phase-1 features; the kid app, photos
  layout, and federation UI are verified by ad-hoc scripted browser passes
  (screenshots in session logs) — porting those into `/e2e` would harden CI.
- The `apps` workflow (desktop/Android builds) is untested in CI until the
  first tag push.
