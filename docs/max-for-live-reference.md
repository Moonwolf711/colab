# Max for Live Development Reference

## Complete Guide for coLaB Development

---

## 1. The `js` Object — JavaScript in Max

### Creating a JS Object
In an unlocked patcher, press **N** and type:
```
js myfile.js
```

### CRITICAL: File Location
The JS file **MUST be saved in the same folder as the Max device (.amxd)**. If the file is elsewhere, add the folder to **Options > File Preferences** in Max.

### Arguments
```
js filename.js           # 1 inlet, 1 outlet (default)
js filename.js 2         # 1 inlet, 2 outlets
js filename.js 2 3       # 3 inlets, 2 outlets (outlets first, then inlets)
```

Or set in the JS file itself:
```javascript
inlets = 3;
outlets = 2;
```

### Autowatch (Auto-reload on save)
```
js filename.js @autowatch 1
```
This recompiles the JS file automatically whenever you save it in a text editor.

---

## 2. How Messages Route to JS Functions

| Max Message | JS Function Called | Example |
|------------|-------------------|---------|
| `bang` | `bang()` | Click a button connected to js |
| `42` (integer) | `msg_int(v)` | Number box → js |
| `3.14` (float) | `msg_float(v)` | Float box → js |
| `list 1 2 3` | `list(a, b, c)` | List message → js |
| `init` | `init()` | Message box with "init" → js |
| `connect 192.168.1.5` | `connect(ip)` | Message box → js |
| `foo bar 42` | `foo(a, b)` | First word = function name |
| `loadbang` | `loadbang()` | Called when patcher loads |
| `compile` | (reloads file) | Forces JS recompile |

**Key Rule:** Any message where the first word matches a function name in your JS file will call that function. The remaining words become arguments.

### Special: `anything()` Catch-All
```javascript
function anything() {
  var msg = messagename;       // the message name
  var args = arrayfromargs(arguments);  // all arguments
  post("Received: " + msg + " " + args + "\n");
}
```

---

## 3. Global Functions Available in Max JS

### Output
```javascript
post("message");              // Print to Max Console
post("value:", 42, "\n");     // Multiple args, newline at end
cpost("debug message");       // Print to system console
error("something broke");     // Print in red to Max Console
```

### Messaging
```javascript
outlet(0, "value", 42);       // Send out outlet 0
outlet(1, "bang");             // Send bang out outlet 1
messnamed("objectname", "msg", args);  // Send to named object
```

### Utilities
```javascript
var args = arrayfromargs(arguments);  // Convert arguments to array
var inlet_num = inlet;               // Which inlet received message
```

### Including Other Files
```javascript
include("otherfile.js");       // Load and execute another JS file
// File must be in Max search path
```

**NOTE:** `require()` is NOT available in the classic `js` object. Only available in `v8` object (Max 9+) or Node for Max.

---

## 4. The Task Object — Timers & Polling

```javascript
// Create a repeating task
var myTask = new Task(myFunction, this);
myTask.interval = 100;    // milliseconds
myTask.repeat();           // start repeating

// One-shot delayed execution
var delayTask = new Task(myFunction, this);
delayTask.schedule(1000);  // execute once after 1000ms

// Stop a task
myTask.cancel();

// Check if running
if (myTask.running) { ... }

// Task with arguments
var t = new Task(myFunction, this, arg1, arg2);

function myFunction(a, b) {
  post("Called with: " + a + " " + b + "\n");
}
```

### Task Properties
| Property | Description |
|----------|-------------|
| `interval` | Time between repeats (ms) |
| `object` | Object context for function |
| `function` | Function to execute |
| `arguments` | Arguments array |
| `running` | Boolean — is task active? |

### Task Methods
| Method | Description |
|--------|-------------|
| `execute()` | Run immediately |
| `schedule(delay)` | Run once after delay ms |
| `repeat(times)` | Repeat N times (no arg = forever) |
| `cancel()` | Stop the task |

---

## 5. LiveAPI — Accessing Ableton Live

### CRITICAL: Cannot Use in Global Scope
```javascript
// WRONG — will crash or fail silently
var api = new LiveAPI("live_set");  // DON'T do this at top level

// RIGHT — use inside a function triggered after device loads
function init() {
  var api = new LiveAPI("live_set");
  post("Tracks: " + api.getcount("tracks") + "\n");
}
```

**Initialization:** Use `live.thisdevice` in the Max patcher — it sends a `bang` when the device is fully loaded. Connect it to a message `init` → `js` object.

### Constructor
```javascript
var api = new LiveAPI("live_set");                    // by path
var api = new LiveAPI("live_set tracks 0");           // nested path
var api = new LiveAPI(callback, "live_set tracks 0"); // with callback
var api = new LiveAPI(callback);                      // set path later
api.path = "live_set tracks 0";                       // set path
api.id = someId;                                       // set by ID
```

### Core Methods
```javascript
api.get("name")              // Returns property value(s)
api.getstring("name")        // Returns as String
api.set("name", "New Name")  // Set property
api.call("fire")             // Call a function
api.getcount("tracks")       // Count children
api.goto("live_set tracks 0") // Navigate to path
```

