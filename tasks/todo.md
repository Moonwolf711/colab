# CoLaB Consolidation — Target (b): Single Self-Contained M4L Device

## Independent native Live interaction — strict acceptance, 2026-10-20

Both physical cursors must independently right-click, select, edit, highlight,
and click simultaneously in the same Ableton Live instance. Neither may dismiss
the other's menu, steal its selection/focus, or interrupt its gesture. Every
condition is required; a connected SDK or two visible cursors is not completion.

- [x] Record the exact requirement and a physical same-window context-menu test.
- [x] Verify available MouseMux and Live mechanisms against native per-user interaction state.
- [x] Inspect the Live 12.4.5 Beta Extensions SDK and the user's runtime-menu lead.
- [x] Observe native popup creation, window ownership, and lifetime in Live.
- [x] Run a bounded exact-build menu diagnostic and record its actual coverage.
- [ ] Verify native command-target binding and a safe per-user lifetime/control integration point.
- [ ] Implement a mechanism that satisfies the entire requirement, if available.
- [ ] Pass concurrent context menus, selections, edits, highlighting, clicks, and held gestures in both user directions.
- [ ] Deliver the verified behavior without weakening any acceptance condition.

Ground truth: the user tested Navy opening a track-header context menu followed
by Purple right-clicking another track header in the same Live window. Result:
**one menu closes or takes over**. The current device therefore FAILS this
requirement. Previous controller/package delivery is not acceptance of native
Live interaction isolation. No replacement UI, serialized input, or separate
Live instances count as satisfying this task.

Investigation: the vendor documents Multiplex ownership per program/window;
installed keyboard focus and output options do not create independent native
Live selections or menus. Live's `Song.View` and `Application.View` expose shared
selection/focus with no per-user native interaction context. No supported
mechanism satisfying the complete requirement was found. Implementation and
acceptance remain incomplete; the failure is documented prominently in the
device README. Do not label the current controller a solution to this feature.

Runtime investigation reopened after the user's menu-instancing reference:
absence of a per-user Live Object Model API does not rule out native runtime
integration. Installed Suite is 12.3.8; installed Beta is 12.4.5b5 and qualifies
for Ableton's newer Extensions SDK. Verify that SDK and the observed native
popup lifecycle before concluding what can be instantiated independently.
Separate menu instances must preserve user identity, target object, command
dispatch, selection, focus, and held input; separate windows alone are not proof.
The read-only 60-second capture observed distinct Live-owned popup HWNDs on the
same UI thread, with earlier popups hidden or destroyed. The local SDK example
proves captured-target handles; it does not expose popup cloning. Findings and
remaining native-runtime proof are in `multimouse/m4l-mousemux/RUNTIME-MENUS.md`.
The 60-second instrumented diagnostic loaded and detached cleanly but observed
zero entries to the three candidate functions; physical actions during that
interval were not confirmed. This does not validate a native hook or per-user
ownership. Live remained responsive on the same stopped disposable set.
The investigation notes are included in the package and installed User Library.
All 79 installed files match the rebuilt package; only the README, investigation
notes, and checksum manifest changed there. Eight device tests and the package
build/AMXD validation pass. These checks do not change the failed acceptance.

## Reusable Max for Live agent skill — 2026-10-20

Deliver an installed `max-for-live-amxd` skill plus a versioned copy under
`skills/`. Include source-verified AMXD packaging, native device UI and lifecycle
guidance, MCP discovery/setup references, and the MouseMux SDK bridge lessons.
Skill installation is the deployment; no database migration or Railway service
applies. Preserve the separate device implementation work already in progress.

- [x] Inspect local project instructions, builders, MCP servers, and official Max documentation.
- [x] Write the skill, MCP metadata/references, and a template-based AMXD helper.
- [x] Validate the skill and helper; independently exercise realistic task routing.
- [x] Install under the active Codex skills directory and verify copied files.
- [x] Commit the skill's scoped changes, push origin/master, and verify remote delivery.

Verification: skill validator, MCP metadata, and reference links pass; all 13
helper tests and 43 existing repository tests pass. All three installed stock
AMXD categories pass inspection. An independent agent used the skill to build
and inspect a fresh MIDI pass-through package in a temporary directory.
This proves offline authoring, not Live loading or physical MIDI behavior.

Delivery: eight files installed and hash-verified at
`C:\Users\Owner\.codex\skills\max-for-live-amxd`. Skill implementation commit
`f8654fe` is on origin/master; Node 18/20/22 CI run `39385704832` passed.
MaxMSP and Producer Pal integration metadata and setup guidance are included;
active MCP connections remain unverified. No runtime/configuration changes or
database migrations were required for this skill installation.

