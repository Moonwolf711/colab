# Lessons

## IP & Dependency Decisions

- 2026-10-19, MouseMux: keep CoLaB's user-to-cursor mapping and gesture integration original. Reuse the repository's existing MIT-licensed `ws` transport for the documented protocol. Do not copy vendor SDK/decompiled implementation or link undocumented internal x86 hooks into the x64 application. Match raw wire messages against the installed build because SDK callback fields may be synthesized by its JavaScript wrapper.

## User corrections

- 2026-10-20, native menu runtime lead: distinguish the public Live Object Model from newer Extensions SDK and native runtime mechanisms. Missing per-user LOM properties establish that API's limit, not general impossibility. Inspect the user's cited menu-spawning approach and actual Beta version. Likewise, adding a menu item or duplicating a popup does not prove independent command targets, selection, capture, or focus.

- 2026-10-20, strict MouseMux acceptance: the required outcome is simultaneous independent native Ableton interaction, including two right-click menus, selections, highlighting, editing, clicks, and held gestures in one instance. SDK authentication, two cursors, and mode readback do not establish this. The user's physical test failed because one menu closed or took over. Keep the feature explicitly incomplete; never substitute a controller, custom editor, sequential input, or separate Live instances for this requirement.

- 2026-10-20, M4L host validation: passing package and SDK tests did not catch `live.text` button bangs being swallowed by `sel 1`, a duplicated `v8ui` painter drawing stale state, or Max resolving a newer `node.script` through a global installation-root search path. Load the actual AMXD in Live, inspect its panel and log, and compare native external imports to the running Max runtime before changing application code.

- 2026-10-20, Node for Max packaging: test the installed folder's module scope. A parent `package.json` on another drive can change a CommonJS `.js` manager into an ES module. Ship a local `package.json` declaring the intended module format, and exercise the package under a conflicting ancestor with Live's bundled Node version.

- 2026-10-20, MouseMux M4L: the user wants the actual MouseMux two-mouse engine and installed SDK/library, controlled from a native Ableton Max for Live device. Do not substitute a custom cursor emulator, a mapped-parameter panel, or claim serialized synthetic input is the requested engine. Use Max 9 `v8` for LiveAPI and initialize only after `live.thisdevice`. Preserve the requested Rust component as an SDK bridge, not a reimplementation of proprietary internals.