### Properties
| Property | Description |
|----------|-------------|
| `id` | Live object ID (runtime only) |
| `path` | Quoted path string |
| `unquotedpath` | Path without quotes |
| `type` | Object type |
| `children` | Array of child names |
| `info` | Full info string |
| `mode` | 0=follow object, 1=follow position |

### Observing Changes
```javascript
var api = new LiveAPI(function(args) {
  post("Changed: " + args + "\n");
}, "live_set tracks 0");

api.property = "mute";  // Start observing "mute" property
// Callback fires whenever mute changes
```

---

## 6. Live Object Model — Key Paths

### Session
```
live_set                              # The song/session
live_set tracks N                     # Track N (0-indexed)
live_set return_tracks N              # Return track N
live_set master_track                 # Master track
live_set scenes N                     # Scene N
live_set view                         # Session view state
```

### Track Properties
```javascript
api.get("name")           // Track name
api.get("color")          // Track color
api.get("mute")           // Mute state (0/1)
api.get("solo")           // Solo state (0/1)
api.get("arm")            // Record arm (0/1)
api.get("current_monitoring_state")
api.getcount("clip_slots") // Number of clip slots
api.getcount("devices")    // Number of devices
```

### Mixer
```
live_set tracks N mixer_device volume          # Volume
live_set tracks N mixer_device panning         # Pan
live_set tracks N mixer_device sends N         # Send N
```

### Clips
```
live_set tracks N clip_slots M                 # Clip slot
live_set tracks N clip_slots M clip            # Clip in slot
```

```javascript
// Check if slot has clip
var slot = new LiveAPI("live_set tracks 0 clip_slots 0");
var hasClip = parseInt(slot.get("has_clip"));

// Get clip properties
var clip = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
clip.get("name")
clip.get("length")
clip.get("looping")
clip.get("start_marker")
clip.get("end_marker")
```

### MIDI Notes
```javascript
var clip = new LiveAPI("live_set tracks 0 clip_slots 0 clip");

// Get all notes: get_notes(start_time, start_pitch, time_range, pitch_range)
var notes = clip.call("get_notes", 0, 0, 128, 128);
// Returns: "notes" count "note" pitch time duration velocity mute ...

// Set notes
clip.call("select_all_notes");
clip.call("replace_selected_notes");
clip.call("notes", 2);  // count
clip.call("note", 60, 0.0, 0.25, 100, 0);  // pitch time dur vel mute
clip.call("note", 64, 0.5, 0.25, 90, 0);
clip.call("done");
```

### Transport
```javascript
var ls = new LiveAPI("live_set");
ls.get("is_playing")          // 0 or 1
ls.get("tempo")               // BPM
ls.get("current_song_time")   // Position in beats
ls.get("loop")                // Loop on/off
ls.get("loop_start")          // Loop start (beats)
ls.get("loop_length")         // Loop length (beats)
ls.set("tempo", 140)          // Set tempo
```

### View / Selection
```javascript
var view = new LiveAPI("live_set view");
view.get("selected_track")    // Returns "id N"
view.get("selected_scene")    // Returns "id N"
// Detail view
view.get("detail_clip")       // Currently open clip
```

### Creating/Deleting
```javascript
var ls = new LiveAPI("live_set");
ls.call("create_midi_track", -1);   // Create at end
ls.call("create_audio_track", 0);   // Create at position 0

var track = new LiveAPI("live_set tracks 2");
track.call("delete_track");

var slot = new LiveAPI("live_set tracks 0 clip_slots 0");
slot.call("create_clip", 4.0);      // Create 4-beat clip

var clip = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
clip.call("fire");                   // Launch clip
```

---

## 7. Max Objects for M4L Devices

### Required Objects
| Object | Purpose |
|--------|---------|
| `live.thisdevice` | Outputs bang when device is fully loaded |
| `plugin~` / `plugout~` | Audio I/O for Audio Effects |
| `midiin` / `midiout` | MIDI I/O for MIDI Effects |

### UI Objects (Presentation Mode)
| Object | Purpose |
|--------|---------|
| `live.text` | Button/toggle with text labels |
| `live.dial` | Rotary dial |
| `live.numbox` | Number input |
| `live.slider` | Horizontal/vertical slider |
| `live.menu` | Dropdown menu |
| `live.toggle` | On/off toggle |
| `live.tab` | Tab selector |
| `live.comment` | Static text |
| `live.meter~` | Level meter |

### Network Objects
| Object | Purpose |
|--------|---------|
| `udpsend` | Send UDP packets |
| `udpreceive PORT` | Listen for UDP on PORT |

### Utility Objects
| Object | Purpose |
|--------|---------|
| `loadbang` | Send bang when patcher loads |
| `live.thisdevice` | Send bang when M4L device loads |
| `route` | Route messages by first element |
| `message` (press M) | Store and output a message |
| `button` (press B) | Send bang on click |
| `toggle` | On/off state |
| `metro INTERVAL` | Repeated bangs every INTERVAL ms |
| `defer` / `deferlow` | Move to low-priority thread |
| `trigger` / `t` | Sequence outputs right-to-left |
| `pack` / `unpack` | Combine/split message lists |
| `sprintf` | Format strings |

