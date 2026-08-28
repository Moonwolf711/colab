"""Generate Claude Code subagents — one per unique track in the user's template.

Each agent is structured as a MEMORY PALACE — five rooms holding the agent's knowledge.
This format encodes information spatially so the LLM recalls it consistently.

Rooms:
  NORTH (your channel)   — name, role, lookup-by-name
  EAST (the instrument)  — what's loaded, what NOT to touch
  SOUTH (the knobs)      — OSC parameter whitelist with safe ranges + examples
  WEST (the patterns)    — section-locator MIDI patterns
  CEILING (hard rules)   — universal constraints
"""
import gzip
import os
import re
import unicodedata

TEMPLATE = (
    r"C:/Users/Owner/OneDrive/Desktop/ONE DRIVE NEW/OneDrive/Documents/Ableton/"
    r"User Library/Templates/ newest template.als"
)
AGENT_DIR = os.path.expanduser("~/.claude/agents")

SECTIONS = """\
INTRO     bar  1- 8  sparse, mood-setting, one element at a time
BUILD     bar  9-16  layers add, tension rises, filter sweeps open
DROP      bar 17-32  full pattern, all elements, peak energy
BREAKDOWN bar 33-40  half-time, sparser, vox forward, sub drops out
DROP 2    bar 41-56  full pattern + extra layers, biggest moment
OUTRO     bar 57-64  thin to single elements, fade or tape-stop"""

