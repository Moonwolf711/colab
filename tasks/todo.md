# CoLaB Consolidation — Target (b): Single Self-Contained M4L Device

## MouseMux integration — 2026-10-19

Assumption pending user clarification: add independent MouseMux user input to CoLaB's existing multi-cursor path. Preserve the consolidation work below and unrelated workspace changes.

- [ ] Run the installed REA tooling against the nine supplied 3.0.19 x86 DLLs; record hashes, public interfaces, and evidence-backed limitations.
- [x] Verify the V3 input contract and select the smallest compatible integration with CoLaB's existing mouse pipeline.
- [x] Implement original integration code and usage documentation; keep vendor binaries and raw decompilation outside the repository.
- [x] Verify input identity, motion/buttons/wheels, disconnect cleanup, and existing consumer behavior with appropriate builds/tests and a local smoke check.
- [ ] Commit only this task's files, push to origin/master, and verify the applicable deployment or local installation status.

Success: a reproducible MouseMux-to-CoLaB input path, tested without disturbing an active Ableton session, with exact instructions and explicit live-test limitations.

Verification: 43 tests pass on the current Node runtime and Node 18; a clean detached checkout passes `npm ci --ignore-scripts` and all 43 tests. Panel inline JavaScript parses. A local 100,000-event motion benchmark averaged 1.86 microseconds/event for decoded input through the adapter and Jam core (network, rendering, and Ableton excluded). Physical-input validation remains pending: MouseMux's Web SDK is disabled/not listening on 41001, and panel calibration requires the actual canvas screen rectangle. No schema changes or Railway runtime apply to this Windows desktop feature.

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
