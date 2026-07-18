# Design decisions

Owner-confirmed decisions that future phases must build against.
(Decided 2026-07; each maps to a roadmap phase in the README.)

> Architecture and per-module documentation moved to [wiki/](wiki/README.md)
> — this file stays as the record of *why* those decisions were made.

## 1. Federation conflict resolution — ordered writes

Shared items (e.g., a cross-household shopping list) resolve conflicts by
**arrival order**: the first adder creates the item; every subsequent update
is applied in the order it happened. Concretely:

- Every federated mutation carries a creation/update timestamp and a
  per-instance sequence number.
- Replays apply in `(timestamp, sequence)` order — no merge dialogs, no
  "conflict" state surfaced to the family. Last update in that order is the
  current state.
- The history feed shows the full ordered trail on both instances
  ("Sam (Kotvas-West) checked Milk", "Jared unchecked Milk"), so nothing is
  silently lost even when an earlier write is superseded.

## 2. Email → calendar — direct by default, tray as an option

AI-extracted events from email go **straight onto the calendar** by default.
A per-household setting (`email.approvalTray: false` by default) switches to
a "suggested events" tray where a parent approves each item. Either way,
every auto-added event is tagged with its source ("from email: subject …")
in the event description and in history, and is trivially deletable.

## 3. AI providers — local-first, external only by explicit connect

- **No external API calls by default.** Out of the box, AI features are off
  until a provider is configured.
- Provider adapter interface supports: a locally hosted AI server
  (Ollama-style HTTP endpoint) and hosted APIs (Anthropic/OpenAI) — the
  parent explicitly enters an endpoint/key in Settings → Plugins to enable one.
- **Speech-to-text: Whisper is the preferred engine** (local
  whisper.cpp/faster-whisper server); hosted STT is a fallback option, never
  a default.

## 4. Federation privacy — parents choose what leaves the house

Nothing is shared with another household unless a parent explicitly shares
that category or list. Per-pairing share policy (e.g., "share: Shopping
lists, Holiday events" with the Kotvas-West instance); kids' chores, points
and personal calendars stay private unless deliberately included. Either
side can unshare at any time.

## 5. Points — quiet by default, modes as opt-in plugins

Default experience: completing a chore is its own reward (checkmark,
confetti-level satisfaction, history entry). Optional modes, each an
individually toggleable feature (off by default):

- **Competition mode** — leaderboard/streaks between kids
- **Goal mode** — points accumulate toward a family-defined goal
  ("100 points = zoo trip")
- **Allowance mode** — points convert to allowance at a parent-set rate

Modes only change presentation/accounting; the underlying `points` field on
tasks (already in the schema) is the single source of truth.