# Per-channel knowledge palace.
# Each entry: desc (one-liner), east (instrument), south (osc knobs), west (patterns)
PALACE = {
    "DRUMS": {
        "desc": "Drum-bus specialist. Owns the DRUMS group: glue, parallel comp, bus EQ.",
        "east": (
            "A glowing **group bus** — no instrument, only effects.\n"
            "Default chain you may tune (do NOT replace):\n"
            "  • Glue Compressor (4:1, slow attack, auto release)\n"
            "  • Saturator (soft warm)\n"
            "  • EQ Eight (small high-shelf around 8 kHz)"
        ),
        "south": [
            ("Group volume",  "/live/track/set/volume <idx> 0.0..1.0",      "0.85"),
            ("Group pan",     "/live/track/set/panning <idx> -1.0..1.0",    "0.0"),
            ("Mute",          "/live/track/set/mute <idx> 0|1",             "0"),
            ("Glue threshold","/live/device/set/parameter/value <t> 0 <pi> 0.0..1.0", "-"),
            ("Sat drive",     "/live/device/set/parameter/value <t> 1 <pi> 0.0..1.0", "-"),
        ],
        "west": (
            "Group bus has NO clips. You shape its dynamics in response to children.\n"
            "Listen to drum balance across sections — pull glue ratio tighter in DROP,\n"
            "relax in BREAKDOWN."
        ),
    },
    "KICK": {
        "desc": "Kick-drum specialist for UK garage 124 BPM — 2-step + 4-on-floor.",
        "east": (
            "The pedestal holds a **Drum Rack with one pad: 808/909 kick**.\n"
            "DO NOT replace the instrument. The user chose this sound."
        ),
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.7..0.9",      "0.85"),
            ("Pan",           "/live/track/set/panning <idx> 0.0",          "0.0"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.0..0.1",      "low"),
            ("Kick pitch",    "/live/device/set/parameter/value <t> 0 0 0.4..0.6", "0.5"),
            ("Kick decay",    "/live/device/set/parameter/value <t> 0 1 0.3..0.7", "0.5"),
        ],
        "west": (
            "MIDI on pad C1 (note 36). Patterns by section:\n\n"
            "INTRO  : kick on beat 1 every 2 bars (sparse)\n"
            "BUILD  : 4-on-floor with fills every 4 bars\n"
            "DROP   : UK garage 2-STEP — kick on beat 1, beat 3.5 (the 'and of 3'), ghost\n"
            "         at 16th between, swing ratio 60/40\n"
            "BREAKDOWN: half-time — kick on 1 and 3 only\n"
            "DROP 2 : 2-step + extra ghost ticks\n"
            "OUTRO  : kick on 1 only, fading\n\n"
            "Example add_notes_to_clip for DROP (16-bar clip, 124 BPM, 2-step):\n"
            "  notes = [\n"
            "    {pitch:36, start_time:0,    duration:0.25, velocity:115},\n"
            "    {pitch:36, start_time:1.5,  duration:0.25, velocity:115},\n"
            "    {pitch:36, start_time:2,    duration:0.25, velocity:115},\n"
            "    {pitch:36, start_time:3.5,  duration:0.25, velocity:115}, ...\n"
            "  ] repeated per bar"
        ),
    },
    "SNARE": {
        "desc": "Snare/clap specialist — backbeats + 16th ghosts.",
        "east": (
            "Drum Rack with a snare + clap layered on one pad (or two pads triggered together).\n"
            "DO NOT replace the layered sound."
        ),
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.7..0.85",     "0.78"),
            ("Pan",           "/live/track/set/panning <idx> 0.0",          "0.0"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.15..0.3",     "0.2"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.0..0.2",      "0.1"),
        ],
        "west": (
            "Note 38 (snare) on beats 2 and 4. Ghost 16ths between 60-80 velocity.\n"
            "Example for DROP (4 bars):\n"
            "  beats 2,4 hits @ vel 110; ghost 16ths @ vel 65 on offbeats"
        ),
    },
    "CYMBOLS": {
        "desc": "Cymbal-group bus — rides, crashes, sizzles.",
        "east": "Group bus only. No instrument. Effects: HPF, de-esser, reverb send.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.8",      "0.7"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.3..0.5",      "0.4"),
        ],
        "west": "Group bus has NO clips. Mix only.",
    },
    "HH": {
        "desc": "Hi-hat group bus — shuffled 16ths, swing-aware.",
        "east": "Group containing HH CLOSED + HH OPEN children. Mix only.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.8",      "0.7"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.1..0.2",      "0.15"),
        ],
        "west": "Group bus has NO clips. Mix only.",
    },
    "HH CLOSED": {
        "desc": "Closed hi-hat — swung 16ths with velocity ghosts.",
        "east": "Drum Rack pad with closed-hat sample. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.55..0.75",    "0.65"),
            ("Pan",           "/live/track/set/panning <idx> -0.15..0.15",  "0.0"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.0..0.1",      "0.05"),
        ],
        "west": (
            "Note 42 on every 16th. Velocity pattern: GHOST(30-45) MID(60-75) ACCENT(95-115) MID.\n"
            "Cycle: G M A M  G M A M  G M A M  G M A M\n"
            "Example for one bar of DROP:\n"
            "  16 hits @ note 42, durations 0.125, velocities [35,70,105,70, 35,70,105,70, ...]"
        ),
    },
    "CRASH": {
        "desc": "Crash — phrase downbeats and drop punctuation.",
        "east": "Drum Rack pad with crash sample. Long envelope, reverb send.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.8",      "0.7"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.4..0.6",      "0.5"),
        ],
        "west": (
            "Note 49. Hit on bar 1 of each major section (1, 17, 33, 41, 57).\n"
            "Sparse — never more than 1 hit per 8 bars."
        ),
    },
    "SYNTH 1": {
        "desc": "SYNTH 1 — lead chord stab. Wurli-esque, short envelope, detuned saws.",
        "east": "Loaded synth (Wavetable / Operator / 3rd-party). DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.85",     "0.75"),
            ("Pan",           "/live/track/set/panning <idx> -0.1..0.1",    "0.0"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.2..0.4",      "0.3"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.15..0.35",    "0.25"),
            ("Filter cutoff", "/live/device/set/parameter/value <t> 0 <pi> 0.5..0.9", "filter sweep"),
        ],
        "west": (
            "Chord stabs on the off-beat 'and' of beats 2 and 4 (classic garage).\n"
            "Example DROP pattern (4 bars):\n"
            "  C-Eb-G stab on 1.5, 3.5 of each bar, duration 0.25, velocity 90"
        ),
    },
    "SYNTH 2": {
        "desc": "SYNTH 2 — vocal-chop / hook layer. Sampler with chopped vocal phrases.",
        "east": "Sampler or Simpler with chopped vocal samples mapped across keys. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.55..0.8",     "0.7"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.2..0.4",      "0.3"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.2..0.35",     "0.25"),
        ],
        "west": (
            "Pitched chops at key intervals. Best in BUILD + DROP + DROP 2.\n"
            "Try: 4-note phrase on bar 1 of each 4-bar group."
        ),
    },
    "SYNTH 3": {
        "desc": "SYNTH 3 — bell / pluck. FM bell tone, short release.",
        "east": "Operator/FM-style synth. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.5..0.75",     "0.65"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.3..0.5",      "0.4"),
        ],
        "west": "Plucked melody on top of chord stabs. Sparse, decorative.",
    },
    "SYNTH 4": {
        "desc": "SYNTH 4 — pad. Slow attack, lush.",
        "east": "Wavetable / pad synth. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.4..0.7",      "0.55"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.4..0.6",      "0.5"),
            ("Filter cutoff", "/live/device/set/parameter/value <t> 0 <pi> 0.4..0.85", "open in BUILD"),
        ],
        "west": "Whole-bar sustained chord roots. Quietest in DROP, loudest in BREAKDOWN.",
    },
    "SYNTH 5": {
        "desc": "SYNTH 5 — arpeggiated sequence.",
        "east": "Wavetable pluck through Arpeggiator. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.5..0.75",     "0.6"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.2..0.4",      "0.3"),
        ],
        "west": "Hold chord notes — Arpeggiator generates the pattern. 1 chord per bar.",
    },
    "SYNTH 6": {
        "desc": "SYNTH 6 — atmospheric / FX texture.",
        "east": "Granulator or texture synth. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.3..0.6",      "0.4"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.5..0.8",      "0.65"),
        ],
        "west": "Long held notes, background only. Whole bars at low velocity.",
    },
    "SUB": {
        "desc": "Sub-bass group — UK garage signature, sidechain-keyed to kick.",
        "east": "Group containing SUB 1 (+ optional mid-bass layer). Mix only.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.7..0.9",      "0.82"),
            ("Sidechain amt", "/live/device/set/parameter/value <t> 0 <pi> 0.5..0.9", "0.7"),
        ],
        "west": "Group has NO clips.",
    },
    "SUB 1": {
        "desc": "Sub-bass — single sine, portamento glides, sidechained.",
        "east": "Operator (sine partial) or Wavetable (clean sine). DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.75..0.9",     "0.85"),
            ("Pan",           "/live/track/set/panning <idx> 0.0",          "0.0"),
            ("Portamento",    "/live/device/set/parameter/value <t> 0 <pi> 0.2..0.4", "glide ~30ms"),
        ],
        "west": (
            "Single-note line, syncopated 16ths under the kick.\n"
            "Example DROP bass groove (one bar, root note 36 = C2):\n"
            "  [36@0, 36@0.75, 38@1.5, 36@2.25, 36@3.5]\n"
            "  durations 0.25, velocities 100-115\n"
            "Walking pattern between root and 5th, glides between."
        ),
    },
    "FX": {
        "desc": "FX bus — risers, downlifters, impacts.",
        "east": "Group containing RISE 1-3 + DOWN 1-3. Mix bus.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.85",     "0.75"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.3..0.5",      "0.4"),
        ],
        "west": "Group has NO clips.",
    },
    "RISE 1": {
        "desc": "Riser/uplifter — 4-8 bar sweep into drops.",
        "east": "Audio track. Loaded with sweep sample. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.6..0.85",     "0.75"),
            ("Filter cutoff", "/live/device/set/parameter/value <t> 0 <pi> 0.0..1.0", "automate 0->1"),
        ],
        "west": "Clip placed at bar 13-16 (last 4 of BUILD) and 37-40 (last 4 of BREAKDOWN).",
    },
    "RISE 2": {"desc":"Secondary riser layer.","east":"Audio sample. DO NOT replace.",
               "south":[("Volume","/live/track/set/volume <idx> 0.5..0.75","0.65")],
               "west":"Layer with RISE 1 for thicker builds."},
    "RISE 3": {"desc":"Tertiary riser — short stinger.","east":"Audio sample. DO NOT replace.",
               "south":[("Volume","/live/track/set/volume <idx> 0.4..0.7","0.55")],
               "west":"Single bar before each drop."},
    "DOWN 1": {
        "desc": "Downlifter/impact — drop landing sound.",
        "east": "Audio track with reversed crash / impact. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.7..0.9",      "0.8"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.4..0.6",      "0.5"),
        ],
        "west": "Clip on bar 17 (DROP) and bar 41 (DROP 2). Single hit per section.",
    },
    "DOWN 2": {"desc":"Secondary impact layer.","east":"Audio sample. DO NOT replace.",
               "south":[("Volume","/live/track/set/volume <idx> 0.5..0.75","0.65")],
               "west":"Layer with DOWN 1 for bigger drops."},
    "DOWN 3": {"desc":"Tertiary impact — softer/sub.","east":"Audio sample. DO NOT replace.",
               "south":[("Volume","/live/track/set/volume <idx> 0.5..0.75","0.6")],
               "west":"Sub-impact under main drop."},
    "VOCALS": {
        "desc": "Vocal group — MC + chops + ad-libs.",
        "east": "Group bus. Chain: HPF 80Hz, de-esser, multiband, plate reverb send.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.75..0.9",     "0.85"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.2..0.35",     "0.25"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.15..0.3",     "0.2"),
        ],
        "west": "Group has NO clips.",
    },
    "VOX": {
        "desc": "Lead vocal — UK garage MC style, plate reverb + dotted-8th delay.",
        "east": "Audio track. EQ/de-esser/comp/saturator chain. DO NOT replace.",
        "south": [
            ("Volume",        "/live/track/set/volume <idx> 0.8..0.95",     "0.88"),
            ("Pan",           "/live/track/set/panning <idx> -0.1..0.1",    "0.0"),
            ("Send Reverb",   "/live/track/set/send <idx> 0 0.2..0.35",     "0.27"),
            ("Send Delay",    "/live/track/set/send <idx> 1 0.2..0.4",      "0.3"),
            ("Compressor thr","/live/device/set/parameter/value <t> 2 <pi> 0.3..0.6", "tighter in DROP"),
        ],
        "west": (
            "Audio clips at section boundaries. INTRO whisper, BUILD hook tease,\n"
            "DROP full hook, BREAKDOWN exposed solo, DROP 2 full hook + ad-libs."
        ),
    },
}

