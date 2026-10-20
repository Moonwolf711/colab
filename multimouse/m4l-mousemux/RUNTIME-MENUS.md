# Native menu isolation investigation

The acceptance requirement remains two physical users independently using
native Live menus, selections, highlights, edits, clicks, and held gestures in
one Live instance. The current device fails: the user's second right-click
closed or took over the first user's menu.

## Verified references

- Installed release: Live Suite 12.3.8, bundled Max 9.0.10.
- Installed beta: Live 12.4.5b5, bundled Max 9.1.4; not launched during this
  investigation.
- The local Ableton Extensions SDK 1.0.0-beta.0 was inspected directly from its
  readable archive. Its context-menu action callback receives a target handle
  or selection context. The modal-dialog example captures its clip before
  awaiting a dialog and later edits that captured clip. This establishes a
  useful target-binding pattern, not concurrent native popup ownership.
- The complete exposed SDK UI interface registers menu actions and opens modal
  webviews or progress dialogs. No native-menu clone/constructor or per-pointer
  interaction-context API was found. Native host implementation is not supplied
  as SDK source. [Ableton Extensions](https://www.ableton.com/en/live/extensions/)
- MouseMux's Chromium reference filters menu dismissal by a hardware/user ID.
  At the inspected revision its comments still describe one active menu per
  process. That implementation does not itself pass the two-open-menu
  requirement. [Author source, revision b255c2c](https://github.com/MouseMux/Chrome/blob/b255c2c5cc361d61280ed30abc63aeecc1e61894/src/chrome/browser/ui/views/mouse_mux/mouse_mux_control_dialog.cc#L747-L783)

## Observed Live popup lifecycle

A 60-second read-only observer sampled the existing validation Live process
every 100 ms while the user operated menus. It sent no input or window messages.
Raw observations remain in ignored `validation/live-menu-passive-observation.jsonl`.

- Multiple distinct popup window handles appeared sequentially.
- Their class was `Ableton Live Window Class`, with the main Live window as
  owner/parent and the same UI thread as the main window.
- Those popups had no `HMENU`; the main menu bar did have one.
- One earlier popup became invisible while its handle still existed. Later
  popup handles were destroyed and replaced.
- Main-window capture remained reported during the sequence. Only one popup
  was visible in the recorded states.

This proves observed lifecycle behavior, not the identity of the internal
function causing cancellation. It does not correlate each OS event with a
MouseMux hardware ID, inspect a menu's command target, or exclude events shorter
than the polling interval. An external thread-state read also does not establish
everything MouseMux may virtualize inside the application.

## Internal runtime lead

Read-only PE/RTTI inspection identifies `AContextMenu`, `AContextMenuHandler`,
and `LContextMenu`; the latter derives from `AContextMenu` and `IPopUpContext`.
These are internal types, not exported constructor or clone APIs.

Bounded static analysis found a notifying weak menu reference inside
`AContextMenuHandler`, an invoking-view field, and registration/clearing
callbacks. A separate `LContextMenu` method closes and replaces a retained
child menu; its `IPopUpContext` vtable placement suggests submenu handling.
This is not proof of a global singleton or a safe integration point.
These implementation details are specific to the inspected Suite executable,
not a stable API or a verified layout for Beta.

The executable's normal/delay imports do not expose `TrackPopupMenu`,
`TrackPopupMenuEx`, `CreatePopupMenu`, or `EndMenu`. That does not exclude an
indirect call or another module, but a generic Win32 popup clone is not an
established implementation route for these observed menus.

`GetContextMenuEntryCount`, `GetContextMenuEntryText`, and `OnContextMenuEntry`
also occur in Max's `patcher.dll` beside Live integration callbacks. Their
scope and signatures are not verified as an application-wide menu interface.
Do not call guessed addresses or infer that names alone establish an API.

## Bounded diagnostic trace

A 60-second Frida diagnostic attached to the exact Suite 12.3.8 executable in
the stopped, non-recording disposable validation set. SHA-256, version,
architecture, process path, set path, and candidate entry bytes were checked.
It instrumented entry to three registration/clearing candidates, without
changing their arguments or returns or calling private functions. This was
temporary instrumentation, not a passive observation.

The trace recorded **zero candidate entries**. No confirmation of physical
test actions during that interval had been received when this result was
recorded. Thus neither function coverage nor per-user ownership was validated.
The time limit fired; script unload and session detach both succeeded without
a reported crash. Live remained responsive on the same stopped validation set.
The local trace and diagnostic scripts remain in ignored `validation/`.

## Required implementation proof

Independent instancing must retain each user's menu lifetime, target object,
selection, focus/capture, pressed-button state, dismissal, and command dispatch.
Creating two windows is only one part of that. A native adapter must prove the
binding and teardown path before it is applied to the user's working set.

The newer SDK and native runtime leads remain distinct from the earlier public
Live Object Model limitation. Neither an absent public API nor the observed
single-menu behavior proves that native runtime integration is impossible.
No native lifetime/control hook has yet been validated, and the acceptance
requirement is still unmet.

Physical input identity is another required integration boundary. MouseMux SDK
events carry hardware/user identity, but event timing alone cannot identify
which user caused an arbitrary Live callback. The two MouseMux modules exposed
by standard loaded-module enumeration in the validation process had no named
current-user or current-HWID getter among their exports. That check does not
cover internal or manually mapped code, and export names alone would not
establish a callable interface.
