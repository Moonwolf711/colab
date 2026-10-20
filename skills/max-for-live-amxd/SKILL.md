---
name: max-for-live-amxd
description: "Build, edit, package, and validate native Ableton Max for Live .amxd devices, including Live-style controls, Max JavaScript, external SDK bridges, and Max/Ableton MCP workflows. Use for M4L device work rather than general music arrangement."
---

# Max for Live AMXD devices

Deliver an actual loadable Max for Live device with its required dependencies.
Preserve the user's requested engine, device category, and interaction model.
Use the existing project architecture; a hardware or desktop SDK controller is
not interchangeable with a simulated input engine.

## Establish the target

- Read the nearest project instructions and current builder. Identify MIDI
  effect, audio effect, or instrument; Live/Max versions; OS; and whether delivery
  is one frozen file or an explicitly documented package folder.
- Inspect an installed stock device of the same category. A `.maxpat` is JSON;
  renaming JSON to `.amxd` does not create a device.
- For new code targeting Max 9, prefer `v8` for Max logic/LiveAPI and `v8ui` for
  custom drawing. Preserve an older supported runtime when compatibility
  requires it. Use `node.script` for filesystem, network, or process integration;
  communicate with the Max host for LiveAPI calls.
- Write the project plan and verify observable acceptance criteria before
  implementation. When useful, split patch/UI, bridge/protocol, and packaging
  into independent agent tasks with separate file ownership.

## Native Live behavior and style

Build a compact presentation panel with clear labels, related controls grouped
together, readable value/status text, and restrained colors. Prefer native
`live.*` controls for interaction; use `v8ui` when custom drawing adds value.
Keep state distinguishable without relying on color alone.
Load a `v8ui` script through its filename/textfile fields. Do not also assign
that same stateful script as `jspainterfile`: its separate painter context can
draw initial values while messages update a different script instance.

Set `openinpresentation`, explicit `presentation_rect` values, and an intentional
device width. Design within Live's 169-pixel device height and check the actual
rendering at the user's display scale. See the
[official UI guidance](https://docs.cycling74.com/userguide/m4l/live_userinterfaces/).

For musical parameters, define stable names, ranges, units, initial values, and
the intended automation/preset behavior. Keep one-shot commands such as Connect,
Launch, or Change Desktop Mode out of saved parameter replay unless explicitly
requested. Display pending commands separately from confirmed external state.

## Lifecycle and signal path

- Initialize LiveAPI inside an initialization function reached through
  `live.thisdevice`, with deferred scheduling where needed. Never construct
  LiveAPI in global code. Initialization must tolerate repeat bangs on save or
  preset reload without duplicate observers, timers, or child processes.
  [LiveAPI reference](https://docs.cycling74.com/apiref/js/liveapi/),
  [live.thisdevice reference](https://docs.cycling74.com/reference/live.thisdevice/).
- Resolve current object IDs and check validity before calls. Do not persist
  Live object IDs across sessions. Route observer updates without write-back
  feedback loops.
- Preserve the appropriate MIDI/audio path for the chosen device. A control-only
  MIDI effect normally needs `midiin` to `midiout`; an audio effect needs its
  intended `plugin~`/`plugout~` routing. Test note-off and bypass behavior.
- Stop owned timers, subscriptions, and helper processes when the device is
  removed. Keep blocking work outside Live's timing-sensitive paths.
- For external engines, handle disconnected, connecting, ready, pending, error,
  and expired states. A socket connection alone does not establish SDK readiness.
  A failed request must not appear as a successful mode change.

## MCP-assisted work

Read [references/mcp-tools.md](references/mcp-tools.md) before using Max/Ableton
MCPs. Discover the available tools and schemas for the current session first.
Use patch inspection before editing and Live read tools before validating a
loaded device. The metadata declares integration targets; it does not start,
install, or prove a connection to either server.

MCP availability is optional for offline authoring. If discovery or desktop
automation fails, finish source, package, and mock tests and state the precise
Live-validation gap. Do not repeatedly restart unrelated apps or replace the
user's active Live Set to obtain a screenshot. Use the existing authorized
test set, or establish a safe test context before changing sets.

## Packaging and proof

Read [references/amxd-packaging.md](references/amxd-packaging.md) for the
template-based helper, dependency handling, and staged checks. Keep source
patchers and executable logic separate from generated packages. Validate the
container and patch graph, then test behavior and finally load the installed
package in Live. A passing JSON, bridge, or SDK test does not prove an in-Live
panel or signal-path test.

For MouseMux specifically, also read
[references/mousemux-bridge.md](references/mousemux-bridge.md). Its ports,
mode flags, and vendor-runtime requirements are not generic M4L requirements.

Deliver the device/package path, supported runtime, dependency list, and exact
verification results. State any untested hardware behavior. Follow the owning
repository's commit/push workflow. For desktop devices, deployment means the
configured Live User Library or agreed artifact destination; run web deployment
or database migrations only if that project actually has them.
