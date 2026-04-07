# cli-anything-max

A CLI harness for **Cycling '74 Max 9**, built with the
[cli-anything](https://github.com/yourusername/cli-anything-plugin) methodology.

Drives Max from the command line for two use cases:

1. **Offline**: directly manipulate `.maxpat` and `.amxd` files (no running Max needed).
2. **Online**: launch a Max instance with a control patch and drive it over
   OSC/UDP (inspect state, evaluate JS, render audio).

## Status

Tier **B (Core)** per the plan in `~/tasks/cli-anything-max-plan.md`:

- [x] File layer: `.maxpat` read/write/build, `.amxd` `ampf` binary roundtrip
- [x] Launch layer: `Max.exe`, `MaxRT.exe`, `MaxRT_nocef.exe` subprocess control
- [x] Control layer: OSC/UDP to an authored control patch + dispatcher JS
- [x] Render layer: offline audio render to `.wav` via `sfrecord~`
- [x] Click CLI with REPL default mode and `--json` output
- [x] Unit + E2E tests (E2E launches real Max)
- [ ] Image / MIDI / gen~ / rnbo render (tier C)
- [ ] Full undo/redo in session (tier C)

## Prerequisites

- **Max 9** installed (Windows: `C:\Program Files\Cycling '74\Max 9\Max.exe`).
  The CLI is useless without Max — this is a hard dependency, not optional.
- **Python 3.10+**
- `click`, `python-osc`, `prompt-toolkit` (installed automatically via pip)

## Install

```bash
cd ~/colab/max-cli
python -m pip install -e .
cli-anything-max --help
```

## Namespace conflict with cli-anything-ableton

`cli_anything` is a **PEP 420 implicit namespace package** — it must NOT
contain an `__init__.py`. If you have an older `cli-anything-ableton` that
ships one, Python will treat `cli_anything` as a regular package and
`import cli_anything.max` will fail.

Fix:

```bash
rm ~/colab/ableton-cli/cli_anything/__init__.py
python -m pip install -e ~/colab/ableton-cli
# and/or
rm "$(python -c 'import sys; print([p for p in sys.path if p.endswith(\"site-packages\")][0])')/cli_anything/__init__.py"
```

This project's install step does both automatically (see `scripts/fix-namespace.sh`).

## Quick start

### Offline: build a patcher, wrap as M4L device

```bash
# Create a new .maxpat with a print object and a cycle~ 440
cli-anything-max patch new /tmp/sine.maxpat
cli-anything-max patch add-object /tmp/sine.maxpat --text "cycle~ 440" --id osc
cli-anything-max patch add-object /tmp/sine.maxpat --text "dac~" --id out --inlets 2 --outlets 0
cli-anything-max patch connect /tmp/sine.maxpat osc 0 out 0
cli-anything-max patch connect /tmp/sine.maxpat osc 0 out 1
cli-anything-max patch info /tmp/sine.maxpat

# Wrap as a Max for Live audio effect (.amxd)
cli-anything-max patch to-amxd /tmp/sine.maxpat /tmp/Sine.amxd

# Verify the ampf binary structure
cli-anything-max device validate /tmp/Sine.amxd
```

### Online: launch Max + control + render audio

```bash
# Launch headless Max with the shipped control patch
cli-anything-max launch headless --control-patch

# In another terminal: ping the dispatcher
cli-anything-max control connect            # expects "pong <epoch_ms>"
cli-anything-max control query dsp          # "dsp 1"

# Render 2 seconds of the control patch's 440 Hz sine to a wav
cli-anything-max render audio /tmp/render.wav --duration 2

# Verify
ls -la /tmp/render.wav
cli-anything-max control eval shutdown
```

### REPL

Running with no subcommand drops into the REPL:

```bash
cli-anything-max
◆ max ❯ patch new /tmp/x.maxpat
◆ max [/tmp/x.maxpat] ❯ add-object --text "print"
◆ max [/tmp/x.maxpat*] ❯ save
◆ max [/tmp/x.maxpat] ❯ quit
```

## JSON output

Every command supports `--json`:

```bash
cli-anything-max --json patch info /tmp/sine.maxpat
# {"file": "/tmp/sine.maxpat", "boxes": 3, "lines": 2, "objects": [...]}
```

## Running tests

```bash
cd ~/colab/max-cli
python -m pytest cli_anything/max/tests -v

# Subprocess tests against installed command
CLI_ANYTHING_FORCE_INSTALLED=1 python -m pytest cli_anything/max/tests -v -s
```

E2E tests launch the real `MaxRT_nocef.exe` with the control patch and
verify the `.wav` output has correct RIFF headers. **They will fail if Max
is not installed** — this is intentional, not a bug.

## Ports

| Port | Direction | Purpose |
|---|---|---|
| 8002 | CLI → Max | control patch `[udpreceive 8002]` |
| 8003 | Max → CLI | dispatcher replies `[udpsend 127.0.0.1 8003]` |

`8001` is reserved for `~/colab/` (CoLaB device) — do not collide.

## Layout

See `MAX.md` for the full architecture doc and `cli_anything/max/tests/TEST.md`
for the test plan and results.
