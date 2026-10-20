# MouseMux SDK bridge example

Use this reference only for the MouseMux device or a closely related external
SDK controller. The reusable lesson is confirmed state and owned lifecycle;
the mode values and transport details below belong to MouseMux.

Source in Owner's workspace:
`C:\Users\Owner\colab\multimouse\m4l-mousemux`.
Read `PROTOCOL.md`, `README.md`, and current source before changes; the package
was still undergoing host validation when this skill was created.

## Preserve the requested engine and external state

- Use the installed MouseMux runtime through its SDK. The Rust bridge adapts
  that SDK; it does not replace MouseMux with synthetic cursor events.
- Loading, connecting, or removing the device must leave the desktop mode
  unchanged. Only an explicit mode command requests a change.
- Wait for an observed mode before changing it. Preserve observed multi-keyboard
  state: current protocol maps switched/multiplex to `4`/`6` with multi-keyboard
  set, versus `0`/`2` without it. Verify these mappings against current SDK/source.
- Display the mode reported by the engine; a button click means pending until
  an engine event confirms it. Show login failure, expiry, disconnect, and stale
  status clearly. Do not replay a pending change after reconnect.
- Independent interaction with two physical mice is a separate test from SDK
  connectivity and may depend on vendor edition/application compatibility.

## Runtime responsibilities

`v8` hosts LiveAPI; `v8ui` draws the status panel; `node.script` manages the Rust
child; Rust talks to the installed SDK. The currently documented SDK endpoint is
loopback port `41001`, not a generic Max or Ableton port.

The manager needs a single owned child, hidden Windows launch, bounded message
framing, validation of incoming events, and stale-child event suppression.
Shutdown should request stop, close stdin, then terminate only its own child
after a bounded grace period. Do not kill all Node/MouseMux processes.

The debug panel's `node.debug.maxpat` is supplied by the package; do not assume a
built-in `node.debug` external. Any inspector should remain off by default and
bind only to loopback when explicitly enabled.

## Existing offline checks

Run in `multimouse/m4l-mousemux`:

```powershell
cargo fmt --manifest-path bridge/Cargo.toml -- --check
cargo test --manifest-path bridge/Cargo.toml --locked
cargo clippy --manifest-path bridge/Cargo.toml --all-targets --locked -- -D warnings
node --test test/manager.test.js
pwsh -File scripts/build-package.ps1
```

Protocol tests cover authentication, observed modes, fragmentation, expiry, and
disconnect. Manager tests cover inert loading, process deduplication, chunked
events, confirmed-versus-requested state, shutdown, and launch behavior.

The current package is unfrozen and requires adjacent files. Do not distribute
vendor binaries, credentials, or decompiled source. Install the complete package
to the configured Live User Library, then verify the loaded panel, MIDI path,
save/reload lifecycle, and two actual mice. Until those checks run, report only
the package/SDK checks that passed.
