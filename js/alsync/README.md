# js/alsync — JS bridge stub for the colab-sync Rust workspace

This directory is **intentionally empty of source code**.

It is the landing zone for the **JS bridge layer** of the upcoming
`.alsync` CRDT-based persistence layer. The bulk of the implementation
lives in a sibling **Cargo workspace at `~/colab/colab-sync/`** —
8 Rust crates that share this repo. This directory holds only the
JS glue that lets the existing colab Node stack talk to that workspace
over UDP using the existing JSON-over-UDP convention.

Neither the Rust workspace nor any source files in this directory
exist yet. Both are gated on **Phase 0** — see § Status below.

## Why Rust + JS, not pure JS?

The `.alsync` persistence layer needs to integrate with **CFAPI** —
the Windows Cloud Files API (`cldflt.sys` kernel filter driver). This
is the same surface OneDrive and Dropbox use to present cloud-synced
files as on-demand placeholders. CFAPI has first-class Rust bindings
in the official `windows` crate (verified:
`windows::Win32::Storage::CloudFilters::CF_CALLBACK_TYPE_NOTIFY_FILE_CLOSE_COMPLETION`),
but **no JavaScript runtime can host CFAPI directly** — it requires a
real OS-level provider written in Rust or C++.

So the architecture splits along the kernel boundary, with the Rust
side organized as a Cargo workspace at `~/colab/colab-sync/` (8 crates):

| Layer | Crate / file | Where it lives |
|---|---|---|
| CFAPI provider (Windows-only) | `colab-cfapi` | `~/colab/colab-sync/colab-cfapi/` — `#[cfg(target_os = "windows")]` so the workspace builds on Mac/Linux |
| Loro doc + materializer + differ + VST blob hash dedupe | `colab-core` | `~/colab/colab-sync/colab-core/` |
| Reliable TCP peer link + Ed25519 + TOFU peer registry | `colab-transport` | `~/colab/colab-sync/colab-transport/` |
| BLAKE3 content-addressed sample store | `colab-cas` | `~/colab/colab-sync/colab-cas/` |
| AbletonOSC namespace + observer integration | `colab-bridge-osc` | `~/colab/colab-sync/colab-bridge-osc/` |
| M4L UDP 8001 dispatcher (replaces our M4LNotifier role) | `colab-bridge-m4l` | `~/colab/colab-sync/colab-bridge-m4l/` |
| WASM target for browser viewers / late-join (Phase 4-7) | `colab-wasm` | `~/colab/colab-sync/colab-wasm/` |
| CLI for ops + diagnostics (mirror of cli-anything-max) | `colab-cli` | `~/colab/colab-sync/colab-cli/` |
| **JS bridge to Rust core** | `rust-bridge.js` (NEW) | **Here**, when implementation begins |
| M4LNotifier, colab_livesync.js notifications | JS | `js/hub/` and `colab_livesync.js` — already exists, unchanged |
| param-sync.js runtime overlay | JS | `js/hub/param-sync.js` — already exists, unchanged through Phase 6 |

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

**BLOCKED on Phase 0.**

Phase 0 is the **CloudMirror + Live 12.x .als round-trip experiment**
(documented in `~/tasks/alsync-architecture.md` § Phase 0). In short:
build the Microsoft CloudMirror sample, project a known
XML-roundtripped `.als` through it, open in Live 12.x, save, verify
bytes. Single test that decides whether Strategy C (CFAPI placeholder
+ Live opens projected `.als` + saves cleanly + bytes verify) is
viable. The 12-item risk register from the parallel research session
ranks "Live rejecting the projected `.als`" as Risk #1 — the only
true blocker for the entire architecture.

Until Phase 0 passes:
- `~/colab/colab-sync/` does **not** exist (`cargo new` is gated)
- This directory has **no source files** beyond this README
- No `loro` Rust crate or `loro-crdt` npm package is added anywhere
- No CFAPI provider is registered

Phase 0 is a 5-minute wall-clock experiment — but every line of code
written before it passes is built against an unverified assumption.

## Friend-First Roadmap (post-Phase 0)

The implementation roadmap is reframed as **7 phases ending in
friend-visible wins**, not technical-completeness milestones, per the
parallel session's findings. Quick reference:

| Phase | Friend-visible win |
|---|---|
| **Phase 0** | *(none)* — CloudMirror experiment passes, Strategy C verified |
| **Phase 1** | *(none)* — `colab-core` + `colab-cas` ship as a passive observer |
| **Phase 2** | *"I can put this in our shared folder"* — `colab-cfapi` provider lands |
| **Phase 3** | *"we can both edit"* — `colab-transport` + `colab-bridge-osc` land |
| **Phase 4** | *"I can join after you started"* — late-join via snapshot delivery |
| **Phase 5** | *"your samples just appeared"* — `colab-cas` BLAKE3 sample distribution |
| **Phase 6** | *"merging just works"* — saga pattern, conflict polish |
| **Phase 7** | *"my friend on a Mac is jamming with me"* — Mac/Linux parity (FSEvents/FSKit replaces `colab-cfapi`) |

