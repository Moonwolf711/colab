# Ableton Live CLI -- AbletonOSC Interface

## Architecture Summary

Control Ableton Live 11+ from the command line via the AbletonOSC MIDI Remote
Script. Commands are sent as OSC messages over UDP (port 11000), with responses
received on port 11001.

```
+---------------------------------------------------+
|              Ableton Live 11/12                    |
|  +---------------------------------------------+  |
|  |  AbletonOSC (MIDI Remote Script)            |  |
|  |  Listens on UDP :11000, replies on :11001   |  |
|  +--------------------+------------------------+  |
+------------------------|---------------------------+
                         |  OSC / UDP
          +--------------+--------------+
          |     ableton-cli (Python)    |
          |  pythonosc client/server    |
          |  Click CLI framework        |
          +-----------------------------+
```

## Prerequisites

1. **Ableton Live 11+** running on the same machine (or network)
2. **AbletonOSC** installed as a Control Surface:
   - Clone: `git clone https://github.com/ideoforms/AbletonOSC.git`
   - Copy to: `C:\Users\<User>\Documents\Ableton\User Library\Remote Scripts\`
   - Enable in Ableton: Preferences > Link/Tempo/MIDI > Control Surface > AbletonOSC
3. **Python 3.10+** with pip

## Installation

```bash
cd C:\Users\Owner\colab\ableton-cli
pip install -e .
```

## Quick Start

```bash
# Connect to AbletonOSC
ableton session connect

# Check transport status
ableton transport status

# Set tempo
ableton transport tempo 128

# List tracks
ableton track list

# Fire a clip (track 0, slot 0)
ableton clip fire 0 0

# Get MIDI notes from a clip
ableton clip get-notes 0 0

# Set track volume
ableton mixer volume 0 0.75

# List devices on track 0
ableton device list 0

# Interactive REPL
ableton repl
```

## Command Map: Ableton GUI -> CLI Command

| Ableton Action | CLI Command |
|---|---|
| Press Play | `transport play` |
| Press Stop | `transport stop` |
| Set Tempo | `transport tempo 128` |
| Record Enable | `transport record on` |
| Metronome On | `transport metronome on` |
| Set Loop | `transport loop --enable --start 0 --length 16` |
| Undo | `transport undo` |
| View Tracks | `track list` |
| Rename Track | `track rename 0 "Bass"` |
| Arm Track | `track arm 0 on` |
| Fire Clip | `clip fire 0 0` |
| Stop Clip | `clip stop 0 0` |
| Get Clip Info | `clip get 0 0` |
| Get MIDI Notes | `clip get-notes 0 0` |
| Add MIDI Note | `clip add-note 0 0 -p 60 -s 0 -d 1` |
| Replace Notes | `clip set-notes 0 0 '[{"pitch":60,"start":0,"duration":1,"velocity":100}]'` |
| Fire Scene | `scene fire 0` |
| List Scenes | `scene list` |
| Set Volume | `mixer volume 0 0.75` |
| Set Pan | `mixer pan 0 -0.5` |
| Mute Track | `mixer mute 0 on` |
| Solo Track | `mixer solo 0 on` |
| Set Send Level | `mixer send 0 0 0.5` |
| List Devices | `device list 0` |
| Get Param | `device param-get 0 0 1` |
| Set Param | `device param-set 0 0 1 0.5` |
| Enable Device | `device enable 0 0 on` |
| Session Overview | `view overview` |

## JSON Output

All commands support `--json` for structured output:

```bash
ableton --json track list
ableton --json transport status
ableton --json clip get-notes 0 0
```

## Module Architecture

```
cli_anything/ableton/
    __init__.py
    __main__.py
    ableton_cli.py          # Click CLI entry point + REPL
    core/
        __init__.py
        session.py           # OSC client/server, connect/disconnect
        transport.py         # Play, stop, record, tempo, position
        tracks.py            # List, get, rename, arm tracks
        clips.py             # List, fire, stop, get/set clip properties
        midi.py              # Get/set/add/remove MIDI notes
        scenes.py            # List, fire, name scenes
        devices.py           # List devices, get/set parameters
        mixer.py             # Volume, pan, mute, solo, send
        view.py              # Selected track/scene cursor
```

## AbletonOSC Command Reference

### Transport
| OSC Address | Description |
|---|---|
| `/live/song/start_playing` | Start playback |
| `/live/song/stop_playing` | Stop playback |
| `/live/song/get/tempo` | Query tempo |
| `/live/song/set/tempo <bpm>` | Set tempo |
| `/live/song/get/current_song_time` | Get position |
| `/live/song/set/record_mode <0\|1>` | Record mode |

### Tracks
| OSC Address | Description |
|---|---|
| `/live/song/get/num_tracks` | Track count |
| `/live/track/get/name <idx>` | Track name |
| `/live/track/set/volume <idx> <vol>` | Set volume |
| `/live/track/set/mute <idx> <0\|1>` | Set mute |
| `/live/track/set/solo <idx> <0\|1>` | Set solo |

### Clips
| OSC Address | Description |
|---|---|
| `/live/clip/fire <t> <c>` | Fire clip |
| `/live/clip/stop <t> <c>` | Stop clip |
| `/live/clip/get/notes <t> <c>` | Get MIDI notes |
| `/live/clip/add/notes <t> <c> ...` | Add MIDI note |

### Devices
| OSC Address | Description |
|---|---|
| `/live/device/get/name <t> <d>` | Device name |
| `/live/device/get/parameter/value <t> <d> <p>` | Param value |
| `/live/device/set/parameter/value <t> <d> <p> <v>` | Set param |

## Live Object Model (LOM) Paths

For Max for Live integration, the corresponding LOM paths are:

| CLI Target | LOM Path |
|---|---|
| Track N | `live_set tracks N` |
| Master Track | `live_set master_track` |
| Return Track N | `live_set return_tracks N` |
| Clip Slot | `live_set tracks N clip_slots M` |
| Clip | `live_set tracks N clip_slots M clip` |
| Device | `live_set tracks N devices M` |
| Mixer Volume | `live_set tracks N mixer_device volume` |
| Scene | `live_set scenes N` |
| Selected Track | `live_set view selected_track` |
| Selected Scene | `live_set view selected_scene` |

## Troubleshooting

```bash
# Verify AbletonOSC is responding
ableton session connect
ableton session status

# If timeout errors: ensure AbletonOSC is enabled in Ableton's
# Preferences > Link/Tempo/MIDI > Control Surface

# Port conflict (another process on 11001)
netstat -ano | findstr :11001
# Use custom ports:
ableton session connect --recv-port 11002

# Test with raw OSC
python -c "
from pythonosc import udp_client
c = udp_client.SimpleUDPClient('127.0.0.1', 11000)
c.send_message('/live/song/get/tempo', None)
print('Sent tempo query')
"
```
