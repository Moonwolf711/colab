# Max for Live JavaScript API -- Complete Reference

Compiled 2026-03-21. Covers Max 8 (legacy `js` engine) and Max 9 (`v8` engine).

---

## Table of Contents

1. [The js / v8 Object -- Loading and Basics](#1-the-js--v8-object)
2. [Inlets, Outlets, and Message Routing](#2-inlets-outlets-and-message-routing)
3. [jsthis Properties and Methods](#3-jsthis-properties-and-methods)
4. [The LiveAPI Object (M4L JavaScript)](#4-the-liveapi-object)
5. [The Task Object (Timers / Polling)](#5-the-task-object)
6. [Creating a Max for Live Device from Scratch](#6-creating-a-max-for-live-device-from-scratch)
7. [Max for Live UI Objects](#7-max-for-live-ui-objects)
8. [UDP Networking (udpsend / udpreceive)](#8-udp-networking)
9. [Patcher and Maxobj Scripting from JS](#9-patcher-and-maxobj-scripting-from-js)
10. [js vs v8 -- Engine Differences](#10-js-vs-v8-engine-differences)
11. [Common Pitfalls and Gotchas](#11-common-pitfalls-and-gotchas)
12. [Live Object Model Quick Reference](#12-live-object-model-quick-reference)
13. [Sources](#13-sources)

---

## 1. The js / v8 Object

### How It Works

The `js` object (legacy) and `v8` object (modern, Max 9+) embed JavaScript inside a Max patcher. You create a `js` or `v8` object in your patcher and give it a filename argument pointing to a `.js` file.

### Loading a JavaScript File

```
[js my_script.js]          -- Legacy engine (ES5 / JavaScript 1.8.5)
[v8 my_script.js]          -- Modern engine (ES6+ / V8, same as Chrome/Node)
```

The `.js` file MUST be in one of these locations (search order):

1. **Same folder as the .maxpat / .amxd file** (most reliable, always wins)
2. **Max's File Preferences search paths** (Options > File Preferences)
3. **`~/Documents/Max 8/Max for Live Devices/[project]/code/`** (frozen devices extract here)

**CRITICAL**: If the file is not found, you get `"can't find my_script.js"` in the Max console. The most common fix is placing the `.js` file in the same directory as your patch.

### Arguments After Filename

```
[js my_script.js 440 hello 3]
```

Inside JavaScript, access these via `jsarguments`:

```javascript
// jsarguments[0] is ALWAYS the filename
var filename = jsarguments[0];  // "my_script.js"
var freq = jsarguments[1];       // 440
var word = jsarguments[2];       // "hello"
var num = jsarguments[3];        // 3
// jsarguments.length includes the filename
```

### Inlet/Outlet Count via Arguments (Alternative)

```
[js 2]          -- 1 inlet (default), 2 outlets
[js 3 2]        -- 2 inlets, 3 outlets (outlets first, then inlets)
```

These are overridden if the script sets `inlets` / `outlets` in global code.

### autowatch -- Auto-Reload on File Save

```javascript
autowatch = 1;  // Set in global scope of your .js file
```

Or send the message `autowatch 1` to the js object. When enabled, the script recompiles automatically when the `.js` file is saved externally.

**GOTCHA**: autowatch does not always reliably detect saves on all platforms. Sometimes you need to send `compile` to the js object manually, or click the patcher to trigger a reload.

### Embedded Code (v8 only)

The `v8` object supports the `embed` attribute to store JavaScript source directly in the patcher (no external file needed).

### Recompiling

Send the message `compile` to the js/v8 object to force a reload of the current file. Send `compile otherfile.js` to switch to a different file.

---

## 2. Inlets, Outlets, and Message Routing

### Declaring Inlets and Outlets

In the global scope of your `.js` file (outside any function):

```javascript
inlets = 3;    // Creates 3 inlets (numbered 0, 1, 2 from left)
outlets = 2;   // Creates 2 outlets (numbered 0, 1 from left)
```

Default is 1 inlet and 1 outlet if not specified. The object box in the patcher updates when these change.

### How Max Messages Route to JS Functions

When a Max message arrives at any inlet of the js object, Max looks for a JavaScript function whose name matches the message:

| Max message received | JS function called | Notes |
|---|---|---|
| `bang` | `bang()` | No arguments |
| `42` (integer) | `msg_int(42)` | Name MUST be `msg_int`, not `int` |
| `3.14` (float) | `msg_float(3.14)` | Name MUST be `msg_float`, not `float` |
| `foo 1 2 3` | `foo(1, 2, 3)` | Symbol message -- function name matches first symbol |
| `1 2 3` (list starting with number) | `list(1, 2, 3)` | Lists beginning with numbers call `list()` |
| Any unmatched message | `anything()` | Catch-all fallback |

### msg_int and msg_float Fallback Rules

- If ONLY `msg_int()` is defined, incoming floats get **truncated** to int and passed to `msg_int()`
- If ONLY `msg_float()` is defined, incoming ints get **promoted** to float and passed to `msg_float()`
- If BOTH are defined, each receives its own type

### The anything() Catch-All

```javascript
function anything() {
    // messagename -- the symbol that triggered this function
    // inlet       -- which inlet received it (0-indexed)
    // arguments   -- the JS arguments object contains the args after the symbol

    post("Message: " + messagename + "\n");
    post("Inlet: " + inlet + "\n");
    post("Args: ");
    for (var i = 0; i < arguments.length; i++) {
        post(arguments[i] + " ");
    }
    post("\n");
}
```

### Determining Which Inlet Received a Message

```javascript
function msg_int(val) {
    if (inlet === 0) {
        // Left inlet
        post("Left inlet got: " + val + "\n");
    } else if (inlet === 1) {
        // Right inlet
        post("Right inlet got: " + val + "\n");
    }
}
```

The `inlet` property is 0-indexed (0 = leftmost).

### Sending Output from Outlets

```javascript
outlet(0, "bang");              // Send bang out leftmost outlet
outlet(0, 42);                  // Send int out outlet 0
outlet(0, 3.14);                // Send float out outlet 0
outlet(0, "set", 42);           // Send "set 42" message out outlet 0
outlet(0, 1, 2, 3);             // Send list "1 2 3" out outlet 0
outlet(1, "hello", "world");    // Send "hello world" out outlet 1
```

**IMPORTANT**: Outlets are numbered 0 (leftmost) to N-1 (rightmost).

**IMPORTANT**: You CANNOT call `outlet()` in global code (during script initialization). Outlets do not exist yet at that point. Use `loadbang()` or `bang()` for initial output.

### Declaring Outlet Types

```javascript
outlets = 3;
outlettypes = ["int", "float", "bang"];  // Helps Max optimize connections
```

### Printing to Max Console

```javascript
post("Hello Max console\n");       // Print with newline
post("value:", someVar, "\n");      // Multiple args
error("Something went wrong\n");    // Red error text in console
cpost("C-level post\n");           // Posts to system console (low-level)
```

### Private Functions (Hidden from Max)

```javascript
function myHelper() {
    // This CAN be called from Max as a message "myHelper"
}

function _internal() {
    // Still callable from Max!
}

// To truly hide a function from Max messages:
function secretHelper() { /* ... */ }
secretHelper.local = 1;  // NOW Max cannot call this via messages
```

### Inlet/Outlet Assistance (Hover Help)

```javascript
function setinletassist(num, callback) { /* ... */ }
function setoutletassist(num, callback) { /* ... */ }

// Or use the assist() method:
function assist(str, num) {
    // This is called when user hovers over inlet/outlet
}

// Simpler approach:
setinletassist(0, function() { return "Signal input"; });
setoutletassist(0, function() { return "Processed output"; });
```

---

## 3. jsthis Properties and Methods

### Read-Only Properties

| Property | Type | Description |
|---|---|---|
| `box` | Maxobj | The current js object's box in the patcher |
| `inlet` | Number | Which inlet received the current message (0-indexed) |
| `jsarguments` | Array | Arguments typed into the js object box |
| `max` | Max | Global Max application instance |
| `messagename` | String | Name of the message that triggered current function |
| `patcher` | Patcher | The Patcher containing this js object |

### Read-Write Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `autowatch` | Boolean | false | Auto-reload file on external save |
| `editfontsize` | Number | -- | Font size for the text editor window |
| `inlets` | Number | 1 | Number of inlets |
| `outlets` | Number | 1 | Number of outlets |
| `multitouch` | Boolean | false | Enable multitouch events (v8 only) |
| `outlettypes` | Array | null | Declared outlet types ("int", "float", "bang", "jit_matrix") |

### Output Methods

| Method | Description |
|---|---|
| `outlet(n, ...args)` | Send data out outlet n |
| `outlet_array(n, array)` | Convert JS array to Max array and output |
| `outlet_dictionary(n, obj)` | Convert JS object to Max dictionary and output |
| `outlet_string(n, str)` | Convert JS string to Max string and output |

### Logging Methods

| Method | Description |
|---|---|
| `post(...args)` | Print to Max console |
| `error(...args)` | Print red error text to Max console |
| `cpost(...args)` | Print to system console (low-level debug) |

### Lifecycle / Special Functions

| Function | When Called |
|---|---|
| `loadbang()` | When patcher containing js is loaded (not on instantiation) |
| `notifydeleted()` | When the js object is freed/deleted |
| `save()` | When patcher is saved -- use `embedmessage()` to persist state |
| `getvalueof()` | When pattr queries current value |
| `setvalueof(val)` | When pattr sets a value |

### Utility Methods

| Method | Description |
|---|---|
| `arrayfromargs(messagename, arguments)` | Convert arguments object to proper JS array (legacy engine) |
| `arrayfromargs(arguments)` | Same, without messagename prepended |
| `declareattribute(name, getter, setter)` | Declare a storable attribute with optional get/set functions |
| `embedmessage(functionName, ...args)` | Embed a function call that replays on patcher load |
| `messnamed(name, ...args)` | Send a message to a named Max object (like `send`) |
| `notifyclients()` | Notify pattr clients of value change |
| `refresh()` | Redraw (jsui/v8ui only -- copy sketch to screen) |

### The arrayfromargs Pattern (Legacy Engine)

The legacy `js` engine does not have proper array spread. Use this pattern:

```javascript
function anything() {
    var args = arrayfromargs(messagename, arguments);
    // args is now a real array: ["symbolName", arg1, arg2, ...]
    post("Full message: " + args.join(" ") + "\n");
}

function list() {
    var args = arrayfromargs(arguments);
    // args is [val1, val2, val3, ...]
    post("List: " + args.join(", ") + "\n");
}
```

---

## 4. The LiveAPI Object

The `LiveAPI` object is how JavaScript in Max for Live accesses and controls Ableton Live's internal objects (tracks, clips, devices, parameters, etc.).

### Constructor

```javascript
// Basic -- navigate to a path
var api = new LiveAPI("live_set");

// With callback for property observation
var api = new LiveAPI(myCallback, "live_set tracks 0");

// Navigate to an object by id
var api = new LiveAPI(myCallback, "id 5");

// No initial path (set later via goto)
var api = new LiveAPI(myCallback);
```

**CRITICAL**: You CANNOT create a LiveAPI in global code. The device must be fully initialized first. Always create LiveAPI objects inside `bang()`, `loadbang()`, or other handler functions. Use `live.thisdevice` to trigger initialization.

### Properties

| Property | Type | R/W | Description |
|---|---|---|---|
| `id` | String | R/W | Dynamic identifier for the Live object (NOT stable across sessions) |
| `path` | String | R/W | Quoted canonical path (e.g., `"live_set tracks 0"`) |
| `unquotedpath` | String | R | Unquoted version of path |
| `type` | String | R | Object type at current path (e.g., "Track", "Clip") |
| `info` | String | R | Full description: id, type, children, properties |
| `children` | Array | R | Array of child object names |
| `mode` | Number | R/W | 0 = follow object, 1 = follow UI position |
| `property` | String | R/W | Set this to observe a property for changes |
| `proptype` | String | R | Type of the currently observed property |
| `patcher` | Object | R | Reference to the parent patcher |

### Methods

#### get(property) -- Read a Property

```javascript
var api = new LiveAPI("live_set tracks 0");
var trackName = api.get("name");          // Returns track name
var isMuted = api.get("mute");            // Returns 0 or 1
var volume = api.get("mixer_device volume value");  // Nested navigation
```

**Return type**: Returns a value or array. For single values, the result is the value directly. For lists, it returns an array.

#### getstring(property) -- Read as String

```javascript
var name = api.getstring("name");  // Always returns String object
```

#### set(property, value) -- Write a Property

```javascript
var api = new LiveAPI("live_set tracks 0");
api.set("mute", 1);                      // Mute the track
api.set("name", "My Track");             // Rename the track
```

#### call(functionName, ...args) -- Call a Live Object Function

```javascript
var api = new LiveAPI("live_set");
api.call("stop_all_clips");               // Stop all clips

var clipApi = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
api.call("fire");                          // Launch clip
api.call("stop");                          // Stop clip

var trackApi = new LiveAPI("live_set tracks 0");
trackApi.call("stop_all_clips");           // Stop clips on this track
```

#### getcount(child) -- Count Children

```javascript
var api = new LiveAPI("live_set");
var numTracks = api.getcount("tracks");           // Number of tracks
var numScenes = api.getcount("scenes");           // Number of scenes
var numReturns = api.getcount("return_tracks");   // Number of return tracks

var trackApi = new LiveAPI("live_set tracks 0");
var numDevices = trackApi.getcount("devices");    // Devices on track 0
var numClipSlots = trackApi.getcount("clip_slots");
```

#### goto(path) -- Navigate to a Different Object

```javascript
var api = new LiveAPI(myCallback);
api.goto("live_set tracks 0");
post("Now at: " + api.unquotedpath + "\n");
api.goto("live_set tracks 1");  // Navigate to a different track
```

### Observing Property Changes (Callbacks)

```javascript
function trackCallback(args) {
    post("Property changed: " + args + "\n");
}

function bang() {
    var api = new LiveAPI(trackCallback, "live_set tracks 0");
    api.property = "mute";  // Now trackCallback fires whenever mute changes
}
```

**IMPORTANT**: The callback receives the property name and new value as arguments. Set `api.property` to the name of the property you want to observe.

### Common LiveAPI Patterns

```javascript
// Iterate all tracks
function listTracks() {
    var api = new LiveAPI("live_set");
    var count = api.getcount("tracks");
    for (var i = 0; i < count; i++) {
        var track = new LiveAPI("live_set tracks " + i);
        post("Track " + i + ": " + track.get("name") + "\n");
    }
}

// Get current tempo
function getTempo() {
    var api = new LiveAPI("live_set");
    var tempo = api.get("tempo");
    post("Tempo: " + tempo + " BPM\n");
    return tempo;
}

// Set tempo
function setTempo(bpm) {
    var api = new LiveAPI("live_set");
    api.set("tempo", bpm);
}

// Get the device this script is running in
function getThisDevice() {
    var api = new LiveAPI("this_device");
    post("Device path: " + api.unquotedpath + "\n");
    post("Device name: " + api.get("name") + "\n");
}
```

### LiveAPI Threading Constraints

- LiveAPI runs in the LOW-PRIORITY thread
- You CANNOT create or use LiveAPI from the scheduler (high-priority) thread
- Use `defer` or `deferlow` objects in the patcher to ensure messages arrive on the correct thread
- Changes to a Live Set are NOT possible from inside a notification callback

---

## 5. The Task Object

Tasks provide timer/polling/scheduling functionality in Max JavaScript. They replace `setTimeout`/`setInterval` which do NOT exist in Max's JS environment.

### Constructor

```javascript
var tsk = new Task(functionToRun);
var tsk = new Task(functionToRun, thisObject);
var tsk = new Task(functionToRun, thisObject, argArray);
```

| Parameter | Required | Description |
|---|---|---|
| `functionToRun` | Yes | The function to execute |
| `thisObject` | No | The `this` context during execution (default: jsthis) |
| `argArray` | No | Array of arguments passed to the function |

### Properties

| Property | Type | R/W | Description |
|---|---|---|---|
| `interval` | Number | R/W | Milliseconds between repeat executions (default: 500) |
| `running` | Boolean | R | Is the task currently active? |
| `iterations` | Number | R | How many times the task function has been called (resets each start) |
| `valid` | Boolean | R | Can the task still execute? (false after freepeer()) |

### Methods

| Method | Description |
|---|---|
| `execute()` | Run the task function immediately, once |
| `schedule(delay)` | Run once after `delay` milliseconds |
| `repeat(count, initialDelay)` | Repeat at `interval` rate. Omit count or use -1 for infinite. |
| `cancel()` | Stop a running/scheduled task |
| `freepeer()` | Invalidate the task for garbage collection |

### Examples

```javascript
// Simple repeating timer (poll every 100ms)
var pollTask;

function bang() {
    pollTask = new Task(pollFunction);
    pollTask.interval = 100;  // 100ms
    pollTask.repeat();         // Infinite repetition
}

function pollFunction() {
    var api = new LiveAPI("live_set");
    var pos = api.get("current_song_time");
    outlet(0, pos);
}

function stop() {
    if (pollTask) {
        pollTask.cancel();
    }
}
```

```javascript
// One-shot delayed execution
function delayedAction() {
    var tsk = new Task(function() {
        post("This runs after 2 seconds\n");
    });
    tsk.schedule(2000);
}
```

```javascript
// Self-cancelling task (run exactly N times using repeat count)
function countDown() {
    var tsk = new Task(doCount, this, [10]);
    tsk.interval = 1000;
    tsk.repeat(10);  // Run exactly 10 times
}

function doCount(startVal) {
    var remaining = startVal - arguments.callee.task.iterations;
    post("Countdown: " + remaining + "\n");
    outlet(0, remaining);
}
```

```javascript
// Access the Task from within its function
function ticker() {
    var t = arguments.callee.task;
    post("Iteration: " + t.iterations + "\n");
    if (t.iterations >= 5) {
        t.cancel();  // Self-cancel after 5 iterations
    }
}
```

### Task Timing Accuracy

- Overall timing accuracy is HIGH
- Latency between scheduled time and actual execution is VARIABLE
- Tasks run in the LOW-PRIORITY thread
- Do NOT use Tasks for time-critical audio operations
- For precise timing, use Max's native `metro`, `delay`, or `pipe` objects instead

### Task Cleanup

Tasks persist beyond their function scope by default. To prevent memory leaks:

```javascript
function cleanup() {
    if (myTask) {
        myTask.cancel();
        myTask.freepeer();
        myTask = null;
    }
}

function notifydeleted() {
    cleanup();  // Called when js object is freed
}
```

---

## 6. Creating a Max for Live Device from Scratch

### Device Types and Required Objects

Max for Live has three device types, each requiring specific objects:

#### Audio Effect Device

Required objects:
- `plugin~` -- Receives audio from Live's effect chain (stereo in)
- `plugout~` -- Sends processed audio back to Live (stereo out)
- `live.thisdevice` -- Reports device initialization (bang on load)

Minimal patch:
```
[plugin~] --> [your processing] --> [plugout~]

[live.thisdevice]  (left outlet: bang on init)
```

#### MIDI Effect Device

Required objects:
- `midiin` -- Receives raw MIDI bytes from Live
- `midiout` -- Sends raw MIDI bytes to Live
- `live.thisdevice` -- Reports device initialization

For parsing/reformatting MIDI:
- `midiparse` -- Splits raw MIDI into: note (pitch+vel), poly aftertouch, CC, program, aftertouch, pitch bend, MIDI channel
- `midiformat` -- Reassembles parsed MIDI back into raw bytes

Minimal MIDI passthrough:
```
[midiin] --> [midiout]
```

Minimal MIDI processing:
```
[midiin] --> [midiparse] --> [your processing] --> [midiformat] --> [midiout]
```

#### Instrument Device

Required objects:
- `midiin` -- Receives MIDI input
- `plugout~` -- Sends audio output (your synth generates audio)
- `live.thisdevice` -- Reports device initialization

Optional:
- `plugin~` -- If the instrument also processes incoming audio

### live.thisdevice -- Device Initialization

The `live.thisdevice` object has 3 outlets:

| Outlet | Output | Description |
|---|---|---|
| Left (0) | bang | Fires when device is fully loaded and initialized |
| Middle (1) | 0 or 1 | Device enabled (1) or disabled (0) |
| Right (2) | 0 or 1 | Preview mode on (1) or off (0) |

**CRITICAL PATTERN**: Connect `live.thisdevice` left outlet to your `js` object to trigger initialization code:

```
[live.thisdevice] --bang--> [js my_script.js]
```

```javascript
// In my_script.js:
function bang() {
    // SAFE to create LiveAPI objects here
    var api = new LiveAPI("live_set");
    post("Device initialized. Tracks: " + api.getcount("tracks") + "\n");
}
```

Messages accepted by `live.thisdevice`:
- `bang` / `loadbang` -- Output bang from left outlet
- `getstate` -- Output device state from right outlet
- `setwidth N` -- Set device width in Live's device view (not saved with presets)

### Templates

Always start from a template rather than a blank patcher. In Live's browser:

1. Go to the Devices section
2. Expand Audio Effects, MIDI Effects, or Instruments
3. Drag "Max Audio Effect", "Max MIDI Effect", or "Max Instrument" to a track

This gives you a correctly configured `.amxd` file with all required objects pre-wired.

### Important Restrictions

- Audio I/O limited to 2 channels (stereo) via plugin~/plugout~
- Do NOT use `send~` / `receive~` for audio between M4L devices -- not supported
- Regular `send` / `receive` for control messages IS supported
- Device latency can be set in the Patcher Inspector for processing that introduces delay
- `.amxd` files can only be edited in Max for Live (not standalone Max)

---

## 7. Max for Live UI Objects

All M4L UI objects begin with `live.` and are designed to look and behave like native Ableton controls. They integrate with Live's parameter system for automation, mapping, and preset storage.

### Complete Object List

| Object | Description |
|---|---|
| `live.arrows` | Arrow button navigation |
| `live.button` | Momentary button (outputs bang) |
| `live.colors` | Access to Live's color scheme |
| `live.dial` | Rotary knob / circular slider |
| `live.drop` | Drag-and-drop file target |
| `live.gain~` | Audio gain slider with metering |
| `live.grid` | Grid-based step sequencer UI |
| `live.line` | Line segment generator |
| `live.menu` | Dropdown menu selector |
| `live.meter~` | Audio level meter |
| `live.numbox` | Numeric display/input box |
| `live.object` | Get/set properties on Live objects (via live.path) |
| `live.observer` | Monitor Live object property changes |
| `live.param~` | Signal-rate parameter |
| `live.path` | Navigate the Live Object Model |
| `live.remote~` | Real-time signal-rate control of Live parameters |
| `live.slider` | Linear slider |
| `live.step` | Multi-track step sequencer |
| `live.tab` | Multi-button tab selector |
| `live.text` | Button or toggle with text labels |
| `live.thisdevice` | Device initialization and state reporting |
| `live.toggle` | On/off toggle switch |

Other M4L-specific objects (not `live.` prefix):
- `chucker~` -- Audio chunk player
- `ddg.mono` -- Monophonic note priority
- `midiselect` -- Filter MIDI by type/channel

### Key UI Objects in Detail

#### live.dial (Rotary Knob)

```
Appearance modes: 0=Vertical (default), 1=Tiny, 2=Panel, 3=Large
Outputs: Left=value (int or float), Right=normalized 0.0-1.0

Messages:
  bang         -- Output current value
  int/float    -- Set and output value
  set N        -- Set value without output (silent)
  init         -- Restore initial value
  rawfloat N   -- Accept normalized 0-1, convert to range

Parameter attributes:
  _parameter_type      -- Float, Int, Enum
  _parameter_range     -- [min, max]
  _parameter_unitstyle -- Int, Float, Hertz, deciBel, %, Semitones, etc.
  _parameter_exponent  -- Exponential curve for the dial
  _parameter_steps     -- Quantize to N discrete steps
```

#### live.text (Button / Toggle)

```
Output Mode (in Inspector > Behaviour):
  0 = Output on mousedown
  1 = Output on mouseup (recommended -- matches Live's native behavior)

Button Mode: 0=momentary, 1=toggle
When toggled: sends 0 (off) or 1 (on)

Has separate text for on/off states.
```

#### live.numbox (Number Box)

```
Outputs: int or float depending on _parameter_type
Click+drag to change value. Shift+drag for fine control.
Double-click triangle to restore initial value (if Initial Enable is checked).
```

#### live.menu (Dropdown Menu)

```
Set items via _parameter_range attribute: "item1" "item2" "item3"
Outputs: index (int) from left outlet, text (symbol) from right outlet
```

#### live.toggle

```
Sends 0 (off) or 1 (on).
Non-zero input turns on. Zero turns off. Bang toggles state.
```

#### live.tab (Multi-Button)

```
Outputs: index from left outlet, text from right outlet.
Set tab labels via _parameter_range: "Tab1" "Tab2" "Tab3"
```

#### live.slider (Linear Slider)

```
Same parameter system as live.dial but linear display.
Horizontal or vertical orientation.
```

#### live.gain~ (Audio Gain)

```
Audio rate gain control with built-in metering.
Signal in, signal out. dB scale.
```

#### live.meter~ (Level Meter)

```
Audio input for visual metering. No audio output.
Displays signal level.
```

### Parameter System

All `live.*` UI objects share a common parameter system accessed via the Inspector:

- **Parameter Name** (`_parameter_longname`) -- Unique name within the device
- **Short Name** (`_parameter_shortname`) -- Displayed on the UI
- **Type** (`_parameter_type`) -- Float, Int, Enum, Blob
- **Range** (`_parameter_range`) -- Min/max or enum values
- **Unit Style** (`_parameter_unitstyle`) -- Int, Float, Hertz, dB, %, Pan, Semitones, MIDI, Custom
- **Automation** (`_parameter_modmode`) -- None, Unipolar, Bipolar, Additive, Absolute
- **Initial Value** (`_parameter_initial_enable`, `_parameter_initial`) -- Default on device load
- **Mapping** (`parameter_mappable`) -- Allow MIDI/key mapping

---

## 8. UDP Networking

### udpsend -- Transmit UDP Messages

```
[udpsend hostname port]
[udpsend 192.168.1.180 9000]
[udpsend localhost 7400]
```

**Arguments:**
- `hostname` (symbol) -- Destination IP or hostname
- `port` (int) -- Destination port number

**Input messages:**
- `bang` -- Transmit bang
- `int` / `float` / `list` / `anything` -- Transmit data as OSC-compatible UDP
- `host hostname` -- Change destination host
- `port N` -- Change destination port
- `maxpacketsize N` -- Max UDP packet size (default: 5096 bytes)
- `maxqueuesize N` -- Max queued messages (default: 512)
- `FullPacket` -- OSC FullPacket format

**No outlets.** Data is transmitted over the network.

### udpreceive -- Receive UDP Messages

```
[udpreceive port]
[udpreceive 9000]
```

**Arguments:**
- `port` (int, required) -- Local port to listen on
- `full-packet` (symbol, optional) -- Pass raw OSC FullPacket buffers

**Attributes:**
- `defer` (int, default 0) -- When 1, messages go to low-priority queue (recommended in M4L to avoid audio glitches)
- `quiet` (int) -- Suppress status messages in Max console

**Input messages:**
- `port N` -- Change listening port at runtime
- `maxqueuesize N` -- Max queued messages (default: 512, increase for high-traffic)

**Output:** All received UDP messages come out the single outlet as Max messages.

### UDP/OSC Networking Rules

- Multiple `udpsend` objects CAN share the same port on one machine
- Only ONE `udpreceive` can bind to a given port on one machine
- Sender must know receiver's IP and port
- Receiver listens for anything arriving on its bound port
- In M4L, set `defer 1` on `udpreceive` to avoid audio thread issues

### Example: Send Data to Raspberry Pi

```
Max patcher:
  [js controller.js] --outlet 0--> [prepend /synth/note]
                                        |
                                   [udpsend 192.168.1.180 9000]

Pi (Python):
  import socket
  sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
  sock.bind(('0.0.0.0', 9000))
  while True:
      data, addr = sock.recvfrom(1024)
      # Process OSC data
```

---

## 9. Patcher and Maxobj Scripting from JS

The `this.patcher` property gives access to the Patcher object, allowing you to create, find, modify, and connect objects programmatically.

### Creating Objects

```javascript
// newobject(className, x, y, width, height)
var toggle = this.patcher.newobject("toggle", 100, 100, 15, 0);

// newdefault(x, y, className, ...args)  -- for objects with typed-in arguments
var num = this.patcher.newdefault(100, 200, "number");
var metro = this.patcher.newdefault(100, 300, "metro", 500);
```

### Connecting Objects

```javascript
// connect(sourceObj, outletIndex, destObj, inletIndex)
this.patcher.connect(toggle, 0, metro, 0);
```

### Finding Named Objects

```javascript
// Objects must have a scripting name set in the Inspector (varname)
var myDial = this.patcher.getnamed("myDial");
if (myDial) {
    myDial.message("set", 64);  // Send "set 64" to the dial
}
```

### Iterating All Objects

```javascript
// apply(function) -- calls function on each object, stops if returns true
this.patcher.apply(function(obj) {
    post("Object: " + obj.maxclass + " at " + obj.rect + "\n");
    return false;  // Continue iterating (return true to stop)
});

// applydeep(function) -- same but recurses into subpatchers
this.patcher.applydeep(function(obj) {
    post("Deep: " + obj.maxclass + "\n");
    return false;
});
```

### Sending Messages to Named Objects (No Patchcords)

```javascript
// messnamed sends to any object with the given scripting name
messnamed("myReceiver", "hello", 42);
// Equivalent to [send myReceiver] with message "hello 42"
```

---

## 10. js vs v8 Engine Differences

### Feature Comparison

| Feature | js (Legacy) | v8 (Modern, Max 9+) |
|---|---|---|
| ECMAScript version | ES5 (JavaScript 1.8.5) | ES6+ (up to ES2022) |
| Engine | Mozilla SpiderMonkey | Google V8 (Chrome/Node) |
| `let` / `const` | NO -- must use `var` | YES |
| Arrow functions | NO | YES |
| Template literals | NO | YES |
| Classes | NO | YES |
| async/await | NO | NO (still no event loop) |
| Typed arrays | NO | YES |
| Destructuring | NO | YES |
| Spread operator | NO | YES |
| Modules (import) | NO | NO (use require()) |
| Performance | Slower | Significantly faster |
| `setTimeout` | NO | NO (use Task) |
| LiveAPI | YES | YES |
| Task | YES | YES |
| Patcher/Maxobj | YES | YES |
| UI (jsui/v8ui) | jsui | v8ui |

### Migration Notes

- The `js` object will eventually use the V8 engine (drop-in replacement planned)
- For new code, prefer `v8` if targeting Max 9+ / Live 12.2+
- Live 12.2+ (June 2025) bundles Max 9 with V8 support
- If targeting older Live versions, use `js` with ES5 syntax
- Both engines share the same jsthis API (outlet, post, inlet, etc.)
- If using TypeScript, transpile to ES5 for `js` compatibility

### v8-Specific Features

```javascript
// v8 supports modern syntax
const myFunc = (x) => x * 2;
let [a, b, ...rest] = [1, 2, 3, 4, 5];
const obj = { name: "test", value: 42 };
const { name, value } = obj;
post(`Name: ${name}, Value: ${value}\n`);

// v8 supports additional message handlers
function msg_array(arr) { /* Handle Max array type */ }
function msg_dictionary(dict) { /* Handle Max dictionary type */ }
function msg_string(str) { /* Handle Max string type */ }

// v8 supports multitouch
multitouch = true;
function onpointerdown(event) { /* ... */ }
function onpointermove(event) { /* ... */ }
function onpointerup(event) { /* ... */ }
```

---

## 11. Common Pitfalls and Gotchas

### 1. File Not Found

**Symptom**: `"can't find my_script.js"` in Max console.

**Fix**: Place the `.js` file in the SAME folder as your `.maxpat` or `.amxd` file. This is the most reliable location. Alternatively, add the folder to Max's File Preferences search paths.

### 2. LiveAPI in Global Code

**Symptom**: `new LiveAPI(...)` fails silently or crashes during device load.

**Fix**: NEVER create LiveAPI objects in global scope. Always create them inside handler functions (`bang()`, `loadbang()`, etc.) triggered AFTER device initialization.

```javascript
// WRONG
var api = new LiveAPI("live_set");  // FAILS -- device not ready

// CORRECT
function bang() {
    var api = new LiveAPI("live_set");  // Works -- device is initialized
}
// Connect live.thisdevice bang --> js object
```

### 3. autowatch Not Detecting Saves

**Symptom**: Script changes not reflected after saving the `.js` file.

**Fix**:
- Send `compile` message to the js object manually
- Click on the patcher (sometimes triggers reload)
- Close and reopen the device
- In extreme cases, restart Max/Live

### 4. Frozen Device File Extraction

**Symptom**: After unfreezing a frozen `.amxd`, JavaScript changes have no effect.

**Fix**: When you unfreeze a device, Max extracts JS files to `~/Documents/Max 8/Max for Live Devices/[project]/code/`. These extracted copies take PRIORITY over your source files. Delete the extracted directory, or avoid unfreezing entirely.

### 5. Legacy JS Engine Limitations

**Symptom**: `SyntaxError` when using `let`, `const`, arrow functions, template literals.

**Fix**: The legacy `js` object uses ES5 only. Use `var`, regular functions, and string concatenation. Or switch to `v8` (Max 9+).

```javascript
// FAILS in legacy js
const x = 42;
let arr = [1, 2, 3];
const fn = (a) => a * 2;
post(`value: ${x}`);

// WORKS in legacy js
var x = 42;
var arr = [1, 2, 3];
function fn(a) { return a * 2; }
post("value: " + x);
```

### 6. No setTimeout / setInterval

**Symptom**: `setTimeout is not defined`.

**Fix**: Use the `Task` object instead.

```javascript
// WRONG
setTimeout(function() { post("delayed\n"); }, 1000);

// CORRECT
var tsk = new Task(function() { post("delayed\n"); });
tsk.schedule(1000);
```

### 7. Outlet in Global Code

**Symptom**: `outlet()` call in global scope does nothing or errors.

**Fix**: Outlets do not exist during global code execution. Use `loadbang()`:

```javascript
// WRONG
outlets = 1;
outlet(0, "init");  // Outlets not ready yet!

// CORRECT
outlets = 1;
function loadbang() {
    outlet(0, "init");  // Works -- outlets exist now
}
```

### 8. Threading Issues

**Symptom**: Erratic behavior, crashes, or audio glitches when using LiveAPI.

**Fix**: JavaScript runs in the low-priority thread. LiveAPI cannot be used from the high-priority (scheduler) thread. If your js object receives messages from audio-rate objects, use a `defer` or `deferlow` object in between.

### 9. Listener / Observer Memory Leaks

**Symptom**: Slowdown after multiple script reloads. Duplicate callbacks firing.

**Fix**: Max does NOT automatically remove LiveAPI listeners when you reload a script. Clean up explicitly:

```javascript
var observers = [];

function cleanup() {
    for (var i = 0; i < observers.length; i++) {
        observers[i].property = "";  // Stop observing
        observers[i].id = 0;
    }
    observers = [];
}

function bang() {
    cleanup();  // Always clean up before creating new observers
    var api = new LiveAPI(myCallback, "live_set tracks 0");
    api.property = "mute";
    observers.push(api);
}

// Also clean up when reloading
function notifydeleted() {
    cleanup();
}
```

### 10. msg_int vs int

**Symptom**: Function named `int()` is not called when integers arrive.

**Fix**: The function MUST be named `msg_int`, not `int`. Same for `msg_float` (not `float`). This is because `int` and `float` are reserved.

### 11. List Messages Starting with Symbols vs Numbers

**Symptom**: `list()` function not called for some messages.

**Fix**: In Max, a "list" message starts with a number. If the first element is a symbol, it is NOT a list -- it is a regular symbol message that calls the function matching that symbol name (or `anything()`).

```
1 2 3         --> calls list(1, 2, 3)
set 1 2 3     --> calls set(1, 2, 3)  [NOT list()]
hello 1 2     --> calls hello(1, 2) or anything() if hello() undefined
```

### 12. Patcher Scripting Name vs Long Name

**Symptom**: `this.patcher.getnamed("myDial")` returns null.

**Fix**: `getnamed()` uses the object's **scripting name** (set via `varname` attribute in Inspector), NOT the `_parameter_longname`. These are different fields. Open Inspector and set the `Scripting Name` / `varname` field.

### 13. Performance -- JS is Not Audio-Rate

JavaScript in Max runs at approximately 1-10ms resolution at best, NOT at sample rate (44100 Hz). Use it for:
- MIDI processing (event-based, slower rate)
- UI updates
- Parameter changes
- Offline generation (building clips, etc.)

Do NOT use it for:
- Real-time audio DSP
- Sample-accurate timing
- Low-latency live performance (unless timing sloppiness is acceptable)

---

## 12. Live Object Model Quick Reference

### Root Objects

| Path | Description |
|---|---|
| `live_app` | The Live application itself |
| `live_set` | The current Live Set (song) |
| `control_surfaces` | Connected control surfaces |
| `this_device` | The M4L device this script runs in |

### Navigation from live_set

```
live_set
  |- tracks [list]              -- All tracks (0-indexed)
  |    |- mixer_device          -- Volume, pan, sends
  |    |    |- volume           -- DeviceParameter
  |    |    |- panning          -- DeviceParameter
  |    |    |- sends [list]     -- Send levels
  |    |- devices [list]        -- Devices/plugins on track
  |    |    |- parameters [list]-- Device parameters
  |    |- clip_slots [list]     -- Clip slots
  |         |- clip             -- The clip (or empty)
  |              |- notes       -- MIDI notes in clip
  |- return_tracks [list]       -- Return tracks
  |- master_track               -- Master track
  |- scenes [list]              -- Scenes
  |- tempo                      -- Song tempo (property)
  |- current_song_time          -- Playback position (property)
  |- is_playing                 -- Playing state (property)
```

### Path Examples

```javascript
"live_set"                                    // The song
"live_set tracks 0"                           // First track
"live_set tracks 0 mixer_device volume"       // Track 1 volume
"live_set tracks 0 devices 0"                // First device on track 1
"live_set tracks 0 devices 0 parameters 1"  // Second parameter of first device
"live_set tracks 0 clip_slots 3 clip"        // Clip in 4th slot of track 1
"live_set master_track"                       // Master track
"live_set return_tracks 0"                    // First return track
"live_set scenes 0"                           // First scene
"this_device"                                 // Current M4L device
```

### Common Properties by Object Type

**Song (live_set):**
- `tempo` (float) -- BPM
- `current_song_time` (float) -- Current position in beats
- `is_playing` (bool) -- Playback state
- `song_length` (float) -- Song length in beats
- `signature_numerator`, `signature_denominator` (int) -- Time signature

**Track:**
- `name` (symbol) -- Track name
- `mute` (bool) -- Mute state
- `solo` (bool) -- Solo state
- `arm` (bool) -- Record arm
- `color` (int) -- Track color index
- `current_monitoring_state` (int) -- 0=In, 1=Auto, 2=Off
- Functions: `stop_all_clips`

**Clip:**
- `name` (symbol) -- Clip name
- `length` (float) -- Clip length in beats
- `is_playing` (bool) -- Playing state
- `looping` (bool) -- Loop enabled
- `loop_start`, `loop_end` (float) -- Loop boundaries
- `color` (int) -- Clip color
- Functions: `fire`, `stop`, `select_all_notes`, `get_selected_notes`, `set_notes`, `remove_notes`

**DeviceParameter:**
- `name` (symbol) -- Parameter name
- `value` (float) -- Current value
- `min`, `max` (float) -- Value range
- `is_quantized` (bool) -- Is stepped/quantized

### Data Types in the Live API

| Type | Description |
|---|---|
| `bool` | True/false (0 or 1) |
| `int` | Integer |
| `float` | Floating point |
| `double` | Double precision float |
| `symbol` | String/text |
| `beats` | Time in quarter notes |
| `time` | Time in seconds |
| `list` | Multiple values |

---

## 13. Sources

### Official Documentation (Cycling '74)
- [JavaScript in Max (Main Guide)](https://docs.cycling74.com/userguide/javascript/)
- [js Object Reference (Max 8)](https://docs.cycling74.com/legacy/max8/refpages/js)
- [v8 Object Reference](https://docs.cycling74.com/reference/v8/)
- [jsthis API Reference](https://docs.cycling74.com/apiref/js/jsthis/)
- [Basic JS Techniques (Max 8)](https://docs.cycling74.com/legacy/max8/vignettes/jsbasic)
- [The LiveAPI Object (Max 8)](https://docs.cycling74.com/max8/vignettes/jsliveapi)
- [The Task Object (Max 8)](https://docs.cycling74.com/max8/vignettes/jstaskobject)
- [Live API Overview](https://docs.cycling74.com/userguide/m4l/live_api_overview/)
- [Creating M4L Devices (Max 8)](https://docs.cycling74.com/max8/vignettes/live_creatingdevices)
- [Creating Audio Effect Devices](https://docs.cycling74.com/legacy/max8/vignettes/live_audiodevices)
- [live.thisdevice Reference](https://docs.cycling74.com/legacy/max8/refpages/live.thisdevice)
- [live.dial Reference](https://docs.cycling74.com/legacy/max8/refpages/live.dial)
- [live.text Reference](https://docs.cycling74.com/max8/refpages/live.text)
- [live.toggle Reference](https://docs.cycling74.com/max8/refpages/live.toggle)
- [live.menu Reference](https://docs.cycling74.com/max8/refpages/live.menu)
- [live.numbox Reference](https://docs.cycling74.com/legacy/max8/refpages/live.numbox)
- [M4L Object Alphabetical List](https://docs.cycling74.com/legacy/max8/vignettes/live_alphabetical)
- [udpsend Reference](https://docs.cycling74.com/legacy/max8/refpages/udpsend)
- [udpreceive Reference](https://docs.cycling74.com/legacy/max8/refpages/udpreceive)
- [Device Parameters in M4L](https://docs.cycling74.com/userguide/m4l/live_parameters/)
- [Max 9 Release Notes (v8 engine)](https://cycling74.com/releases/max/9.0.0)
- [JS Tutorial 1: Basic JavaScript](https://docs.cycling74.com/max8/tutorials/javascriptchapter01)
- [JS Tutorial 3: Tasks, Arguments, Globals](https://docs.cycling74.com/max7/tutorials/javascriptchapter03)
- [The Patcher Object (Max 8)](https://docs.cycling74.com/max8/vignettes/jspatcherobject)

### Community and Third-Party
- [Adam Murray: JavaScript in Ableton Live](https://adammurray.link/max-for-live/js-in-live/)
- [Adam Murray: The Live API](https://adammurray.link/max-for-live/js-in-live/live-api/)
- [Adam Murray: V8 Real-Time MIDI](https://adammurray.link/max-for-live/v8-in-live/realtime-midi/)
- [Max Cookbook: Live API via JavaScript](https://music.arts.uci.edu/dobrian/maxcookbook/live-api-javascript)
- [Tim Schenk: Max JS Reference](http://max-javascript-reference.tim-schenk.de/)
- [Cycling '74 Forums: JS Live API Tutorials](https://cycling74.com/forums/updated-javascript-live-api-tutorials)
- [Cycling '74 Forums: JS File Search Path](https://cycling74.com/forums/ensure-js-files-are-in-search-path)
- [edsko.net: Custom Push2 Instrument in M4L/JS](http://edsko.net/2020/12/26/trichords-part1/)
- [Ableton: Max for Live Manual (v12)](https://www.ableton.com/en/manual/max-for-live/)
- [M4L Production Guidelines (GitHub)](https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md)
- [JS in Max Examples (dobrian)](https://dobrian.github.io/cmp/topics/beyond-the-web-audio-api/2.javascript-and-max-some-basic-examples.html)
