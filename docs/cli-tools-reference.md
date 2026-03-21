# CLI Tools Reference for Music Production Development

Comprehensive reference for all CLI tools relevant to music production, audio processing, network audio streaming, and DAW control.

Last updated: 2026-03-21

---

## Table of Contents

1. [Ableton CLI / Control](#1-ableton-cli--control)
2. [Max/MSP CLI](#2-maxmsp-cli)
3. [Audio CLI Tools](#3-audio-cli-tools)
4. [Network CLI Tools for Audio](#4-network-cli-tools-for-audio)

---

## 1. Ableton CLI / Control

### 1.1 AbletonOSC

**Repository:** https://github.com/ideoforms/AbletonOSC
**Requires:** Ableton Live 11+, Python 3
**Protocol:** OSC over UDP
**Listen port:** 11000 (incoming commands)
**Reply port:** 11001 (responses)

#### Installation

```bash
# Clone the repository
git clone https://github.com/ideoforms/AbletonOSC.git

# Copy to Ableton's MIDI Remote Scripts folder
# macOS:
cp -r AbletonOSC "/Users/$USER/Music/Ableton/User Library/Remote Scripts/"
# Windows:
# Copy AbletonOSC folder to: C:\Users\<User>\Documents\Ableton\User Library\Remote Scripts\

# In Ableton: Preferences > Link/Tempo/MIDI > Control Surface > AbletonOSC
```

#### Console Utility

```bash
# Interactive console for sending OSC commands
python3 run-console.py

# Inside the console, type OSC addresses directly:
/live/song/get/tempo
/live/song/set/tempo 128.0
```

#### Song Commands

```
# Transport
/live/song/start_playing                    # Start playback
/live/song/stop_playing                     # Stop playback
/live/song/continue_playing                 # Continue from current position
/live/song/stop_all_clips                   # Stop all playing clips

# Tempo & Time
/live/song/get/tempo                        # Query current tempo
/live/song/set/tempo <bpm>                  # Set tempo (e.g., 128.0)
/live/song/get/current_song_time            # Get current playback position
/live/song/set/current_song_time <beats>    # Jump to position
/live/song/get/signature_numerator          # Time signature numerator
/live/song/get/signature_denominator        # Time signature denominator
/live/song/set/signature_numerator <n>      # Set time sig numerator
/live/song/set/signature_denominator <n>    # Set time sig denominator

# Metronome
/live/song/get/metronome                    # Query metronome state
/live/song/set/metronome <0|1>              # Enable/disable metronome

# Record
/live/song/get/record_mode                  # Query record mode
/live/song/set/record_mode <0|1>            # Enable/disable recording
/live/song/get/overdub                      # Query overdub state
/live/song/set/overdub <0|1>                # Enable/disable overdub

# Loop
/live/song/get/loop                         # Query loop state
/live/song/set/loop <0|1>                   # Enable/disable loop
/live/song/get/loop_start                   # Query loop start
/live/song/set/loop_start <beats>           # Set loop start
/live/song/get/loop_length                  # Query loop length
/live/song/set/loop_length <beats>          # Set loop length

# Quantization
/live/song/get/clip_trigger_quantization    # Get trigger quantization
/live/song/set/clip_trigger_quantization <v> # Set trigger quantization
/live/song/get/midi_recording_quantization  # Get MIDI rec quantization
/live/song/set/midi_recording_quantization <v>

# Cue Points
/live/song/get/cue_points                   # Get all cue points
/live/song/jump_to_next_cue                 # Jump to next cue
/live/song/jump_to_prev_cue                 # Jump to previous cue
/live/song/jump_by_time <seconds>           # Jump by time offset

# Undo
/live/song/undo                             # Undo last action
/live/song/redo                             # Redo last undone action

# Master
/live/song/get/master_volume                # Get master volume
/live/song/set/master_volume <0.0-1.0>      # Set master volume
```

#### Track Commands

```
# Track count and names
/live/song/get/num_tracks                        # Number of tracks
/live/track/get/name <track_idx>                 # Get track name
/live/track/set/name <track_idx> <name>          # Set track name

# Volume, Pan, Mute, Solo
/live/track/get/volume <track_idx>               # Get volume (0.0-1.0)
/live/track/set/volume <track_idx> <vol>         # Set volume
/live/track/get/panning <track_idx>              # Get panning (-1.0 to 1.0)
/live/track/set/panning <track_idx> <pan>        # Set panning
/live/track/get/mute <track_idx>                 # Get mute state
/live/track/set/mute <track_idx> <0|1>           # Set mute
/live/track/get/solo <track_idx>                 # Get solo state
/live/track/set/solo <track_idx> <0|1>           # Set solo
/live/track/get/arm <track_idx>                  # Get arm state
/live/track/set/arm <track_idx> <0|1>            # Arm/disarm for recording

# Sends
/live/track/get/send <track_idx> <send_idx>      # Get send level
/live/track/set/send <track_idx> <send_idx> <val> # Set send level

# Track properties
/live/track/get/color <track_idx>                # Get track color
/live/track/set/color <track_idx> <color_int>    # Set track color
/live/track/get/is_foldable <track_idx>          # Is group track?
/live/track/get/fold_state <track_idx>           # Group fold state
/live/track/set/fold_state <track_idx> <0|1>     # Fold/unfold group

# Track monitoring
/live/track/get/current_monitoring_state <idx>   # Monitor state
/live/track/set/current_monitoring_state <idx> <v>

# Listening for changes
/live/track/start_listen/volume <track_idx>      # Start listening to volume
/live/track/stop_listen/volume <track_idx>       # Stop listening
/live/track/start_listen/panning <track_idx>
/live/track/start_listen/mute <track_idx>
/live/track/start_listen/solo <track_idx>
```

#### Clip Commands

```
# Clip transport
/live/clip/fire <track_idx> <clip_idx>           # Fire (launch) clip
/live/clip/stop <track_idx> <clip_idx>           # Stop clip
/live/clip_slot/fire <track_idx> <slot_idx>      # Fire clip slot

# Clip properties
/live/clip/get/name <t> <c>                      # Get clip name
/live/clip/set/name <t> <c> <name>               # Set clip name
/live/clip/get/color <t> <c>                      # Get clip color
/live/clip/set/color <t> <c> <color>              # Set clip color
/live/clip/get/length <t> <c>                     # Get clip length
/live/clip/set/length <t> <c> <beats>             # Set clip length
/live/clip/get/playing_position <t> <c>           # Current play position
/live/clip/get/is_playing <t> <c>                 # Is clip playing?
/live/clip/get/is_recording <t> <c>               # Is clip recording?
/live/clip/get/is_triggered <t> <c>               # Is clip triggered?

# Clip loop
/live/clip/get/looping <t> <c>                    # Loop enabled?
/live/clip/set/looping <t> <c> <0|1>              # Enable/disable loop
/live/clip/get/loop_start <t> <c>                 # Loop start point
/live/clip/set/loop_start <t> <c> <beats>         # Set loop start
/live/clip/get/loop_end <t> <c>                   # Loop end point
/live/clip/set/loop_end <t> <c> <beats>           # Set loop end

# Audio clip properties
/live/clip/get/gain <t> <c>                       # Clip gain
/live/clip/set/gain <t> <c> <gain>                # Set clip gain
/live/clip/get/pitch_coarse <t> <c>               # Pitch transpose (semitones)
/live/clip/set/pitch_coarse <t> <c> <semi>        # Set pitch transpose
/live/clip/get/pitch_fine <t> <c>                  # Pitch fine (cents)
/live/clip/set/pitch_fine <t> <c> <cents>          # Set pitch fine

# Clip warp
/live/clip/get/warping <t> <c>                    # Warp enabled?
/live/clip/set/warping <t> <c> <0|1>              # Enable/disable warp
/live/clip/get/warp_mode <t> <c>                  # Warp mode

# MIDI notes
/live/clip/get/notes <t> <c>                      # Get all MIDI notes
/live/clip/add/notes <t> <c> <pitch> <start> <dur> <vel> <mute>  # Add note
/live/clip/remove/notes <t> <c> <start> <span> <pitch_lo> <pitch_hi>

# Wildcard queries
/live/clip/get/* <track_idx> <clip_idx>           # Get ALL clip properties
```

#### Scene Commands

```
/live/song/get/num_scenes                         # Number of scenes
/live/scene/fire <scene_idx>                      # Fire entire scene
/live/scene/get/name <scene_idx>                  # Get scene name
/live/scene/set/name <scene_idx> <name>           # Set scene name
/live/scene/get/tempo <scene_idx>                 # Scene tempo
/live/scene/set/tempo <scene_idx> <bpm>           # Set scene tempo
/live/scene/get/color <scene_idx>                 # Scene color
/live/scene/set/color <scene_idx> <color>         # Set scene color
```

#### Device Commands

```
# Device properties
/live/device/get/name <t> <d>                     # Device name
/live/device/get/class_name <t> <d>               # Device class (e.g., "Reverb")
/live/device/get/type <t> <d>                     # Device type
/live/device/get/num_parameters <t> <d>           # Number of parameters
/live/device/get/parameters/name <t> <d>          # All parameter names
/live/device/get/parameters/value <t> <d>         # All parameter values
/live/device/get/parameters/min <t> <d>           # All parameter minimums
/live/device/get/parameters/max <t> <d>           # All parameter maximums

# Individual parameters
/live/device/get/parameter/value <t> <d> <p>      # Get param value
/live/device/set/parameter/value <t> <d> <p> <val> # Set param value
/live/device/get/parameter/name <t> <d> <p>       # Get param name

# Listening for parameter changes
/live/device/start_listen/parameter/value <t> <d> <p>
/live/device/stop_listen/parameter/value <t> <d> <p>

# Enable/disable
/live/device/get/is_active <t> <d>                # Device enabled?
/live/device/set/is_active <t> <d> <0|1>          # Enable/disable device
```

#### Python Client Usage

```python
from pythonosc import udp_client, osc_server, dispatcher
import threading

# Send commands to AbletonOSC
client = udp_client.SimpleUDPClient("127.0.0.1", 11000)

# Set tempo
client.send_message("/live/song/set/tempo", 128.0)

# Fire clip on track 0, slot 0
client.send_message("/live/clip/fire", [0, 0])

# Set track volume
client.send_message("/live/track/set/volume", [0, 0.75])

# Receive responses
def handler(address, *args):
    print(f"{address}: {args}")

d = dispatcher.Dispatcher()
d.set_default_handler(handler)
server = osc_server.ThreadingOSCUDPServer(("127.0.0.1", 11001), d)
thread = threading.Thread(target=server.serve_forever)
thread.daemon = True
thread.start()

# Now query — response arrives via handler
client.send_message("/live/song/get/tempo", None)
```

---

### 1.2 ableton-js (Node.js)

**Repository:** https://github.com/leolabs/ableton-js
**npm:** `ableton-js`
**Requires:** Node.js 14+, Ableton Live 11+
**Protocol:** UDP with gzip-compressed JSON messages

#### Installation

```bash
npm install ableton-js

# Copy the MIDI Remote Script to Ableton
# 1. Find node_modules/ableton-js/midi-script/
# 2. Copy the folder to ~/Music/Ableton/User Library/Remote Scripts/
# 3. Rename it to "AbletonJS"
# 4. In Ableton: Preferences > Link/Tempo/MIDI > Control Surface > AbletonJS
```

#### API Usage

```typescript
import { Ableton } from "ableton-js";

const ableton = new Ableton();

async function main() {
  // Song properties
  const tempo = await ableton.song.get("tempo");
  await ableton.song.set("tempo", 128);

  // Transport
  await ableton.song.startPlaying();
  await ableton.song.stopPlaying();
  await ableton.song.continuePlaying();

  // Tracks
  const tracks = await ableton.song.get("tracks");
  for (const track of tracks) {
    const name = await track.get("name");
    const volume = await track.get("mixer_device.volume.value");
    console.log(`${name}: ${volume}`);
  }

  // Set track volume
  const track = tracks[0];
  await track.get("mixer_device").then(async (mixer) => {
    const vol = await mixer.get("volume");
    await vol.set("value", 0.8);
  });

  // Clips
  const clipSlots = await tracks[0].get("clip_slots");
  const clip = await clipSlots[0].get("clip");
  if (clip) {
    await clip.fire();
    const name = await clip.get("name");
    console.log(`Playing: ${name}`);
  }

  // Observe changes (reactive)
  ableton.song.addListener("tempo", (tempo) => {
    console.log(`Tempo changed: ${tempo}`);
  });

  ableton.song.addListener("is_playing", (playing) => {
    console.log(`Playing: ${playing}`);
  });

  // Devices
  const devices = await tracks[0].get("devices");
  for (const device of devices) {
    const params = await device.get("parameters");
    for (const param of params) {
      const pName = await param.get("name");
      const pVal = await param.get("value");
      console.log(`  ${pName} = ${pVal}`);
    }
  }
}

main().catch(console.error);
```

#### CLI Script Pattern

```bash
# Run a one-shot script against Ableton
node -e "
const { Ableton } = require('ableton-js');
const ab = new Ableton();
ab.song.get('tempo').then(t => { console.log('Tempo:', t); process.exit(); });
"
```

---

### 1.3 Other Ableton CLI Tools

#### AbletonPython

**Repository:** https://github.com/nrox/AbletonPython
**Control Ableton Live 11 via Python using the Live Object Model.**

```python
from AbletonPython import Ableton
ab = Ableton()
ab.get_tempo()
ab.set_tempo(140)
ab.play()
ab.stop()
```

#### ableton-live (npm)

**npm:** `ableton-live`
**Protocol:** WebSocket-based communication

```bash
npm install ableton-live
```

```typescript
import { AbletonLive } from "ableton-live";

const live = new AbletonLive();
await live.connect();
const tempo = await live.song.getTempo();
await live.song.setTempo(130);
```

#### nodeLOM

**Repository:** https://github.com/iamjoncannon/nodeLOM
**Control Ableton from Node.js via WebSockets using Live Object Model.**

```bash
npm install nodelom
```

---

## 2. Max/MSP CLI

### 2.1 The `shell` Object

**Repository:** https://github.com/jeremybernstein/shell
**Authors:** Jeremy Bernstein, Bill Orcutt
**Version:** 1.0b3
**Platforms:** macOS (arm64 + x86_64), Windows

#### Overview

The `shell` object spawns a new shell process inside Max, executes terminal commands, and passes stdout (and optionally stderr) back to Max as messages.

#### Installation

```
# Download from GitHub releases or Cycling '74 package manager
# Place shell.mxo (macOS) or shell.mxe64 (Windows) in:
#   macOS: ~/Documents/Max 8/Packages/<package>/externals/
#   Windows: C:\Users\<user>\Documents\Max 8\Packages\<package>\externals\
```

#### Max Patch Usage

```
# In Max, create object: [shell]

# Messages to shell:
[anything]         →  Execute command (e.g., "ls -la")
[kill]             →  Kill current running process
[stderr 1]         →  Enable stderr output (default: 0)
[timeout <ms>]     →  Set command timeout

# Outlets:
Outlet 1 (left):   stdout lines (symbol/list)
Outlet 2 (middle): stderr lines (if enabled)
Outlet 3 (right):  bang on command completion
```

#### Practical Examples in Max

```
# List files
[shell] → message "ls -la /path/to/audio"

# Run ffmpeg conversion from Max
[shell] → message "ffmpeg -i input.wav -ar 44100 output.wav"

# Run Python script
[shell] → message "python3 /path/to/analyze.py"

# Get system info
[shell] → message "uname -a"

# MIDI device listing
[shell] → message "amidi -l"   (Linux)
[shell] → message "system_profiler SPMIDIDataType"   (macOS)

# Start/stop JACK
[shell] → message "jack_control start"
[shell] → message "jack_control stop"
```

#### Caveats

- Paths must use forward slashes (even on Windows within Max context). Use `{conformpath slash boot}` for path conversion.
- Never send `sudo` without providing a password — shell will hang waiting for input indefinitely. Requires Max restart to recover.
- Long-running processes block the shell object until complete. Use `kill` to terminate.
- Output arrives line-by-line as Max messages.

---

### 2.2 Node for Max (N4M)

**Documentation:** https://docs.cycling74.com/max8/vignettes/00_N4M_index
**Requires:** Max 8.1+ (included with Max installation)
**Object:** `node.script`

#### Architecture

```
Max Patch
  └── [node.script scriptname.js]
        ├── Inlet:  Max messages → process.on('message')
        ├── Outlet 1: maxAPI.outlet() → Max messages
        └── Outlet 2: Status messages (started, stopped, errors)
```

#### Script Control Messages

```
# In Max, send to [node.script]:
script start                  # Start the Node.js script
script stop                   # Stop the running script
script npm install             # Install packages from package.json
script npm install <package>   # Install a specific package
script status                 # Get script running status
```

#### Node.js Script Patterns

```javascript
// scriptname.js — runs inside Max's Node.js runtime
const maxAPI = require("max-api");

// Receive messages from Max
maxAPI.addHandler("bang", () => {
  maxAPI.outlet("Hello from Node!");
});

maxAPI.addHandler("tempo", (bpm) => {
  maxAPI.outlet("tempo_received", bpm);
});

maxAPI.addHandler("analyze", async (filepath) => {
  const fs = require("fs");
  const data = fs.readFileSync(filepath);
  maxAPI.outlet("file_size", data.length);
});

// Send to specific outlets
maxAPI.addHandler("process", (value) => {
  maxAPI.outlet(value * 2);         // outlet 1
  maxAPI.outletBang();              // bang on outlet 1
});

// Dictionary support
maxAPI.addHandler("get_config", async () => {
  const dict = await maxAPI.getDict("my_dict");
  maxAPI.outlet("config", JSON.stringify(dict));
});

maxAPI.addHandler("set_config", async (key, value) => {
  await maxAPI.updateDict("my_dict", key, value);
});

// Post to Max console
maxAPI.post("Script loaded successfully");
```

#### N4M with External Packages

```javascript
// package.json in same directory as script
{
  "dependencies": {
    "osc": "^2.4.4",
    "midi": "^2.0.0",
    "ws": "^8.0.0"
  }
}

// script.js
const osc = require("osc");
const maxAPI = require("max-api");

// Create OSC port for bridging
const udpPort = new osc.UDPPort({
  localAddress: "127.0.0.1",
  localPort: 9000,
  remoteAddress: "127.0.0.1",
  remotePort: 9001
});

udpPort.on("message", (oscMsg) => {
  maxAPI.outlet("osc", oscMsg.address, ...oscMsg.args.map(a => a.value));
});

udpPort.open();
maxAPI.post("OSC bridge ready on port 9000");
```

#### CLI Usage from Terminal (for automation)

```bash
# Max's Node.js binary location
# macOS: /Applications/Max.app/Contents/Resources/C74/packages/Node\ For\ Max/runtime/node
# Windows: C:\Program Files\Cycling '74\Max 8\resources\packages\Node For Max\runtime\node.exe

# You can run N4M scripts outside Max for testing:
"/Applications/Max.app/Contents/Resources/C74/packages/Node For Max/runtime/node" script.js
```

---

### 2.3 MaxPyLang (formerly MaxPy)

**Repository:** https://github.com/Barnard-PL-Labs/MaxPyLang
**pip:** `maxpylang`
**Purpose:** Programmatic generation and editing of Max/MSP patches from Python

#### Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install maxpylang
```

#### Core API

```python
import maxpylang

# Create a new patch
patch = maxpylang.MaxPatch()

# Place objects (x, y coordinates)
osc = patch.place_object("cycle~ 440", 100, 100)
dac = patch.place_object("ezdac~", 100, 200)
gain = patch.place_object("gain~", 100, 150)
metro = patch.place_object("metro 500", 200, 100)
bang = patch.place_object("button", 200, 150)

# Connect objects (source_obj, outlet_idx, dest_obj, inlet_idx)
patch.connect(osc, 0, gain, 0)
patch.connect(gain, 0, dac, 0)
patch.connect(gain, 0, dac, 1)
patch.connect(metro, 0, bang, 0)

# Save patch
patch.save("my_patch.maxpat")
```

#### Batch Patch Generation

```python
import maxpylang

# Generate multiple oscillator patches
for freq in [220, 440, 880, 1760]:
    patch = maxpylang.MaxPatch()
    osc = patch.place_object(f"cycle~ {freq}", 100, 100)
    dac = patch.place_object("ezdac~", 100, 200)
    patch.connect(osc, 0, dac, 0)
    patch.connect(osc, 0, dac, 1)
    patch.save(f"osc_{freq}hz.maxpat")
    print(f"Created osc_{freq}hz.maxpat")
```

#### Edit Existing Patches

```python
import maxpylang

# Load an existing patch
patch = maxpylang.MaxPatch.load("existing.maxpat")

# Inspect objects
for obj in patch.objects:
    print(f"Object: {obj.text} at ({obj.x}, {obj.y})")

# Add new objects
reverb = patch.place_object("reverb~", 300, 200)

# Save modified patch
patch.save("existing_modified.maxpat")
```

#### CLI Pattern for Automation

```bash
# Generate a patch from command line
python3 -c "
import maxpylang
p = maxpylang.MaxPatch()
o = p.place_object('cycle~ 440', 100, 100)
d = p.place_object('ezdac~', 100, 200)
p.connect(o, 0, d, 0)
p.connect(o, 0, d, 1)
p.save('quick_patch.maxpat')
print('Patch created')
"
```

---

### 2.4 py-js (Python3 External for Max)

**Repository:** https://github.com/shakfu/py-js
**Purpose:** Full Python3 runtime as a Max external, enabling Python scripting directly inside Max patches.

```
# In Max, create object: [py]
# or: [pyjs] for JavaScript-style integration

# Send Python code directly:
[py] → message "import os; os.listdir('.')"
[py] → message "exec(open('myscript.py').read())"
```

---

## 3. Audio CLI Tools

### 3.1 ffmpeg — Audio Commands

**Website:** https://ffmpeg.org/
**Version:** 7.x (current stable as of 2026)

#### Format Conversion

```bash
# WAV to MP3 (constant bitrate)
ffmpeg -i input.wav -b:a 320k output.mp3

# WAV to MP3 (variable bitrate, quality 0=best, 9=worst)
ffmpeg -i input.wav -q:a 0 output.mp3

# WAV to FLAC (lossless)
ffmpeg -i input.wav -c:a flac output.flac

# FLAC to WAV
ffmpeg -i input.flac -c:a pcm_s16le output.wav

# WAV to AAC
ffmpeg -i input.wav -c:a aac -b:a 256k output.m4a

# WAV to OGG Vorbis
ffmpeg -i input.wav -c:a libvorbis -q:a 6 output.ogg

# WAV to Opus
ffmpeg -i input.wav -c:a libopus -b:a 128k output.opus

# MP3 to WAV (decode)
ffmpeg -i input.mp3 -c:a pcm_s24le -ar 48000 output.wav

# Any format to raw PCM
ffmpeg -i input.wav -f s16le -acodec pcm_s16le -ar 44100 -ac 2 output.raw

# Raw PCM to WAV
ffmpeg -f s16le -ar 44100 -ac 2 -i input.raw output.wav
```

#### Audio Extraction & Manipulation

```bash
# Extract audio from video (copy codec, no re-encode)
ffmpeg -i video.mp4 -vn -acodec copy audio.aac

# Extract audio from video (to WAV)
ffmpeg -i video.mp4 -vn -ar 44100 -ac 2 -c:a pcm_s16le audio.wav

# Trim audio (start at 30s, duration 60s)
ffmpeg -i input.wav -ss 00:00:30 -t 00:01:00 -c copy trimmed.wav

# Trim audio (start and end timestamps)
ffmpeg -i input.wav -ss 00:01:00 -to 00:02:30 -c copy trimmed.wav

# Concatenate audio files
ffmpeg -i "concat:part1.mp3|part2.mp3|part3.mp3" -c copy joined.mp3

# Concatenate via file list
echo "file 'part1.wav'" > filelist.txt
echo "file 'part2.wav'" >> filelist.txt
ffmpeg -f concat -safe 0 -i filelist.txt -c copy joined.wav

# Mix/overlay two audio tracks
ffmpeg -i track1.wav -i track2.wav -filter_complex amix=inputs=2:duration=longest mixed.wav

# Adjust volume
ffmpeg -i input.wav -af "volume=1.5" louder.wav      # 150% volume
ffmpeg -i input.wav -af "volume=0.5" quieter.wav     # 50% volume
ffmpeg -i input.wav -af "volume=6dB" boosted.wav     # +6dB
ffmpeg -i input.wav -af "volume=-3dB" reduced.wav    # -3dB

# Normalize audio (loudnorm filter)
ffmpeg -i input.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 normalized.wav

# Fade in/out
ffmpeg -i input.wav -af "afade=t=in:ss=0:d=3" fade_in.wav      # 3s fade in
ffmpeg -i input.wav -af "afade=t=out:st=57:d=3" fade_out.wav    # 3s fade out at 57s

# Change sample rate
ffmpeg -i input.wav -ar 48000 output_48k.wav
ffmpeg -i input.wav -ar 44100 output_44k.wav

# Change bit depth
ffmpeg -i input.wav -c:a pcm_s24le output_24bit.wav
ffmpeg -i input.wav -c:a pcm_s32le output_32bit.wav

# Mono to stereo
ffmpeg -i mono.wav -ac 2 stereo.wav

# Stereo to mono (mixdown)
ffmpeg -i stereo.wav -ac 1 mono.wav

# Split stereo to separate mono files
ffmpeg -i stereo.wav -filter_complex "[0:a]channelsplit=channel_layout=stereo[left][right]" -map "[left]" left.wav -map "[right]" right.wav

# Speed up / slow down audio
ffmpeg -i input.wav -af "atempo=1.5" faster.wav     # 1.5x speed
ffmpeg -i input.wav -af "atempo=0.75" slower.wav    # 0.75x speed
# For extreme changes, chain atempo (each must be 0.5-100):
ffmpeg -i input.wav -af "atempo=0.5,atempo=0.5" quarter_speed.wav

# Pitch shift (without speed change — requires rubberband)
ffmpeg -i input.wav -af "rubberband=pitch=1.5" pitched_up.wav
```

#### Audio Filters & Effects

```bash
# Equalizer (parametric)
ffmpeg -i input.wav -af "equalizer=f=1000:t=h:width=200:g=6" eq.wav
# f=frequency, t=type (h=Hz width, q=Q-factor, o=octave, s=slope), g=gain(dB)

# High-pass filter
ffmpeg -i input.wav -af "highpass=f=200" hp.wav

# Low-pass filter
ffmpeg -i input.wav -af "lowpass=f=3000" lp.wav

# Band-pass filter
ffmpeg -i input.wav -af "bandpass=f=1000:width_type=h:width=500" bp.wav

# Compressor
ffmpeg -i input.wav -af "acompressor=threshold=-20dB:ratio=4:attack=5:release=50" compressed.wav

# Limiter
ffmpeg -i input.wav -af "alimiter=level_in=1:level_out=1:limit=0.9" limited.wav

# Noise gate
ffmpeg -i input.wav -af "agate=threshold=-30dB:ratio=2:attack=5:release=50" gated.wav

# Reverb (simple echo)
ffmpeg -i input.wav -af "aecho=0.8:0.88:60:0.4" reverb.wav

# Chorus
ffmpeg -i input.wav -af "chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3" chorus.wav

# Tremolo
ffmpeg -i input.wav -af "tremolo=f=5:d=0.7" tremolo.wav

# Stereo widening
ffmpeg -i input.wav -af "stereotools=mlev=0.015625" wider.wav

# De-essing (sidechain compress high frequencies)
ffmpeg -i input.wav -af "adeclick" declicked.wav

# Silence removal
ffmpeg -i input.wav -af "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-50dB" no_silence.wav

# Generate test tones
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a pcm_s16le tone_440.wav
ffmpeg -f lavfi -i "sine=frequency=1000:duration=2" -c:a pcm_s16le tone_1k.wav

# White noise generation
ffmpeg -f lavfi -i "anoisesrc=d=5:c=white:r=44100:a=0.5" white_noise.wav

# Pink noise
ffmpeg -f lavfi -i "anoisesrc=d=5:c=pink:r=44100:a=0.5" pink_noise.wav
```

#### Streaming & Piping

```bash
# Stream audio to stdout (for piping)
ffmpeg -i input.wav -f s16le -acodec pcm_s16le -ar 44100 -ac 2 pipe:1

# Pipe audio between processes
ffmpeg -i input.mp3 -f wav pipe:1 | sox - output.wav gain -3

# RTP streaming
ffmpeg -re -i input.wav -c:a libopus -b:a 128k -f rtp rtp://239.0.0.1:5004

# UDP streaming
ffmpeg -re -i input.wav -f s16le -ar 44100 -ac 2 udp://192.168.1.100:9999

# Receive UDP stream
ffmpeg -i udp://0.0.0.0:9999 -f s16le -ar 44100 -ac 2 output.wav

# RTMP audio stream
ffmpeg -re -i input.wav -c:a aac -f flv rtmp://server/live/stream

# Record from audio device (Linux ALSA)
ffmpeg -f alsa -i hw:0 -c:a pcm_s16le recording.wav

# Record from audio device (macOS)
ffmpeg -f avfoundation -i ":0" -c:a pcm_s16le recording.wav

# Record from JACK
ffmpeg -f jack -i ffmpeg_jack recording.wav
```

#### Probing / Analysis

```bash
# Get audio file info
ffprobe -v quiet -show_format -show_streams input.wav

# Get duration only
ffprobe -v quiet -show_entries format=duration -of csv=p=0 input.wav

# Get sample rate
ffprobe -v quiet -show_entries stream=sample_rate -of csv=p=0 input.wav

# Get codec info
ffprobe -v quiet -show_entries stream=codec_name,sample_rate,channels,bits_per_sample -of json input.wav

# Waveform data (for visualization)
ffprobe -f lavfi -i "amovie=input.wav,astats=metadata=1:reset=1" -show_entries frame_tags -of csv 2>/dev/null

# Loudness analysis (EBU R128)
ffmpeg -i input.wav -af "loudnorm=print_format=json" -f null /dev/null 2>&1

# Silence detection
ffmpeg -i input.wav -af "silencedetect=noise=-30dB:d=0.5" -f null /dev/null 2>&1

# Spectral analysis (to image)
ffmpeg -i input.wav -lavfi showspectrumpic=s=1024x512 spectrum.png

# Waveform visualization
ffmpeg -i input.wav -lavfi showwavespic=s=1024x200 waveform.png
```

---

### 3.2 SoX (Sound eXchange)

**Website:** http://sox.sourceforge.net/
**Nickname:** "The Swiss Army knife of audio manipulation"

#### Basic Syntax

```
sox [global-options] [input-options] INFILE [output-options] OUTFILE [effects...]
play [options] INFILE [effects...]
rec  [options] OUTFILE [effects...]
soxi [options] INFILE       # File info only
```

#### File Information

```bash
# Display audio file info
soxi input.wav
soxi -r input.wav     # Sample rate only
soxi -c input.wav     # Channels only
soxi -s input.wav     # Number of samples
soxi -d input.wav     # Duration
soxi -b input.wav     # Bit depth
soxi -e input.wav     # Encoding type
soxi -t input.wav     # File type

# Stats (detailed analysis)
sox input.wav -n stat              # Basic stats
sox input.wav -n stat 2>&1         # Capture stderr (stats go to stderr)
sox input.wav -n stats             # Extended stats
```

#### Format Conversion

```bash
# WAV to FLAC
sox input.wav output.flac

# Change sample rate
sox input.wav -r 48000 output.wav

# Change bit depth
sox input.wav -b 24 output.wav

# Change channels (stereo to mono)
sox input.wav -c 1 output_mono.wav

# Change encoding
sox input.wav -e signed-integer -b 16 output.wav
sox input.wav -e float -b 32 output.wav

# Raw PCM to WAV
sox -r 44100 -e signed-integer -b 16 -c 2 input.raw output.wav

# Multiple format options
sox input.wav -r 44100 -b 16 -c 1 -e signed-integer output.wav
```

#### Audio Effects

```bash
# Volume adjustment
sox input.wav output.wav gain -6          # -6dB
sox input.wav output.wav gain 3           # +3dB
sox input.wav output.wav vol 0.5          # 50% volume

# Normalize (peak)
sox input.wav output.wav norm
sox input.wav output.wav norm -3          # Normalize to -3dB

# Trim/Cut
sox input.wav output.wav trim 10 30       # Start at 10s, 30s duration
sox input.wav output.wav trim 0 =60       # First 60 seconds
sox input.wav output.wav trim 30          # From 30s to end

# Fade
sox input.wav output.wav fade t 3         # 3s fade-in (t=triangular)
sox input.wav output.wav fade t 3 60 5    # 3s fade-in, 60s total, 5s fade-out
sox input.wav output.wav fade q 0 0 3     # 3s fade-out only (q=quarter-sine)
# Fade types: t (triangular), q (quarter-sine), h (half-sine), l (logarithmic), p (parabolic)

# Speed/tempo change
sox input.wav output.wav speed 1.5        # 1.5x speed (changes pitch)
sox input.wav output.wav tempo 1.5        # 1.5x tempo (preserves pitch)

# Pitch shift (semitones)
sox input.wav output.wav pitch 200        # Up 2 semitones (200 cents)
sox input.wav output.wav pitch -300       # Down 3 semitones

# Reverse
sox input.wav output.wav reverse

# Repeat
sox input.wav output.wav repeat 3         # Repeat 3 times

# Pad (add silence)
sox input.wav output.wav pad 2 3          # 2s silence before, 3s after

# Delay
sox input.wav output.wav delay 1          # 1s delay on all channels
sox input.wav output.wav delay 0 0.5      # 0s left, 0.5s right

# Echo / reverb
sox input.wav output.wav echo 0.8 0.88 60 0.4
sox input.wav output.wav echos 0.8 0.7 700 0.25 700 0.3
sox input.wav output.wav reverb 50 50 100         # reverberance% HF-damping% room-scale%
sox input.wav output.wav reverb 80 50 100 100 0 0 # Full reverb with params

# Chorus
sox input.wav output.wav chorus 0.7 0.9 55 0.4 0.25 2 -t

# Flanger
sox input.wav output.wav flanger

# Phaser
sox input.wav output.wav phaser 0.89 0.85 1 0.24 2 -t

# Tremolo
sox input.wav output.wav tremolo 5 60     # 5 Hz, 60% depth

# Overdrive/distortion
sox input.wav output.wav overdrive 20     # 20dB gain
sox input.wav output.wav overdrive 20 20  # gain + colour

# Compressor
sox input.wav output.wav compand 0.3,1 6:-70,-60,-20 -5 -90 0.2
# attack,decay threshold:output soft-knee noise-gate initial-volume

# Equalizer
sox input.wav output.wav equalizer 1000 1q 6    # +6dB at 1kHz, Q=1
sox input.wav output.wav bass +6                # Bass boost +6dB
sox input.wav output.wav treble -3              # Treble cut -3dB
sox input.wav output.wav highpass 200           # High-pass at 200Hz
sox input.wav output.wav lowpass 3000           # Low-pass at 3kHz
sox input.wav output.wav bandpass 1000 200      # Band-pass center 1kHz, width 200Hz

# Noise reduction (two-pass)
sox noisy.wav -n noiseprof noise.prof           # Step 1: profile noise
sox noisy.wav clean.wav noisered noise.prof 0.21 # Step 2: reduce noise

# Silence removal
sox input.wav output.wav silence 1 0.1 1%       # Remove leading silence
sox input.wav output.wav silence -l 1 0.1 1%    # Remove all silence periods
```

#### Synthesis

```bash
# Generate sine wave
sox -n output.wav synth 5 sine 440              # 5s, 440Hz sine

# Generate multiple tones
sox -n chord.wav synth 3 sine 440 sine 554.37 sine 659.26  # A major chord

# Generate noise
sox -n noise.wav synth 5 whitenoise              # White noise
sox -n noise.wav synth 5 pinknoise               # Pink noise
sox -n noise.wav synth 5 brownnoise              # Brown noise

# Generate sweep
sox -n sweep.wav synth 5 sine 20-20000           # 20Hz to 20kHz sweep

# Pluck (Karplus-Strong)
sox -n pluck.wav synth 1 pluck 440

# Combine types
sox -n complex.wav synth 3 sine 440 sine 880 vol 0.5
```

#### Combining & Splitting

```bash
# Concatenate files
sox part1.wav part2.wav part3.wav combined.wav

# Mix/merge (overlay) files
sox -m track1.wav track2.wav mixed.wav

# Multiply (ring modulation)
sox --combine multiply carrier.wav modulator.wav output.wav

# Split into chunks
sox input.wav output.wav trim 0 30 : newfile : restart
# Creates output001.wav, output002.wav, etc. (30s each)

# Split on silence
sox input.wav output.wav silence 1 0.5 1% 1 0.5 1% : newfile : restart
```

#### Playback & Recording

```bash
# Play audio
play input.wav
play input.wav gain -3 reverb                   # Play with effects
play -n synth 3 sine 440                        # Play generated tone

# Record audio
rec recording.wav                                # Record until Ctrl+C
rec -d 10 recording.wav                          # Record 10 seconds
rec recording.wav silence 1 3.0 3%               # Auto-stop on silence
```

---

### 3.3 Opus Tools

**Website:** https://opus-codec.org/
**Package:** `opus-tools`
**Tools:** `opusenc`, `opusdec`, `opusinfo`

Opus is the preferred codec for real-time audio streaming in coLaB due to its low latency, high quality, and support for bitrates from 6 kbps to 510 kbps.

#### opusenc (Encoder)

```bash
# Basic encoding (WAV/FLAC/AIFF → Opus)
opusenc input.wav output.opus

# Set bitrate (kbps)
opusenc --bitrate 128 input.wav output.opus
opusenc --bitrate 64 input.wav output.opus       # Lower quality, smaller
opusenc --bitrate 256 input.wav output.opus      # Higher quality

# VBR modes
opusenc --vbr input.wav output.opus              # Variable bitrate (default)
opusenc --cvbr input.wav output.opus             # Constrained VBR
opusenc --hard-cbr input.wav output.opus         # Constant bitrate (strict)

# Application hint
opusenc --music input.wav output.opus            # Optimize for music
opusenc --speech input.wav output.opus           # Optimize for speech

# Frame size (latency vs quality tradeoff)
opusenc --framesize 2.5 input.wav output.opus    # 2.5ms (lowest latency)
opusenc --framesize 5 input.wav output.opus      # 5ms
opusenc --framesize 10 input.wav output.opus     # 10ms
opusenc --framesize 20 input.wav output.opus     # 20ms (default, best quality)
opusenc --framesize 40 input.wav output.opus     # 40ms
opusenc --framesize 60 input.wav output.opus     # 60ms (highest quality)

# Expected packet loss (for lossy networks)
opusenc --expect-loss 5 input.wav output.opus    # Expect 5% packet loss

# Downmix
opusenc --downmix-mono input.wav output.opus     # Force mono
opusenc --downmix-stereo input.wav output.opus   # Force stereo

# Compression complexity (0-10, higher = slower + better)
opusenc --comp 10 input.wav output.opus

# Metadata
opusenc --title "Song Name" --artist "Artist" --album "Album" \
        --tracknumber "1" --genre "Electronic" --date "2026" \
        --comment "TAG=VALUE" input.wav output.opus

# Album art
opusenc --picture "3|image/jpeg|||cover.jpg" input.wav output.opus

# From raw PCM
opusenc --raw --raw-rate 44100 --raw-chan 2 --raw-bits 16 \
        --raw-endianness 0 input.raw output.opus

# Pipe from stdin
cat input.wav | opusenc - output.opus
ffmpeg -i input.mp3 -f wav - | opusenc --bitrate 128 - output.opus

# Quiet mode (suppress progress)
opusenc --quiet input.wav output.opus

# Maximum delay (lower = lower latency encoding, higher = better quality)
opusenc --max-delay 0 input.wav output.opus      # Minimum delay

# Disable phase inversion (for binaural audio)
opusenc --no-phase-inv input.wav output.opus

# Padding (bytes added to end)
opusenc --padding 0 input.wav output.opus        # No padding
```

#### opusdec (Decoder)

```bash
# Basic decoding (Opus → WAV)
opusdec input.opus output.wav

# Decode to specific sample rate
opusdec --rate 48000 input.opus output.wav
opusdec --rate 44100 input.opus output.wav

# Force mono
opusdec --force-mono input.opus output.wav

# Decode to float WAV
opusdec --float input.opus output.wav

# Packet loss simulation (for testing)
opusdec --packet-loss 5 input.opus output.wav

# Decode to stdout (pipe to other tools)
opusdec input.opus - | play -

# Quiet mode
opusdec --quiet input.opus output.wav
```

#### opusinfo (File Inspector)

```bash
# Display Opus file information
opusinfo input.opus
# Shows: version, channels, pre-skip, input sample rate, gain,
#        channel mapping, vendor string, user comments, bitrate, duration

# Quiet mode (errors only)
opusinfo --quiet input.opus
```

#### Opus for Real-Time Streaming

```bash
# Low-latency encode for network streaming
opusenc --bitrate 96 --framesize 5 --expect-loss 10 --comp 5 --max-delay 0 \
        input.wav stream.opus

# Encode and pipe to netcat (UDP streaming)
ffmpeg -f alsa -i hw:0 -f wav - | \
  opusenc --bitrate 64 --framesize 10 - - | \
  nc -u 192.168.1.100 9000

# Decode from network stream
nc -lu 9000 | opusdec - - | play -t raw -r 48000 -e signed -b 16 -c 2 -
```

---

### 3.4 JACK Audio CLI Tools

**Website:** https://jackaudio.org/
**Package:** `jackd2` (JACK2 with D-Bus) or `jackd` (JACK1)

#### jackd / jack_control (Server Control)

```bash
# Start JACK server directly
jackd -d alsa -r 48000 -p 128 -n 2
# -d: driver (alsa, coreaudio, portaudio, dummy)
# -r: sample rate
# -p: period/buffer size (frames)
# -n: number of periods

# jackd with real-time priority
jackd -R -d alsa -r 48000 -p 64 -n 2
# -R: real-time mode

# JACK2 D-Bus control (preferred for programmatic use)
jack_control start                             # Start JACK server
jack_control stop                              # Stop JACK server
jack_control exit                              # Exit JACK D-Bus service

# Configure driver settings
jack_control ds alsa                           # Set driver to ALSA
jack_control dps device hw:0                   # Set audio device
jack_control dps rate 48000                    # Set sample rate
jack_control dps period 128                    # Set buffer size
jack_control dps nperiods 2                    # Set number of periods

# Engine parameters
jack_control eps realtime true                 # Enable real-time
jack_control eps client-timeout 500            # Client timeout (ms)
jack_control eps port-max 256                  # Max ports
jack_control eps verbose false                 # Verbose mode

# Query status
jack_control status                            # Server running?
jack_control dp                                # Show driver parameters
jack_control ep                                # Show engine parameters
jack_control sm                                # Switch master driver
```

#### jack_lsp (List Ports)

```bash
# List all JACK ports
jack_lsp

# List with connection info
jack_lsp -c

# List with port properties (type, flags)
jack_lsp -p

# List with latency info
jack_lsp -l

# List only MIDI ports
jack_lsp -t midi

# List with aliases
jack_lsp -A

# Combine flags
jack_lsp -cpl

# Filter by pattern (grep)
jack_lsp | grep -i "system"
jack_lsp | grep -i "ardour"
```

#### jack_connect / jack_disconnect

```bash
# Connect two ports
jack_connect system:capture_1 ardour:in1
jack_connect system:capture_2 ardour:in2

# Connect application output to system playback
jack_connect my_synth:output_L system:playback_1
jack_connect my_synth:output_R system:playback_2

# Disconnect ports
jack_disconnect system:capture_1 ardour:in1

# Batch connect script
#!/bin/bash
jack_connect system:capture_1 rnbo~:in_1
jack_connect system:capture_2 rnbo~:in_2
jack_connect rnbo~:out_1 system:playback_1
jack_connect rnbo~:out_2 system:playback_2
```

#### Other JACK Utilities

```bash
# jack_bufsize — query/set buffer size at runtime
jack_bufsize                                    # Show current buffer size
jack_bufsize 256                                # Set buffer size to 256

# jack_samplerate — show sample rate
jack_samplerate

# jack_wait — wait for JACK server to start
jack_wait -w                                    # Wait for server start
jack_wait -c                                    # Check if running (exit code)

# jack_iodelay — measure round-trip latency
jack_iodelay
# Connect system:capture_1 → jack_iodelay:input
# Connect jack_iodelay:output → system:playback_1
# Then measure with loopback cable

# jack_transport — control transport
jack_transport                                  # Interactive transport control
# Commands inside: play, stop, locate <frame>, exit

# jack_metro — metronome
jack_metro -b 120 -d 0.1                       # 120 BPM, 0.1s duration

# jack_midiseq — MIDI sequencer
jack_midiseq <port_name> <MIDI_file>

# jack_midi_dump — dump MIDI events
jack_midi_dump

# jack_showtime — show time info
jack_showtime

# jack_load — load internal client
jack_load <client_name> <so_file>

# jack_unload — unload internal client
jack_unload <client_name>

# jack_netsource — network audio (NetJACK)
jack_netsource -H <remote_host>                # Connect to remote JACK server
jack_netsource -H 192.168.1.100 -p 19000      # Specify port

# jack_rec — simple recorder
jack_rec -f output.wav -d 10 system:capture_1 system:capture_2
# -f: output file
# -d: duration (seconds)
# Followed by port names to record
```

---

## 4. Network CLI Tools for Audio

### 4.1 netcat (nc) — UDP Audio Streaming

```bash
# Send raw audio via UDP
ffmpeg -i input.wav -f s16le -ar 44100 -ac 2 - | nc -u 192.168.1.100 9000

# Receive and play raw audio from UDP
nc -lu 9000 | play -t raw -r 44100 -e signed -b 16 -c 2 -

# Send live microphone audio (Linux ALSA)
arecord -f S16_LE -r 44100 -c 2 - | nc -u 192.168.1.100 9000

# Receive and save
nc -lu 9000 > recording.raw
# Convert later: sox -r 44100 -e signed -b 16 -c 2 recording.raw recording.wav

# Bidirectional audio (two terminals needed)
# Terminal 1 (send):
arecord -f S16_LE -r 44100 | nc -u 192.168.1.100 9000
# Terminal 2 (receive):
nc -lu 9000 | aplay -f S16_LE -r 44100

# Send Opus-encoded audio
ffmpeg -f alsa -i hw:0 -c:a libopus -b:a 64k -f ogg - | nc -u 192.168.1.100 9000

# TCP audio stream (reliable, higher latency)
# Server:
nc -l 9000 | play -t raw -r 44100 -e signed -b 16 -c 2 -
# Client:
ffmpeg -i input.wav -f s16le -ar 44100 -ac 2 - | nc 192.168.1.100 9000

# ncat (nmap's netcat — more features)
# Send with UDP and keep connection alive
ncat -u --send-only 192.168.1.100 9000 < audio.raw

# Listen with source address binding
ncat -lu --recv-only -s 0.0.0.0 9000 > received.raw
```

### 4.2 socat — Audio Relay & Bridging

```bash
# UDP audio relay (bidirectional)
socat UDP-LISTEN:9000,reuseaddr,fork UDP:192.168.1.100:9001

# UDP to TCP bridge (useful for NAT traversal)
socat UDP-LISTEN:9000,reuseaddr TCP:192.168.1.100:9001

# TCP to UDP bridge
socat TCP-LISTEN:9001,reuseaddr,fork UDP:192.168.1.100:9000

# Multicast audio relay
socat UDP-LISTEN:9000 UDP-DATAGRAM:239.0.0.1:9001,ip-multicast-if=eth0

# Unix socket to UDP (local IPC to network)
socat UNIX-LISTEN:/tmp/audio.sock UDP:192.168.1.100:9000

# Pipe audio through socat with process
socat -u UDP-LISTEN:9000 EXEC:"play -t raw -r 44100 -e signed -b 16 -c 2 -"

# Two-way audio link
socat UDP-LISTEN:9000,reuseaddr,fork UDP-LISTEN:9001,reuseaddr,fork

# Tee (duplicate stream to file and forward)
socat -u UDP-LISTEN:9000 SYSTEM:"tee recording.raw | nc -u 192.168.1.100 9001"

# Audio proxy with timeout
socat -T 30 UDP-LISTEN:9000,reuseaddr UDP:192.168.1.100:9001

# Connect two UNIX sockets (for local audio routing)
socat UNIX-CONNECT:/tmp/source.sock UNIX-CONNECT:/tmp/dest.sock

# Verbose mode (debug packet flow)
socat -v UDP-LISTEN:9000 UDP:192.168.1.100:9001
# Or hex dump:
socat -x UDP-LISTEN:9000 UDP:192.168.1.100:9001
```

### 4.3 iperf3 — Bandwidth Testing for Audio

```bash
# Server mode (run on receiving end)
iperf3 -s                                        # Listen on default port 5201
iperf3 -s -p 5555                                # Custom port

# Client mode — TCP bandwidth test
iperf3 -c 192.168.1.100                          # Basic TCP test
iperf3 -c 192.168.1.100 -t 30                    # 30-second test
iperf3 -c 192.168.1.100 -t 60 -i 5              # 60s test, report every 5s
iperf3 -c 192.168.1.100 -P 4                     # 4 parallel streams

# UDP bandwidth test (critical for audio streaming)
iperf3 -c 192.168.1.100 -u                       # UDP test (default 1 Mbps)
iperf3 -c 192.168.1.100 -u -b 10M               # UDP at 10 Mbps
iperf3 -c 192.168.1.100 -u -b 256K              # UDP at 256 Kbps (typical audio)
iperf3 -c 192.168.1.100 -u -b 1M -l 512         # 512-byte packets (audio-like)

# Simulate audio stream conditions
# Opus at 128kbps stereo:
iperf3 -c 192.168.1.100 -u -b 128K -t 60 -i 1
# Uncompressed 44.1kHz 16-bit stereo (~1.4 Mbps):
iperf3 -c 192.168.1.100 -u -b 1411K -t 60 -i 1
# Uncompressed 48kHz 24-bit stereo (~2.3 Mbps):
iperf3 -c 192.168.1.100 -u -b 2304K -t 60 -i 1

# Reverse mode (server sends to client — test download)
iperf3 -c 192.168.1.100 -R -u -b 1M

# JSON output (for scripting)
iperf3 -c 192.168.1.100 -u -b 1M -J

# Bidirectional test
iperf3 -c 192.168.1.100 --bidir

# Key metrics to check for audio:
#   - Jitter: should be < 5ms for real-time audio
#   - Packet loss: should be < 1% for acceptable quality
#   - Bandwidth: must exceed your audio bitrate consistently
```

### 4.4 Additional Network Audio Tools

#### GStreamer (gst-launch-1.0)

```bash
# Send audio over RTP
gst-launch-1.0 audiotestsrc ! audioconvert ! opusenc ! rtpopuspay ! \
  udpsink host=192.168.1.100 port=5004

# Receive RTP audio
gst-launch-1.0 udpsrc port=5004 caps="application/x-rtp" ! \
  rtpopusdepay ! opusdec ! audioconvert ! autoaudiosink

# Record and stream simultaneously
gst-launch-1.0 alsasrc ! tee name=t ! queue ! audioconvert ! \
  opusenc ! rtpopuspay ! udpsink host=192.168.1.100 port=5004 \
  t. ! queue ! audioconvert ! wavenc ! filesink location=recording.wav
```

#### PulseAudio CLI (pactl / pacmd)

```bash
# List sinks (output devices)
pactl list sinks short

# List sources (input devices)
pactl list sources short

# Set default sink
pactl set-default-sink <sink_name>

# Set sink volume
pactl set-sink-volume @DEFAULT_SINK@ 80%
pactl set-sink-volume @DEFAULT_SINK@ +5%
pactl set-sink-volume @DEFAULT_SINK@ -5%

# Mute/unmute
pactl set-sink-mute @DEFAULT_SINK@ toggle

# Load network module (TCP streaming)
pactl load-module module-native-protocol-tcp auth-anonymous=1

# Stream to remote PulseAudio
PULSE_SERVER=192.168.1.100 paplay audio.wav

# Record from PulseAudio
parecord -d @DEFAULT_SOURCE@ recording.wav
parecord --format=s16le --rate=44100 --channels=2 recording.raw

# Create virtual sink (for routing)
pactl load-module module-null-sink sink_name=virtual_out sink_properties=device.description="Virtual_Output"

# Monitor (loopback)
pactl load-module module-loopback source=<source> sink=<sink>
```

#### PipeWire CLI (pw-cli / pw-dump)

```bash
# List all nodes
pw-cli list-objects

# Dump full PipeWire state
pw-dump

# List links
pw-link -l

# Create link between ports
pw-link <output_port> <input_port>

# Destroy link
pw-link -d <output_port> <input_port>

# Monitor PipeWire events
pw-mon

# Record audio
pw-record recording.wav
pw-record -P '{ stream.capture.sink=true }' recording.wav   # Record sink output

# Play audio
pw-play audio.wav

# Get/set volume
wpctl get-volume @DEFAULT_AUDIO_SINK@
wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.8
wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+
wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-

# Mute
wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle

# Status overview
wpctl status
```

#### ALSA CLI Tools

```bash
# List audio devices
aplay -l                                         # Playback devices
arecord -l                                       # Capture devices
aplay -L                                         # All PCM devices

# Play audio
aplay audio.wav
aplay -D plughw:0,0 audio.wav                   # Specific device

# Record audio
arecord -f S16_LE -r 44100 -c 2 recording.wav
arecord -f S32_LE -r 48000 -c 2 -d 10 recording.wav  # 10s, 32-bit

# Mixer control
amixer                                           # Show all controls
amixer sset Master 80%                           # Set master volume
amixer sset Master toggle                        # Toggle mute
amixer sget Master                               # Get master info

# MIDI
amidi -l                                         # List MIDI devices
amidi -p hw:1,0 -S 'C0 00'                      # Send MIDI (program change)
amidi -p hw:1,0 -d                               # Dump incoming MIDI
aplaymidi -l                                     # List MIDI ports
aplaymidi -p 128:0 file.mid                      # Play MIDI file
arecordmidi -p 128:0 recording.mid               # Record MIDI
aseqdump -p 0                                    # Dump MIDI events from port 0

# Speaker test
speaker-test -c 2 -t sine -f 440                # Sine wave test
speaker-test -c 2 -t wav                         # WAV test tone
```

---

## Quick Reference: Audio Format Comparison

| Format | Type | Codec | Typical Bitrate | Latency | Use Case |
|--------|------|-------|-----------------|---------|----------|
| WAV | Lossless | PCM | 1411 kbps (16/44.1 stereo) | Lowest | Production, recording |
| FLAC | Lossless | FLAC | ~800-1000 kbps | Low | Archival, distribution |
| AIFF | Lossless | PCM | 1411 kbps | Lowest | macOS production |
| MP3 | Lossy | LAME | 128-320 kbps | Medium | Distribution |
| AAC | Lossy | AAC | 128-256 kbps | Medium | Streaming, mobile |
| OGG | Lossy | Vorbis | 96-320 kbps | Medium | Gaming, web |
| Opus | Lossy | Opus | 32-510 kbps | Very Low | Real-time streaming, VoIP |
| Raw PCM | Uncompressed | None | 1411+ kbps | Lowest | Inter-process piping |

## Quick Reference: Ports & Protocols

| Tool/Service | Default Port | Protocol | Direction |
|-------------|-------------|----------|-----------|
| AbletonOSC (receive) | 11000 | UDP/OSC | Client → Ableton |
| AbletonOSC (reply) | 11001 | UDP/OSC | Ableton → Client |
| ableton-js | Dynamic | UDP/JSON | Bidirectional |
| JACK (NetJACK) | 19000 | UDP | Bidirectional |
| RTP audio | 5004 | UDP/RTP | Sender → Receiver |
| PulseAudio TCP | 4713 | TCP | Client → Server |
| iperf3 | 5201 | TCP/UDP | Bidirectional |

---

*Document generated 2026-03-21. Sources: official documentation, GitHub repositories, man pages.*