Throughout Phases 1-6, **Layer 2 (`colab-sync`) sits alongside Layer 1
(the existing colab JS stack), which keeps working untouched.** This
is incremental layering, not big-bang rewrite. A project becomes
"colab-sync managed" the first time the Rust core writes a `.alsync`
file in its directory; until then, it uses the legacy AlsReplicator
path.

## Dev hygiene: AbletonBridge env-var port patch

If you're using AbletonBridge as the runtime overlay (currently the
case until Phase 3+ when `colab-bridge-osc` lands), the bridge's
hard-coded port 9877 collides when you try to run two Live instances
on this machine. The patch lives at:

> **`scripts/patch-abletonbridge.py`** (in this repo)

Idempotent. Run `python scripts/patch-abletonbridge.py --check --all`
to see the state of every known install on this machine, or
`python scripts/patch-abletonbridge.py --all` to apply. After
patching, launch the second Live with
`set ABLETON_BRIDGE_PORT=9878 && "Ableton Live 12 Suite.exe" "test 2.als"`.

This is a temporary scaffold — it goes away in v1 if Phase 3 pivots
to AbletonOSC as the primary runtime observer. Until then it's the
fastest way to make a fresh machine reproducible.

## Friend-First KPIs

Success is measured against four numeric KPIs and four anti-metrics:

| KPI | Target |
|---|---|
| Time to first jam | < 60 s |
| Time to merged save | < 2 s LAN |
| Ableton restarts forced | 0 |
| XML round-trips losing data | 0 |

**Anti-metrics** (we are explicitly NOT optimizing for):
feature count, user count, cloud uptime, telemetry coverage.

The full rationale lives in `~/tasks/alsync-architecture.md`
§ Friend-First KPIs and Anti-Metrics.

## What gets built here, eventually

When Phase 0 passes (and after spec reconciliation at step 06):

| File | Purpose |
|---|---|
| `rust-bridge.js` | Bidirectional UDP socket pair to `colab-bridge-m4l`. Sends commands ("export current state", "apply this op batch"). Receives notifications ("peer saved", "merge applied", "destructive op rejected, retry needed"). Wire format = same JSON-over-UDP convention the existing CoLaB hub uses on UDP 8001. |

That is the **only file** that will live in this directory. Everything
else is in the Rust workspace at `~/colab/colab-sync/`.

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

The parallel research session surfaced multiple traps that have to
be designed against from the first commit, not debugged after the
fact. Each one alone is enough to stall the build for days; together
they're a hard "do not start coding yet" signal.

**4 CFAPI gotchas** (Microsoft Q&A threads):
1. NTFS-compressed files break TRANSFER_DATA
2. FETCH_DATA cannot alter file size mid-flight
3. FETCH_PLACEHOLDERS fires repeatedly on directory enumeration
4. VALIDATE_DATA semantics partially undocumented

**1 CVE**: CVE-2025-55680 in cldflt.sys is a TOCTOU privilege
escalation. Treat CFAPI callback parameters as semi-untrusted. Validate
every length, every offset, every path before acting on it.

**Two-protocol layering rule**: Loro ops on reliable TCP =
canonical truth; AbletonOSC observer events on unreliable UDP =
hint, not truth. Mix them and the Loro doc tree desyncs within
minutes. No recovery without a full snapshot restore.

**VST blob noise**: VST plugin data churns in the .als XML on every
save even when nothing meaningful changed. The differ MUST hash VST
blobs and only emit Loro ops on hash change. Without this rule, the
Loro doc fills with garbage and "time to merged save < 2 s LAN" is
unreachable. Citation: [mark_henry's Ableton Live + Git experiment](https://medium.com/@mark_henry/ableton-live-git-a-match-made-in-someplace-or-the-great-ableton-git-experiment-5a20dfe2734c).

**CloudMirror clean-state hazard**: per the [microsoft/Windows-classic-samples CloudMirror sample README](https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/CloudMirror),
"if you hydrated some files while testing and then shut down the
sample, you should delete everything from the sync root folder
before re-running." Every CFAPI integration test must start with a
clean sync root. Stale placeholders cause silent corruption that's
hard to debug.

**12-item risk register**: the parallel research session ranks
"Live rejecting the projected `.als`" as Risk #1 — the only true
blocker for the architecture. Phase 0 resolves Risk #1, pass or fail.

That's why we wait for the spec to reconcile at step 06 (formal
synthesis step in the parallel research workflow) and Phase 0 to
pass before any code lands. Both gates exist for a reason.

## Next concrete action

1. Parallel research session runs Phase 0 (CloudMirror + Live 12.x
   .als round-trip experiment)
2. Result reconciled with `~/tasks/alsync-architecture.md` at step 06
   synthesis (per `step-06-research-synthesis.md` in the technical
   steps folder)
3. `cd ~/colab && cargo new --lib colab-sync && cd colab-sync` —
   set up the workspace + 8 crates
4. Phase 1 starts: `colab-core` + `colab-cas` as a passive observer
5. Phase 2 lands `colab-cfapi`, gives the first friend-visible win
6. This directory gets `rust-bridge.js` during Phase 3 to wire the
   JS side

Until then, this README is the only file here.
