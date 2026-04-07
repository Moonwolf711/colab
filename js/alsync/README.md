# js/alsync — JS bridge stub for the Rust alsync core

This directory is **intentionally empty of source code**.

It is the landing zone for the **JS bridge layer** of the upcoming
`.alsync` CRDT-based persistence layer. The bulk of the alsync
implementation will live in a separate **Rust core** (running as a
Windows service / native binary) — this directory holds only the JS
glue that lets the existing colab Node stack talk to that core.

## Why Rust + JS, not pure JS?

The `.alsync` persistence layer needs to integrate with **CFAPI** —
the Windows Cloud Files API (`cldflt.sys` kernel filter driver). This
is the same surface OneDrive and Dropbox use to present cloud-synced
files as on-demand placeholders. CFAPI has first-class Rust bindings
in the official `windows` crate (verified:
`windows::Win32::Storage::CloudFilters::CF_CALLBACK_TYPE_NOTIFY_FILE_CLOSE_COMPLETION`),
but **no JavaScript runtime can host CFAPI directly** — it requires a
real OS-level provider written in Rust or C++.

So the architecture splits along the kernel boundary:

| Layer | Language | Where it lives |
|---|---|---|
| CFAPI provider | Rust | New repo / sibling dir to `~/colab/`, NOT inside this dir |
| Loro CRDT core | Rust (`loro` crate) | Same Rust binary |
| Sample CAS (BLAKE3) | Rust | Same Rust binary |
| AbletonOSC observer + sender | Rust | Same Rust binary |
| **JS bridge to Rust core** | **JS** | **Here, when implementation begins** |
| M4LNotifier, colab_livesync.js notifications | JS | `js/hub/` and `colab_livesync.js` — already exists |
| param-sync.js runtime overlay | JS | `js/hub/param-sync.js` — already exists, unchanged in v0 |

## Why empty?

The full architecture spec lives at:

> **`~/tasks/alsync-architecture.md`** (outside this repo)

It defines:
- The 64-byte `.alsync` file format header
- Five distinct API contracts (CFAPI, AbletonOSC namespace, AbletonOSC
  observer, M4L LiveAPI JS observer, UDP 8001 prefix protocol)
- The two-protocol layering rule (Loro on TCP, OSC on UDP — mixing
  them desyncs the doc tree)
- 9-module Rust decomposition (cfapi_provider, als_projector,
  als_differ, loro_doc, op_broadcaster, sample_cas, liveapi_bridge,
  osc_listener, peer_registry)
- Topology (broker-less p2p + Cloudflare Tunnel for WAN)
- Saga pattern for destructive Live operations (Consolidate, Freeze,
  Crop)
- Security model (Ed25519 + TOFU peer auth, BLAKE3 content integrity,
  WAN-only transport encryption, CVE-2025-55680 caveat)
- 4 documented CFAPI gotchas from real Microsoft Q&A threads
- BLAKE3 content-addressed sample CAS pattern
- MVP element list and Loro doc tree mapping
- Migration path (v0 → v0.5 → v1)

A second, formal architecture + implementation spec is being produced
in parallel by another research session. Step 6 of that flow is the
synthesis point where the two specs reconcile and the canonical
version emerges. **Until that happens, no production code is committed
here** — not a parser, not a materializer, not a Loro wrapper, not a
stub class, not a Rust crate. The directory exists so the
implementation session can drop into it without resolving merge
conflicts against speculative scaffolding.

## Status

**BLOCKED on the unblock gate.**

The unblock gate is the **CFAPI + Live 12.x XML round-trip experiment**
(documented in `~/tasks/alsync-architecture.md` § Unblock Gate). In
short: prove that we can take a real Live 12.x `.als` file, parse it
with the chosen XML library, re-emit it, gzip it back, open it in
Live, and have Live accept the result with zero data loss and zero
error dialogs. This is a 5-minute wall-clock experiment — but until
it passes, every line of `.alsync` code is built against an unverified
assumption.

## What gets built here, eventually

When the gate passes (and after spec reconciliation at step 6):

| File | Purpose |
|---|---|
| `rust-bridge.js` | Bidirectional UDP socket pair to the Rust core. Sends commands ("export current state", "apply this op batch"). Receives notifications ("peer saved", "merge applied", "destructive op rejected, retry needed"). Wire format = same JSON-over-UDP convention the existing CoLaB hub uses on UDP 8001. |

That is the **only file** that will live in this directory. Everything
else is in the Rust core (separate binary, separate repo or directory).

## What does NOT change in the existing colab JS stack

Roughly half the colab JS we shipped this session slots into the
alsync world unchanged. From the spec § Module Decomposition § JS
bridge layer:

- `js/hub/tcp-stack.js` — **unchanged**. The Rust core has its own
  TCP transport for Loro deltas; this JS-side `tcp-stack.js` continues
  to handle the existing AlsReplicator + cursor sync paths.
- `js/hub/als-git.js` — **kept**. Its `_onRawSave` hook (added in
  commit `54f314b`) still fires for the legacy AlsReplicator path
  during the v0 → v0.5 parallel-stack migration.
- `js/hub/als-differ.js` — **kept** for the legacy stack. The Rust
  core has its own port of this module (`als_differ` module) that
  reuses the same junk-element filter list.
- `js/hub/m4l-notifier.js` — **unchanged**.
- `colab_livesync.js` `applyDelta` 'nf' case — **unchanged**.
- `js/hub/colab-engine.js` — **extended** to register the new
  rust-bridge subsystem alongside existing TCP/UDP/Notifier/Replicator.
- `js/hub/param-sync.js` runtime overlay — **unchanged in v0**. The
  Rust persistence layer is for save-time merge correctness; ParamSync
  is for live editing. They serve different audiences and run in
  parallel — there's no conflict.

## Why this is gated, not optimistic

The other research session's integration patterns findings surfaced
**4 CFAPI gotchas** that are documented but partially undocumented in
Microsoft's own materials:

1. NTFS-compressed files break TRANSFER_DATA
2. FETCH_DATA cannot alter file size mid-flight
3. FETCH_PLACEHOLDERS fires repeatedly on directory enumeration
4. VALIDATE_DATA semantics partially undocumented

Plus one CVE: **CVE-2025-55680** in cldflt.sys is a TOCTOU privilege
escalation, which means CFAPI callback parameters need to be treated
as semi-untrusted.

Plus the AbletonOSC ↔ Loro causal-broadcast separation rule: if you
mix UDP observer events into the Loro op stream, the doc tree
desyncs within minutes. There is no way to recover from this without
a full snapshot restore.

These are not problems that can be debugged after they happen — they
need to be designed against from the first commit. That's why we wait
for the spec to reconcile at step 6 before any code lands.

## Next concrete action

1. Other session runs the CFAPI + Live 12.x round-trip experiment
2. Result reconciled with `~/tasks/alsync-architecture.md` at step 6
3. `cargo new alsync-core --lib` (in a sibling directory, NOT in this
   repo)
4. Implementation begins in the Rust core; this directory gets
   `rust-bridge.js` last to wire the JS side

Until then, this README is the only file here.
