# cli-anything-max — Software-Specific SOP

## Scope & Status

This document is the Max-specific analysis and SOP for `cli-anything-max`,
following the general methodology in `~/.claude/plugins/cli-anything/HARNESS.md`.

**Target**: Cycling '74 Max 9 (tested against 9.1.3 build `09eb4ab`).
**Tier**: B (Core) — file layer + launch + OSC control patch + audio render + E2E.

## Phase 1 — Analysis (adapted for closed-source)

HARNESS.md Phase 1 ("codebase analysis") assumes an open-source backend. Max 9 is
closed-source, so analysis reverse-engineers **file formats** and catalogs
**scripting / control surfaces** instead of reading source.

### File formats (the data layer)

| Format | Container | Payload | Reader/Writer |
|---|---|---|---|
| `.maxpat` | plain | JSON | `core/patch.py` |
| `.amxd` (Max for Live device) | `ampf` binary wrapper | JSON patcher | `core/device.py` |
| `.maxhelp` | plain | JSON (same schema as .maxpat) | reuses `core/patch.py` |
| `.mxt` (Max text collection) | plain | text | not supported |
| `.json` (Max snapshot / preset) | plain | JSON | not supported |

#### .maxpat schema (minimum viable patcher)

```json
{
  "patcher": {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 0, "revision": 13, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [0, 0, 640, 480],
    "default_fontsize": 12,
    "default_fontname": "Arial",
    "boxes": [
      {"box": {"id": "obj-1", "maxclass": "newobj", "text": "print", "patching_rect": [20, 20, 50, 22], "numinlets": 1, "numoutlets": 0}}
    ],
    "lines": []
  }
}
```

Key invariants enforced by `core/patch.py`:
- Every box has `id` (stable string like `obj-N`), `maxclass`, `patching_rect`.
- Every `newobj` has `text`, `numinlets`, `numoutlets`.
- `lines[i].patchline.source = [src_id, src_outlet]`, `destination = [dst_id, dst_inlet]`.
- IDs referenced in `lines` must exist in `boxes`.

#### .amxd `ampf` binary format

```
offset  size  content
0       4     b'ampf'
4       4     uint32 LE = 4
8       8     b'mmmmmeta'
16      4     uint32 LE = 4        (meta length)
20      4     uint32 LE = 1        (meta version)
24      4     b'ptch'
28      4     uint32 LE = N        (patcher JSON length)
32      N     UTF-8 patcher JSON
```

Ported from `~/colab/CLAUDE.md` reference. Implemented in `core/device.py`
as `read_amxd(path)` and `write_amxd(patcher_dict, path)`.

### Control surfaces (the "real software" call sites)

Max 9 has **no `--headless --convert-to` style flags**. Driving Max from a
CLI requires one of these surfaces:

| Surface | Transport | Used by this CLI |
|---|---|---|
| `Max.exe <patch>` | process launch | `core/launch.py launch_edit()` |
| `MaxRT.exe <patch>` | process launch (runtime, no editor UI) | `core/launch.py launch_runtime()` |
| `MaxRT_nocef.exe <patch>` | process launch (runtime without Chromium) | `core/launch.py launch_headless()` |
| OSC/UDP to `[udpreceive N]` in a running patch | UDP | `core/control.py` + control patch |
| LiveAPI (Max for Live only) | JS in patch | not in tier B |
| `mxj`, `node.script`, `js` objects | in-patch scripting | used by control patch dispatcher |
| `gen~` codegen | Max menu / JS | not in tier B |
| `rnbo.export` | Max menu / JS | not in tier B |

### Backend discovery

`utils/max_backend.py::find_max_exe(prefer='runtime_nocef')` searches in this
order:
1. Environment variable `MAX_EXE` (absolute path override)
2. `C:\Program Files\Cycling '74\Max N\{MaxRT_nocef,MaxRT,Max}.exe` for N in [10, 9, 8]
3. `/Applications/Max.app/Contents/MacOS/Max` (macOS)
4. `shutil.which('Max')` as last resort

Raises `MaxNotInstalledError` with clear install instructions if nothing found.

## Phase 2 — Architecture

### Command groups

