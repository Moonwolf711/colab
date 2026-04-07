# js/alsync — stub directory

This directory is **intentionally empty of source code**.

It is the landing zone for the upcoming `.alsync` CRDT-based persistence
layer that will replace `js/hub/als-replicator.js` over the v0 → v0.5 → v1
migration path. Implementation is **gated** on a foundational experiment
that has not yet been run (see § Status below).

## Why empty?

The full architecture spec lives at:

> **`~/tasks/alsync-architecture.md`** (outside this repo)

It defines the file format (`[64-byte header][Loro deltas][optional snapshot]`),
the Loro doc tree mapping for the MVP element list (mixer / transport /
tracks / clips / notes / devices / scenes / cues), the BLAKE3 sample CAS,
the migration path, and the unblock gate.

A second, formal architecture + implementation spec is being produced in
parallel by another research session. Step 6 of that flow is the
synthesis point where the two specs reconcile and the canonical version
emerges. Until that happens, **no production code** is committed here —
not a parser, not a materializer, not a Loro wrapper, not a stub class.
The directory exists so the implementation session can drop into it
without resolving merge conflicts against speculative scaffolding.

## Status

**BLOCKED on the unblock gate.**

The unblock gate is the **CFAPI + Live 12.x XML round-trip experiment**
(documented in `~/tasks/alsync-architecture.md` § Unblock Gate). In
short: prove that we can parse a real Live 12.x `.als` file with the
chosen XML library, re-emit it, gzip it back, open it in Live, and
have Live accept it with zero data loss and zero error dialogs. This
is a 5-minute wall-clock experiment — but until it passes, every line
of `.alsync` code is built against an unverified assumption.

## What gets built here, eventually

When the gate passes (and after spec reconciliation at step 6):

| File | Purpose |
|---|---|
| `sample-cas.js` | BLAKE3 hash + read/write blobs under `samples/b3:<hex>.<ext>` |
| `alsync-file.js` | 64-byte header reader/writer + length-prefixed body batches |
| `loro-doc.js` | Wrapper around `loro-crdt`'s `LoroDoc` exposing the typed element paths |
| `xml-to-loro.js` | Parse a `.als` XML tree → produce Loro container updates |
| `loro-to-xml.js` | Walk a Loro doc → emit `.als`-compatible XML → gzip |
| `alsync-replicator.js` | Drop-in replacement for `js/hub/als-replicator.js`, ships Loro op deltas instead of full bytes — idempotent merge, no echo guards needed |

Each of these is a green-field module with minimal coupling, so multiple
sessions can build them in parallel once unblocked.

## What does NOT change

Roughly half the colab JS we shipped this session slots into the alsync
world unchanged. From the spec § Existing Colab Code That Stays:

- `js/hub/tcp-stack.js` — Loro deltas are just bytes on `CH.DATA`
- `js/hub/als-git.js` — the `_onRawSave` hook (commit `54f314b`) is
  exactly where Loro op generation will hang
- `js/hub/als-differ.js` — becomes the *input* to the Loro op generator,
  not a replacement
- `js/hub/m4l-notifier.js` — same UDP 8001 dispatch
- `colab_livesync.js` `applyDelta` 'nf' case — same notification UX
- `js/hub/colab-engine.js` — extended to register `AlsyncReplicator`
  alongside `AlsReplicator`
- `js/hub/param-sync.js` runtime overlay — orthogonal to the persistence
  layer; remains for in-session low-latency sync

## Next concrete action

1. Other session runs the CFAPI + Live 12.x round-trip experiment
2. Result reconciled with this spec at step 6
3. `npm install --save loro-crdt @noble/hashes` (only after above)
4. Implementation begins in this directory

Until then, this README is the only file here.
