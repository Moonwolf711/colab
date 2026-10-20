# CoLaB MouseMux bridge contract

Target: installed MouseMux V3 SDK at `ws://127.0.0.1:41001`.
The Rust bridge owns this connection. Max's node.script owns the bridge process;
v8 owns LiveAPI initialization. Node's built-in child_process is sufficient.

Bridge executable: `bin/mousemux-live-bridge.exe`. It accepts `--port N`
(default 41001), starts disconnected, and exchanges one JSON object per line.
It must exit on stdin EOF. No vendor process is killed on helper exit.

Commands:

```json
{"command":"connect"}
{"command":"disconnect"}
{"command":"refresh"}
{"command":"mode","mode":"native"}
{"command":"mode","mode":"switched"}
{"command":"mode","mode":"multiplex"}
{"command":"stop"}
```

Mode values for the installed Web SDK are native=1, switched=3, multiplex=5.
The engine can also report merged mode (2); display it without adding a command.
Preserve an observed multi-keyboard setting by using switched=4 or multiplex=6.
Wait for an observed engine mode before applying a mouse-mode change.
Commands are explicit momentary actions; loading a Live set must not change mode.
Only send control after successful client.login.request.A2M acknowledgement.
Mode request is `server.mode.set.request.A2M` with numeric `mode`; query actual
state with `server.mode.request.A2M`. Never mistake an acknowledgement for
confirmed mode. Native cursor input stays within MouseMux; do not capture,
reinject, create virtual users, or suppress physical devices.

Events:

```json
{"event":"status","state":"disconnected","detail":"Ready to connect"}
{"event":"status","state":"connected","detail":"MouseMux SDK connected"}
{"event":"mode","mode":["multiplex"],"confirmed":true}
{"event":"users","users":[{"id":1,"name":"Blue","color":{"r":20,"g":100,"b":255},"pointers":1}],"pointer_users":1}
{"event":"activity","id":1,"x":100,"y":200}
{"event":"result","command":"mode","ok":true,"detail":"Requested multiplex; waiting for observed mode"}
{"event":"error","detail":"..."}
```

Status states: disconnected, connecting, connected, error, expired.
Users must be derived from physical pointer/mouse devices in the vendor roster;
do not expose system fingerprint, raw device paths, or keyboard input.
Activity events are optional and rate limited (at most 20/second total).
SDK timeout is terminal for the process; do not automatically reconnect around it.
Disconnected UI must clear stale users/mode. Only explicit connect retries.
Stop/disconnect send client.logout.request.A2M where possible and close promptly.
The engine's desktop mode remains unchanged on device removal; Native button
explicitly restores MouseMux's standard single-cursor mode.

Application metadata: CoLaB MouseMux for Live, version 0.1.0.
Every SDK response has the original request type and ok/error fields.
Installed SDK is 2.2.38 (2026-08-21). Mode strings arrive in
server.mode.notify.M2A. Server keepalive is server.ping.notify.M2A answered
by client.pong.request.A2M.