---

## 8. Building a Proper M4L Device (Step by Step)

### MIDI Effect Device
```
1. In Ableton: Browser > Max for Live > Max MIDI Effect → drag to track
2. Click wrench icon to open Max editor
3. You'll see: midiin → midiout (passthrough)
4. Add objects between them for your logic
```

### Audio Effect Device
```
1. Browser > Max for Live > Max Audio Effect → drag to track
2. Click wrench icon
3. You'll see: plugin~ → plugout~ (passthrough)
4. Add processing between them
```

### Proper JS Initialization Pattern
```
[live.thisdevice] → [t b b] → [message: init] → [js myfile.js @autowatch 1]
                              → [message: compile] → (same js)
```

This ensures:
1. `live.thisdevice` waits for device to fully load
2. `trigger` sends compile first (right-to-left), then init
3. JS file is recompiled and then initialized

---

## 9. UDP Networking in Max

### Sending
```
[udpsend 192.168.1.100 4243]
```
Messages:
- `host <ip>` — change destination IP
- `port <num>` — change destination port
- Send any message and it goes as UDP

### Receiving
```
[udpreceive 4243]
```
- Listens on the specified port
- Outputs received messages from its outlet

### Routing Received Messages
```
[udpreceive 4243] → [route cursor track state] → (respective handlers)
```

---

## 10. Common Pitfalls & Gotchas

1. **JS file not in device folder** — Save the .js file in the SAME folder as the .amxd, or add folder to File Preferences
2. **LiveAPI in global scope** — NEVER create LiveAPI at top level. Always inside a function called after `live.thisdevice` bangs
3. **"No such object" error** — Usually a file naming conflict in Max search path. Rename files to avoid conflicts
4. **`bang` is a function name** — Define `function bang()` in JS to handle button clicks. Don't confuse with the `button` (B) Max object
5. **`require()` doesn't work** — Classic `js` object uses ES5. Use `include()` instead, or use `v8` object (Max 9+)
6. **`loadbang` vs `live.thisdevice`** — `loadbang` fires when patcher loads but Live API may not be ready yet. Always use `live.thisdevice` for M4L devices
7. **Outlet numbering** — `outlet(0, ...)` is leftmost outlet. Outlets are right-to-left in the js argument syntax but left-to-right in `outlet()`
8. **Task scheduling** — Tasks run in the low-priority thread. Don't rely on exact timing for audio-rate operations
9. **Message box vs Object box** — Press **M** for message box, **N** for object box. They look similar but behave differently
10. **Presentation mode** — UI elements only show in Ableton if they have `presentation: 1` and are positioned in Presentation Mode (Alt+Cmd+E / Alt+Ctrl+E)

---

## 11. MaxMSP MCP Server

An MCP server exists for Claude to directly understand and generate Max patches:

**Repo:** https://github.com/tiianhk/MaxMSP-MCP-Server

### Requirements
- Max 9+ (needs V8 JavaScript engine)
- Python 3.8+
- `uv` package manager

### Installation
```bash
# Install uv
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Clone and setup
git clone https://github.com/tiianhk/MaxMSP-MCP-Server.git
cd MaxMSP-MCP-Server
uv venv
.venv\Scripts\activate
uv pip install -r requirements.txt

# Connect to Claude
python install.py --client claude
```

### Capabilities
- Explain existing Max patches
- Generate new Max patches from descriptions
- Access Max object documentation
- Debug patches in real-time

**NOTE:** Requires Max 9. If you have Max 8 (bundled with older Ableton), this won't work.

---

## 12. V8 Object (Max 9+ / Live 12.2+)

Max 9 introduced the `v8` object with a modern JavaScript engine (same as Node.js/Chrome):

### Differences from `js` object
| Feature | `js` (classic) | `v8` (Max 9+) |
|---------|---------------|---------------|
| JS Version | ES5 | ES2022+ |
| `require()` | No | Yes |
| `import/export` | No | Yes |
| Arrow functions | No | Yes |
| `async/await` | No | Yes |
| `class` syntax | No | Yes |
| Template literals | No | Yes |
| Performance | Slower | Much faster |

### Using V8
```
v8 myfile.js @autowatch 1
```
Same message routing as `js`, but with full modern JavaScript support.

---

## Sources

- [Cycling74 API Reference](https://docs.cycling74.com/apiref/)
- [Max JS Object Reference](https://docs.cycling74.com/legacy/max8/refpages/js)
- [LiveAPI Object](https://docs.cycling74.com/max8/vignettes/jsliveapi)
- [Creating M4L Devices](https://docs.cycling74.com/max8/vignettes/live_api)
- [Adam Murray's JS Tutorials](https://adammurray.link/max-for-live/js-in-live/)
- [Adam Murray's V8 Tutorials](https://adammurray.link/max-for-live/v8-in-live/)
- [MaxMSP MCP Server](https://github.com/tiianhk/MaxMSP-MCP-Server)
