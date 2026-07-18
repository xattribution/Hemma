# Federation (family-to-family sharing)

**Module:** `apps/server/src/modules/federation.ts` + `core/fedcrypto.ts`
**Relay:** `apps/relay` (zero-dep Node, RAM-only) + `deploy/relay/`
**UI:** Settings → Family connections (FamiliesSection).

## Principles (user's hard requirements)

- Everything between families is **end-to-end encrypted** (x25519 ECDH →
  HKDF-SHA256 → AES-256-GCM; `seal/open` = base64 iv‖tag‖ct).
- The relay is **zero-knowledge**: RAM-only mailboxes of sealed blobs,
  no logs, no persistence, burns pairing offers on claim. Default
  `https://coord.tinbadger.com`, user-replaceable, self-host documented
  (one command, `apps/relay/README.md`), linked from the settings UI.
- **Direct (LAN/domain) is the default transport; relay is opt-in.**
- Sharing is explicit and per-list. **Revoke = silent vanish** on the other
  side (no error, no residue). Conflicts: arrival order at the owning
  family (owner's copy is source of truth).

## Pairing flows

**Direct:** A creates a code (`POST /api/federation/code`, RAM `offers` map,
10-min expiry). B enters code + A's URL → B's server POSTs A's
`/api/federation/pair` (rate-limited, `allowPairing` gate, self-pair
rejected) → A stores a `request` peer + broadcasts `federation`
invalidation → parent on A approves → A pushes sealed `pair.approve` to
B's `replyUrl`. **Rescue path:** while pending, B polls A's
`/api/federation/pair/poll {pubkey}` every sync tick — a missed approval
delivery can't strand the pairing.

**Relay:** A's code also registers a relay offer + a *placeholder* peer row
(`shared_key='-'`, name `(waiting…)`) watching a mailbox. B claims the code
at the relay (one-time burn), seals a `pair.request` intro into A's
mailbox. A's 10s collector turns the placeholder into a `request`;
approval flows back through mailboxes. Placeholders expire after 15 min.

Peer states: `pending` (outgoing, waiting) / `request` (incoming, needs
approve/decline) / `active`. Every state is cancellable:
`DELETE /api/federation/requests/:id` (decline) and
`DELETE /api/federation/peers/:id` (cancel/disconnect — sends
`peer.remove` when a real key exists; **placeholders skip sealing**, which
previously crashed deletion).

## Message protocol (all sealed)

`pair.approve` · `list.snapshot` (full list, hash-gated every 15s) ·
`list.op` (toggle an item on a list WE own; applied in arrival order,
audited as "<Family> got 'Eggs'") · `list.revoke` · `event.copy`
(one-shot copy onto their calendar, "(from <family>)" appended) ·
`peer.remove`. Unknown senders and bad seals are dropped silently.

## Known bug history (fixed, keep regressions out)

- Relay offer collector matched `pubkey='-'` but placeholders store
  `offer:<code>` in pubkey → incoming relay requests never surfaced.
  Collector now matches `shared_key='-'`.
- `seal()` ran outside try/catch in `sendToPeer` → deleting placeholder
  peers 500'd ("can't get rid of old requests").
- Missing `trustProxy` → `req.protocol` was http behind NPM → direct-mode
  reply URLs broke approval delivery.
- WS nudges used the `members` key; FamiliesSection listens on
  `federation` (15s poll remains as fallback).

Tests: `test/federation.test.ts` — two real instances over HTTP: pair,
share, cross-check, event copy, silent revoke, poll rescue endpoint,
self-pair rejection, pending cancel, placeholder delete.

## Pending / gaps

- No live end-to-end test against the real `coord.tinbadger.com` relay yet
  (relay compose is ready in `deploy/relay/`).
- Shared-in lists: toggle only (no remote add/edit) — see lists.md.
- `event.copy` is one-shot; no ongoing cross-family event sync.
- MCP has share/revoke/send-event tools; "send Jonathan's family the Costco
  list" works by peer+list name resolution.