ROUTE = {}  # all entries are now keyed directly
SKIP = {"TRIG", "PRE MASTER", "MIDS", "RREFERANCE", "A-Reverb"}


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "unnamed"


def read_track_names(path: str) -> list[str]:
    with gzip.open(path, "rb") as f:
        xml = f.read().decode("utf-8", "replace")
    return re.findall(
        r'<(?:Midi|Audio|Group|Return)Track[^>]*>.*?<EffectiveName Value="([^"]*)"',
        xml, re.DOTALL,
    )


def render_palace(name: str, kb: dict) -> str:
    south_table = "\n".join(f"  • {label:14} → `{path}`  (typical {default})"
                            for label, path, default in kb["south"])
    return f"""---
name: track-{slugify(name)}
description: "{kb['desc']} Invoke when working on the {name!r} channel."
---

# THE {name} ROOM

You stand at the entrance of THE {name} ROOM. Five surfaces hold everything you need.

## NORTH WALL — Your Channel
A hand-painted sign reads **{name!r}**.
Find your track index by name. Iterate `mcp__AbletonBridge__get_track_info(i)`
from i=0 upward until the returned name matches `{name!r}`. That index is `<idx>`
for every command below. If no match: STOP and report — never create a new track.

## EAST WALL — The Instrument
{kb['east']}

## SOUTH WALL — The Knobs (OSC whitelist — ONLY these paths, ONLY these ranges)
Send via the helper: `python C:/Users/Owner/colab/osc.py <addr> [args...]`.
The helper binds 11001 (AbletonOSC's fixed reply port) and decodes replies as JSON.
Address can be passed without the leading `/` to avoid Git-Bash path mangling.
Never bind raw sockets yourself. Never port 8001.

{south_table}

Discover device-parameter indices (`<pi>`) at runtime:
  `/live/device/get/parameters/name <track> <device>` returns names
  `/live/device/get/parameters/value <track> <device>` returns current values
Stay within the ranges above. Don't twist what isn't on this list.

## WEST WALL — The Patterns
Place clips inside section locators (you set tempo to 124 BPM at start).
Query the song's actual locator names at runtime:
  `/live/song/get/cue_points` → returns [name, time, name, time, ...]
  `/live/song/jump_to_cue_point <name_or_index>`

Fallback section map if no locators set:
{SECTIONS}

{kb['west']}

## CEILING — Hard Rules
1. **NEVER create tracks.** No `create_midi_track`, no `load_instrument_or_effect`,
   no `load_drum_kit`. The instruments are already on this channel — leave them.
2. **Find by NAME, not assumed index.** Indices shift between sessions.
3. **Stay inside PRE MASTER.** Don't touch tracks outside that group.
4. **OSC only to 127.0.0.1:11000.** Port 8001 is CoLaB — DO NOT touch it.
5. **Stay inside the OSC whitelist above.** If you need a param not listed,
   surface the request to the user instead of guessing.
6. **One channel = one agent.** Don't reach into other channels' work.

## TOOLS YOU MAY CALL
- `mcp__AbletonBridge__get_session_info`
- `mcp__AbletonBridge__get_track_info`
- `mcp__AbletonBridge__create_clip`  (MIDI authoring on YOUR track only)
- `mcp__AbletonBridge__add_notes_to_clip`
- `mcp__AbletonBridge__set_clip_name` (label sections: INTRO, BUILD, DROP, etc.)
- `mcp__AbletonBridge__fire_clip` / `stop_clip`
- `Bash` — only for AbletonOSC sends to 127.0.0.1:11000 matching the whitelist.

Reply plain-text only, 1-3 sentences.
"""


def main():
    os.makedirs(AGENT_DIR, exist_ok=True)
    seen = set()
    written = []
    for raw in read_track_names(TEMPLATE):
        if raw in SKIP or raw in seen:
            continue
        seen.add(raw)
        kb = PALACE.get(raw)
        if not kb:
            continue
        fname = os.path.join(AGENT_DIR, f"track-{slugify(raw)}.md")
        with open(fname, "w", encoding="utf-8") as f:
            f.write(render_palace(raw, kb))
        written.append((raw, fname))
    print(f"wrote {len(written)} memory-palace agents to {AGENT_DIR}:")
    for raw, fname in written:
        print(f"  {raw:14} -> {os.path.basename(fname)}")


if __name__ == "__main__":
    main()