```
max patch      .maxpat file operations (no Max running required)
  new          create empty .maxpat
  info         list boxes, connections, args (human or --json)
  add-object   add a newobj to a patcher
  connect      wire two objects via patchline
  save         write patcher to .maxpat
  to-amxd      wrap a .maxpat as .amxd (M4L device)
  from-amxd    extract .maxpat JSON from .amxd
  diff         structural diff between two patchers (box/line adds/removes)

max device     .amxd operations (ampf binary)
  build        build .amxd from a .maxpat file
  extract      extract .maxpat JSON from .amxd
  validate     check ampf structure

max launch     subprocess launch of Max
  edit <patch>          Max.exe <patch>
  runtime <patch>       MaxRT.exe <patch>
  headless <patch>      MaxRT_nocef.exe <patch> (preferred for E2E tests)

max control    OSC over UDP to a loaded control patch
  connect               ping + wait for pong (verifies patch is up)
  eval <obj> <msg...>   send Max message to a named receive
  js <code>             run JS in the dispatcher's js object, return result
  osc <addr> <args...>  raw OSC send to the control port
  query <key>           ask the dispatcher for state (dsp, sr, patch, etc.)

max render     audio / image / symbolic render via control patch
  audio <out.wav> --duration <sec>   offline render to .wav
  (image/midi/gen/rnbo are stubs in tier B, not implemented)

max session    in-REPL state
  new, save, load, undo, redo, status
```

Running `cli-anything-max` with no subcommand drops into the REPL
(`invoke_without_command=True`), per HARNESS.md rule.

### Control patch design

`data/cli_anything_max_control.maxpat` ships with the package and is loaded
by `launch headless` for E2E tests (and by anyone who wants to drive Max
from the CLI). It contains:

- `[loadbang]` → `[; dsp set 1]` (enable DSP globally on load)
- `[udpreceive 8002]` → `[js cli_anything_max_dispatcher.js @autowatch 1]`
- Dispatcher JS outlets:
  - 0 → `[prepend /cli]` → `[udpsend 127.0.0.1 8003]` (responses)
  - 1 → `[*~ ...]` gain stage for the test oscillator
  - 2 → `[sfrecord~ 1]` (record control: open, 1, 0)
  - 3 → `[print debug]`
- Audio chain: `[cycle~ 440]` → `[*~ 0.0]` → `[sfrecord~ 1]` and `[dac~]`
  (gain starts at 0 so the test patch is silent unless rendering).

Port allocation:
- **8002** = control patch listens (CLI → Max)
- **8003** = dispatcher replies (Max → CLI)
- **8001** is reserved for colab / CoLaB device — do not collide.

### Dispatcher protocol

Messages are plain text lines delimited by whitespace. The dispatcher treats
the first token as the command name and the rest as args:

| In (→ 8002) | Out (← 8003) | Side effect |
|---|---|---|
| `ping` | `pong <epoch_ms>` | — |
| `query dsp` | `dsp <0/1>` | — |
| `query sr` | `sr <samplerate>` | — |
| `query patch` | `patch <name>` | — |
| `render audio <abs_path> <dur_ms>` | `render-start <path>` then `render-complete <path> <bytes>` | opens sfrecord~, unmutes gain, records, closes |
| `js <code>` | `js-result <value>` | `eval` inside the dispatcher |
| `eval <obj> <msg...>` | `eval-ok` \| `eval-err <reason>` | forward to named `[receive obj]` |
| `shutdown` | `bye` | `[thispatcher quit]` |

## Phase 3 — Implementation notes

- All path handling uses `pathlib.Path` and `.resolve()` before passing to
  Max, because Max on Windows does not accept forward-slash paths in all
  contexts.
- `core/launch.py` stores the `Popen` handle; the CLI wires SIGINT → clean
  `control shutdown` + `proc.wait(timeout=5)` + `proc.kill()` fallback.
- `core/control.py` uses a background `BlockingOSCUDPServer` thread to
  receive replies, with a `reply_queue: queue.Queue` for sync waits.
- `core/render.py audio()` computes expected `.wav` size from
  `duration * samplerate * bytes_per_sample * channels + 44` (RIFF/WAV
  header) and asserts the recorded file is within ±10% of that estimate.

## Phase 4–6 — Tests

See `cli_anything/max/tests/TEST.md`.

## Phase 7 — Install

```bash
cd ~/colab/max-cli
python -m pip install -e .
cli-anything-max --help
```

If `import cli_anything.max` fails after install, the most likely cause is
another cli-anything-* package shipping `cli_anything/__init__.py` (blocking
PEP 420). Remove that file and reinstall. See README.md "Namespace conflict".

## Known gaps vs HARNESS.md Tier C

Tier B **deliberately skips**:
- Image render (`jit.savepic`), MIDI export (`seq`), `gen~` codegen, `rnbo` export
- Full undo/redo stack in `session.py` (only last-state)
- Round-trip GUI test (open CLI-built patch in Max editor, verify correctness)
- True CI pipeline with `CLI_ANYTHING_FORCE_INSTALLED=1`

These are tracked as TODOs in `README.md`.
