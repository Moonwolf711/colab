# CoLaB MouseMux for Live

A native Max for Live MIDI effect that controls the **installed MouseMux
engine**. An original Rust bridge connects the device to MouseMux's local SDK
for mode control and status. Native application interaction remains implemented
by MouseMux and the target application.

**The current device fails the requirement for fully independent simultaneous
interaction inside one native Ableton Live instance.** In the physical test,
Navy opened a track-header context menu and Purple right-clicked another track
header in the same window; one menu closed or took over. This is an acceptance
failure, despite successful SDK authentication and Multiplex mode readback.

The required result includes independent native context menus, selections,
highlighting, editing, clicks, and held gestures with no interference. MouseMux
documents window/program ownership; Live's supported API exposes shared
selection and focus, without per-user native menu/selection contexts. No
supported setting or M4L API that supplies the missing isolation was found.
See the [MouseMux manual](https://www.mousemux.com/pages/manual/),
[Song.View](https://docs.cycling74.com/apiref/lom/song_view/), and
[Application.View](https://docs.cycling74.com/apiref/lom/application_view/).
The independent-interaction feature remains incomplete.

The device uses Max 9 `v8` for Live integration, initialized by
`live.thisdevice`, and `node.script` to manage the Rust process. MIDI passes
directly from `midiin` to `midiout`.

## Requirements

- Windows x64.
- Ableton Live 12.2 or later with Max for Live and Max 9.
- MouseMux V3 installed and licensed for the modes/SDK session you use.
  Development targets the installed MouseMux 3.0.19 / Web SDK 2.2.38.
- Two physical mice assigned to separate users in MouseMux.
- MouseMux Web SDK enabled at `127.0.0.1:41001`.

MouseMux remains a separate installed runtime. Its proprietary DLLs, executable,
license, and SDK implementation are not redistributed with this package.

## Use

1. Keep the complete **CoLaB MouseMux** folder together. Drop
   **CoLaB MouseMux.amxd** onto a MIDI track.
2. Click **Start MouseMux** if its main application is not running.
3. In MouseMux, enable **Settings → Advanced → SDK → Web SDK** and use
   **Start Now** for the current session. The default port is 41001.
4. Click **Connect** in the Live device. Its roster comes from the actual engine.
5. Select **Switched** or **Multiplex**. The panel distinguishes your request
   from the subsequently reported mode.
6. Use **Native** to return MouseMux to ordinary single-cursor mode.
   **Disconnect** only disconnects this controller.

Two connected mice do not necessarily mean two users: MouseMux controls device
assignment. Configure the users there if the device reports fewer than two.
The controller does not reassign, hide, capture, or fabricate mouse users.

Mode selection affects MouseMux's desktop-wide engine. Switched and Multiplex
have the same behavior and compatibility constraints as selecting them in
MouseMux itself. Switching between them preserves an observed multi-keyboard
setting. Multiplex does not establish that every control in one Live
window supports simultaneous independent dragging. Test your intended Live and
plug-in windows with the two physical mice.

Device removal, Disconnect, or closing Live stops the bridge connection and
leaves the existing MouseMux desktop mode in place. This avoids changing another
application's shared MouseMux session. SDK session expiry is shown explicitly
and is not bypassed by automatic reconnection.

The `.amxd` is a valid native device container, supplied with its JavaScript
sidecars and Rust executable. It is not advertised as a frozen single-file
redistributable.

## Build and test

From this directory:

```powershell
cargo test --manifest-path bridge/Cargo.toml --locked
cargo clippy --manifest-path bridge/Cargo.toml --all-targets --locked -- -D warnings
node --test test/manager.test.js test/panel.test.js
python -B -m unittest discover -s test -p test_device.py
pwsh -File scripts/build-package.ps1
```

The build creates `dist/CoLaB MouseMux/` and `dist/CoLaB-MouseMux-Windows.zip`.
Rust crates provide JSON and WebSocket transport; all application coordination
is original. Dependency licenses are included under `licenses/`.

The package is deployed locally into the Live User Library, not a Railway
service. There are no database migrations. Windows CI builds and uploads a
release package for each scoped master push.

## Validation

The installed package was loaded from the configured User Library in Live
12.3.8 with bundled Max 9.0.10 and Node 20.6.1 on Windows. Live recognized it as
a MIDI effect; the panel resolved its track, the Node manager started, and
removing/reloading the device left only the current manager process running.
Loading did not start a bridge or request a MouseMux mode.

Automated checks cover SDK protocol/state handling, process lifecycle, panel
state, the AMXD container, and loading the packaged manager beneath an unrelated
ES-module package. After the Web SDK was enabled, the installed bridge
authenticated, read Multiplex mode and five pointer users (Navy and Purple
active), refreshed state, and exited cleanly without sending mode commands.
The subsequent two-mouse native context-menu test failed as recorded above.
The remaining concurrent native interaction tests, in-Live MIDI playback,
and Live Set save/reopen remain unverified.

## Max runtime troubleshooting

If Live reports **Error 127 loading external node.script**, check Max's File
Preferences for an entire installation directory from a different Max version.
That can make Live load an incompatible external ahead of its bundled copy.
Remove the conflicting installation-root search path and restart Live after
saving your work. Do not fix this by mixing Max DLLs or copying externals into
the device package.

## Implementation

- `bridge/`: Rust SDK client, login gate, actual mode/roster state, bounded
  transport, and lifecycle tests.
- `device/`: native Max controls, `v8` Live context, and Node lifecycle manager.
- `scripts/build-device.py`: AMXD/maxpat generator using the installed stock
  MIDI device header structure.
- `PROTOCOL.md`: original manager/bridge protocol and observed vendor commands.

Only loopback SDK connections are supported. The bridge does not emit keyboard
events, raw hardware paths, or the vendor's machine fingerprint.

## References

- [MouseMux Web SDK](https://www.mousemux.com/pages/sdk-web/)
- [MouseMux mode and configuration manual](https://www.mousemux.com/pages/manual/)
- [Cycling '74 Node for Max](https://docs.cycling74.com/reference/node.script)

The newer `setServerMode` command was verified against
`websdk/sdk/state/users.js`, `websdk/sdk/core/validation.js`, and the vendor
control panel inside the user-installed 3.0.19 SDK app. That SDK maps
Native/Switched/Multiplex to 1/3/5. Older Windows message SDK documentation uses
different numeric values and is not the protocol used by this bridge.