## Native MouseMux Max for Live device — 2026-10-20

Deliver a Max 9 / Live 12.2+ MIDI-effect `.amxd` that controls the installed
MouseMux engine through its actual SDK. A Rust executable supplies the local
SDK connection; Max `v8` initializes LiveAPI only after `live.thisdevice`.
Independent pointers across Live remain MouseMux's native behavior, subject to
the installed edition and application compatibility. No synthetic cursor engine.

- [x] Confirm user intent, installed SDK mode setter, supported native runtime, and stock AMXD format.
- [x] Implement Rust SDK bridge with authenticated readiness, observed modes/users, expiry and disconnect handling.
- [x] Build native Max controls, lifecycle manager, v8 LiveAPI initialization, and valid AMXD package.
- [x] Test bridge/protocol/lifecycle, build Windows release, and validate device in a disposable Live set.
- [x] Install complete device package into the configured Live User Library; record physical-test limits.
- [x] Commit only scoped changes, push origin/master, and verify CI/local deployment status.

Resumed using `max-for-live-amxd`: review the existing bridge and native panel
in parallel; repair verified mode-confirmation, button-routing, and packaging
issues; build and install a complete package in the configured User Library.
Check readback and rendering in a disposable Live session if the available
application controls permit it. Record physical two-mouse tests separately.

Verification: 13 Rust protocol tests, Clippy with warnings denied, 16 Node
manager/panel tests, 8 Python device tests, 13 shared AMXD helper tests, and 43
existing repository tests pass. The packaged manager also loads beneath an
ES-module ancestor using Live's bundled Node 20.6.1.

Deployment: complete package installed and hash-verified in
`X:\Ableton\User Library\Presets\MIDI Effects\Max MIDI Effect\CoLaB MouseMux`.
Live 12.3.8 / Max 9.0.10 recognizes the installed AMXD as a MIDI effect, renders
all seven controls, resolves the host track, and starts the current Node manager
without load errors. Removal/reload leaves only the current manager; loading
starts no Rust bridge and sends no mode change. Readback, log segment, screenshot,
and the disposable set remain under the ignored `validation/` directory.

Host fixes: backed up and removed the conflicting Max 9.1.4 installation-root
search path from the shared Max 9 settings; corrected duplicate panel painter
state; packaged a local CommonJS boundary for the actual User Library location.
Physical two-mouse interaction, MIDI playback, and Live Set save/reopen remain
unverified. The final host check found no Web SDK listener on port 41001.

Delivery: implementation commit `4fa619d` is on origin/master. Windows package
CI run `39393614682` passed all checks and uploaded the ZIP; Node 18/20/22 CI run
`39393614262` passed. The final installed package contains 78 hash-verified files.
The release executable reports an unavailable SDK clearly and exits with code 0
on stop/EOF; this smoke check sent no mode commands. The reusable skill's updated
packaging/runtime lessons are installed and hash-verified too.

Work lives in `multimouse/m4l-mousemux/`. Vendor runtime remains user-installed;
do not redistribute vendor binaries, license data, or decompiled source.
This desktop feature has no Railway service or database migration.

## MouseMux integration — 2026-10-19

Scope: add independent MouseMux user input to CoLaB's existing multi-cursor path, including the pointer features consumed by its Jam interface. Preserve the consolidation work below and unrelated workspace changes. Keyboard forwarding, screen sharing, and native desktop virtualization remain MouseMux capabilities rather than implemented CoLaB Jam features.

- [x] Run the installed REA tooling against the nine supplied 3.0.19 x86 DLLs; record hashes, public interfaces, and evidence-backed limitations.
- [x] Verify the V3 input contract and select the smallest compatible integration with CoLaB's existing mouse pipeline.
- [x] Implement original integration code and usage documentation; keep vendor binaries and raw decompilation outside the repository.
- [x] Verify input identity, motion/buttons/wheels, disconnect cleanup, and existing consumer behavior with appropriate builds/tests and a local smoke check.
- [x] Commit only this task's files, push to origin/master, and verify the applicable deployment or local installation status.

Success: a reproducible MouseMux-to-CoLaB input path, tested without disturbing an active Ableton session, with exact instructions and explicit live-test limitations.

Verification: 43 tests pass on the current Node runtime and Node 18; a clean detached checkout passes `npm ci --ignore-scripts` and all 43 tests. Panel inline JavaScript parses. A local 100,000-event motion benchmark averaged 1.86 microseconds/event for decoded input through the adapter and Jam core (network, rendering, and Ableton excluded). Physical-input validation remains pending: MouseMux's Web SDK is disabled/not listening on 41001, and panel calibration requires the actual canvas screen rectangle. No schema changes or Railway runtime apply to this Windows desktop feature.

