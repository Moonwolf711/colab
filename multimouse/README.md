# MouseMux input for CoLaB

CoLaB's MultiMouse Jam panel can receive each MouseMux user's pointer separately. Each user gets a named, colored cursor, selection, context menu, and fader gesture. The panel controls clips, scenes, track selection, and volume through the existing AbletonOSC/AbletonBridge transports.

The MouseMux integration is original JavaScript using the existing `ws` dependency. MouseMux stays a separately installed application. No vendor DLL, injection routine, or SDK source is bundled. See [analysis and protocol evidence](../docs/mousemux-analysis.md).

## Run

1. Install the repo's dependencies with `npm ci` from the repository root (Node.js 18 or newer).
2. In MouseMux V3, open **Settings > Advanced > SDK > Web SDK**. Enable Web SDK and use **Start Now** for the current session. The normal port is `41001`. The installed edition must permit the SDK session. [Vendor manual](https://www.mousemux.com/pages/manual/)
3. Open `http://127.0.0.1:9460` in Brave after starting the command below. The initial `--no-ableton` run uses a simulated set and makes no connection to Ableton.

```powershell
npm run multimouse:demo -- --mousemux --mousemux-rect "0,86,1920,994"
```

**Replace that example rectangle.** `--mousemux-rect "x,y,width,height"` is the physical screen-pixel rectangle of the panel's **canvas**, excluding browser chrome, the toolbar, and hint row. Negative x/y values are supported for additional monitors. The example only fits a 1920x1080 browser content area beginning at desktop origin with the 86-pixel panel header at 100% scale. It is not an automatic calibration. Use the actual canvas bounds at the current DPI/zoom, then keep the window in that position. A screenshot/OS pixel measurement can establish the bounds; CSS pixels alone are insufficient on scaled displays.

The panel starts paused. Once the status says MouseMux connected and the mapping is correct, click **Enable input**. MouseMux provides the separate pointers; the panel does not capture, suppress, or inject Windows mouse/keyboard events. For native Ableton or plug-in window control, configure MouseMux itself separately.

After checking the demo, test real Ableton reads without writes:

```powershell
npm run multimouse -- --dry-run --mousemux --mousemux-rect "X,Y,WIDTH,HEIGHT"
```

Replace the placeholders with integers. Remove `--dry-run` for live clip/volume actions. AbletonOSC should listen on UDP 11000 with replies on 11001; AbletonBridge on TCP 9877 is the fallback. The panel shows which transport is active. `--mousemux-url ws://127.0.0.1:41001` overrides the SDK endpoint; only loopback endpoints are accepted. CoLaB does not enable MouseMux settings or restart the application automatically.

## Behavior

- User ownership comes from the SDK roster, so devices belonging to one user share that user's CoLaB identity. Distinct users retain separate identities; RustDesk participants already exposed by MouseMux can use the same path.
- Pointer coordinates map into the canvas; button events carry their own coordinates. Vertical/horizontal wheels scroll the shared grid. All five button transitions are decoded; the Jam interface currently uses left/right actions.
- Input outside the configured rectangle is ignored. Leaving it cancels that user's active selection/click. An existing fader drag flushes its last value when canceled.
- **Pause input**, panel blur/hiding/resize, losing the last panel connection, SDK disconnect, user removal, and SDK session expiry clear held gestures. Reconnect requires explicitly enabling input again.
- Window position/DPI changes are checked every 200 ms and pause input. Update the command's rectangle and restart after moving/resizing/zooming. This fixed rectangle is not native window tracking and may briefly lag a window move.
- In MouseMux mode, the server does not bind the RawMouse UDP input. This prevents duplicate events from the existing raw-input daemon. Without `--mousemux`, the prior UDP behavior remains available.
- The integration does not forward keyboard strokes, pen pressure, video, or arbitrary desktop clicks over the network. Those are not commands supported by this Jam interface. GhostMouse's separate native overlay is not part of this integration.

`/api/state` reports connection status, safe user metadata, and cursor state. `/api/log` reports resulting musical commands. The MouseMux machine fingerprint and raw device paths are not exposed.

## Verification and deployment

```powershell
npm test
```

Tests use a local WebSocket fixture matching the installed V3 protocol, the real Jam interaction core, and a child server with simulated Ableton. They cover identity, coordinates, buttons/wheels, disconnect/reconnect, disposal, invalid packets, login rejection, timeout handling, and a clip launch through the complete server pipeline. They do not prove physical-device behavior in an active Ableton session.

This feature runs on the Windows machine hosting MouseMux/Ableton; it has no database migration or Railway deployment. GitHub's existing master-branch CI runs `npm ci` and `npm test`. Starting the local server launches the runtime in the current session; stop it with Ctrl+C. No service is installed.

At implementation time the MouseMux application was running but its Web SDK had no listener on port 41001. Physical multi-mouse/Ableton verification remains pending enabling the SDK and calibrating the panel.
