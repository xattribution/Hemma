# Gaps register — pending & incomplete work

The honest list. Each entry: what's missing, where the seam is, and any
existing plan doc. If you're a fresh agent looking for "what's next",
start here (and confirm priorities with Jared first).

## Not built yet (planned features)

| Feature | State | Seam / plan |
| --- | --- | --- |
| **Cross-family file sharing** from the NAS `files/` folder | NAS photo source SHIPPED (nas plugin + unified /api/photos source); `files/` folder is created but sharing isn't built | Ride the federation sealed channel; see wiki/immich.md |
| Google Photos source + Google Calendar 2-way sync | Not started (picker shows "soon") | OAuth + incremental sync; photo source drops into /api/photos |
| AI assistant plugin (chat box, "magic add", recall answers) | Not started (Phase 2 of original plan) | Provider-agnostic adapter (Ollama/Anthropic/OpenAI); local-first, **no external APIs by default**; reuse REST services + audit grounding |
| Voice control (wake word + STT) | Not started (Phase 3) | **Whisper preferred**; feeds the Phase-2 intent parser |
| Email → calendar ingest | Not started (Phase 5) | IMAP watcher plugin → extraction → **direct-add by default, approval tray optional** (user's explicit choice) |
| Google / Outlook 2-way sync | Not started (Phase 5) | External calendar APIs; per-member account linking |
| Drawable calendar overlay | Not started (Phase 6) | `calendar.day-cell.overlay` plugin slot is the reserved seam |
| Home Assistant integration | Not started (Phase 6) | Bus → MQTT relay plugin |
| Points redemption / allowance payout | Goals + ledger + races/deadlines/monthly resets shipped; no "spend points" flow | Ledger supports it: negative `manual` entries; needs UI concept |
| Server-in-a-box packaging (installer / desktop-bundled server / tablet-as-server APK) | Client shells shipped; server tiers pending | `docs/packaging-plan.md` |

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