Delivery: implementation commits pushed to origin/master; GitHub Actions run 39312135001 passed on Node 18/20/22. Local demo at `http://127.0.0.1:9460` returns a 24-track simulated set, MouseMux disconnected/ECONNREFUSED, and input disabled. Its sample rectangle must be calibrated before live use. Brave UI verification could not run because CDP was unavailable; IP Helper was stopped according to the workspace browser instructions and Brave requires relaunch from its debug shortcut.

REA final coverage: all nine overviews succeeded with zero main-batch tool errors; 31/31 selected exported-function requests succeeded, in 627.87 seconds. Raw results remain outside the repository; see `docs/mousemux-analysis.md` for hashes, counts, exact evidence boundaries, and the separate focus pass's two unsuccessful exploratory internal-address lookups.

**Goal:** One `.amxd` a collaborator drops on a track → opens the `.als` → plays. **Zero install** (no Node.js, no AbletonBridge Remote Script, no AbletonOSC, no web-bridge). North star: *easy for a friend to join and play* > technical completeness.

## Decision (from architecture map, 2026-06-24)
- **Base = `colab-sync-v8.js` (v8.1)** — already self-contained (LiveAPI + UDP `[js]`), **dynamic** (discovers tracks/devices on ANY Set), and solves the LiveAPI null-callback stall via `.id == 0` guards + avoiding `arm`/`fold_state`/`is_foldable` (uncatchable spam on group/return tracks).
- **Reference for richer coverage = `colab_livesync.js` (v7)** — has master params, clips (create/delete), notes — but **hardcoded** to Tyler's Set (`DEVICE_MAP`, `GROUP_TRACKS`). Port its *logic* dynamically; do NOT inherit its hardcoding.
- **Transport:** UDP `[udpsend]/[udpreceive 8001]` only (legacy `[js]` has no TCP). Patcher topology = `CoLanew.maxpat` (swap JS filename).
- **Hard constraint:** structural ops (clip create/delete, notes) are **non-idempotent** → UDP loss = permanent divergence. Param deltas self-heal (re-polled). Reliability layer needed only for structural ops.

## Staged build (verify each before the next — do NOT build on an untested base)

### Step A — Build + locally smoke-test the v8.1 base device  ← START HERE
- [ ] Build a clean `.amxd` (ampf binary) wrapping `colab-sync-v8.js` using the `CoLanew.maxpat` topology (metro 100 → poll, udpsend/udpreceive 8001, live.thisdevice → init).
- [ ] Load on a track in **this** machine's Live 12 Beta. Verify: inits after 3s, discovers tracks+devices, polls with **zero Max-console spam**, no scheduler stall.
- [ ] Loopback self-test: confirm it emits deltas on a fader move (watch udpsend) without echo storm.

### Step B — Two-machine flawless core (needs TheHAVEN online)
- [ ] Deploy device + JS to TheHAVEN (`4382@192.168.0.83`), same `.als` both ends.
- [ ] Verify both directions, flawless, no echo loop, no spam: **volume, pan, mute, solo, color, name, device params, tempo.**
- [ ] Measure: latency to peer-follow, drift over 5 min, behavior on a track/device the peer lacks.

### Step C — Consolidate up to v9 (dynamic port of v7 features)
- [ ] Add **master device params** (dynamic discovery).
- [ ] Add **clips**: create / delete / note-sync (dynamic clip-slot scan) — from v7 logic, dynamic.
- [ ] **Reliability layer for structural ops only:** sequence number + peer ACK + retransmit-on-timeout, plus a periodic clip-state reconcile (occupancy + note-hash) to self-heal any dropped structural delta. Keep it minimal — no full CRDT.
- [ ] Re-run Step B verification + structural-op stress (rapid clip create/delete/edit).

### Deferred (not "core jam"; add only if asked)
- arm / fold sync (need a spam-free foldable-track detection — `is_foldable` is banned)
- routing / returns / crossfader / scenes / warp markers / clip props (A's extra ~1,387 coverage)
- PCM audio streaming, .als file/asset/git sync, cursor overlay, control-panel UI polish

## Cleanup / hygiene
- [x] Removed 40 zero-byte shell-accident junk files.
- [ ] Commit a deliberate known-good base (CoLaB consolidation files), grouped by concern; leave unrelated WIP (Skallywag, FightingEdge) alone.

## Test gate for "flawless"
Two machines, same Set, a real jam session: faders/knobs/tempo/clips track both ways with no audible lag, no echo oscillation, no console spam, no divergence after 10 min. A friend with stock Ableton + the single device joins with zero other installs.
