# cli-anything-max — Test Plan and Results

## 1. Test Inventory

| File | Kind | Count | Depends on Max running? |
|---|---|---|---|
| `test_core.py` | unit | ~18 | no |
| `test_full_e2e.py` | E2E + subprocess | ~6 | **yes** (tier B only — uses `MaxRT_nocef.exe`) |

Unit tests use synthetic data and exercise every data-layer function. E2E
tests launch the real `MaxRT_nocef.exe` with the shipped control patch and
verify a true audio render lands on disk with a valid RIFF/WAV header.

Per HARNESS.md "No graceful degradation": the E2E tests are gated behind
`@pytest.mark.e2e` so `pytest -m 'not e2e'` runs unit-only. In CI or for
release testing, run with `pytest -m e2e` — if Max is missing the tests
fail, not skip.

## 2. Unit Test Plan

### `core/patch.py`
- `new_patcher()` returns a dict with the correct top-level shape.
- `add_object` with auto-id assigns `obj-1`, then `obj-2`, etc.
- `add_object` with explicit id that already exists raises `PatcherError`.
- `connect` with both ids present appends a patchline.
- `connect` with missing source raises `PatcherError`.
- `connect` with out-of-range outlet raises `PatcherError`.
- `remove_box` removes the box AND all lines touching it.
- `patcher_info` returns a structure with boxes/lines/objects/wires.
- `patcher_diff` detects added/removed boxes and wires.
- Round-trip: write → read returns structurally equivalent dict.

### `core/device.py`
- `write_amxd` → `read_amxd` round-trip preserves the patcher dict.
- `validate_amxd` returns correct `bytes`, `boxes`, `lines`, `appversion`.
- `read_amxd` on a file missing the `ampf` magic raises `AmxdError`.
- `read_amxd` on a file with a truncated ptch chunk raises `AmxdError`.
- `write_amxd` refuses a dict without a top-level `patcher` key.

### `utils/max_backend.py`
- `find_max_exe()` returns a real path on this machine (Max 9 installed).
- `find_max_exe()` honors a valid `MAX_EXE` override.
- `find_max_exe()` with an invalid `MAX_EXE` raises `MaxNotInstalledError`.
- `max_install_info()` returns a dict containing `platform` and at least
  one flavor resolving to a real path.

## 3. E2E Test Plan

### `TestMaxControlPatch`
Fixture launches `MaxRT_nocef.exe` with the shipped control patch once
per class. Polls `/ping` until the dispatcher responds (up to 30s).
Terminates the Max process during teardown.

- `test_ping` — send `/ping`, expect `/pong` with a reasonable round-trip.
- `test_query_sr` — expect `/query/sr` → 44100.
- `test_query_patch` — expect `/query/patch` → "cli_anything_max_control".

### `TestAudioRender`
Reuses the same running-Max fixture. Renders 1 second to a temp `.wav`
and verifies:
- File exists on disk
- Size is within ±20% of expected (~88244 bytes for 1s mono 16-bit @ 44.1k)
- RIFF/WAVE magic bytes are present
- `render_audio()` returns the expected dict
- Artifact path is printed to stdout for manual inspection

### `TestCLISubprocess` (runs the real installed command)
Uses `_resolve_cli("cli-anything-max")` to invoke the installed entry
point. No running Max needed — these exercise the file-layer commands
through the subprocess boundary.

- `test_help` — `--help` exits 0.
- `test_doctor_json` — `--json doctor` returns valid JSON with `platform`.
- `test_patch_new_and_info_json` — create a new patch, then `patch info`
  JSON-decodes and has 0 boxes + 0 lines.
- `test_patch_full_workflow` — new → add-object → add-object → connect →
  info → diff against original, all via subprocess.
- `test_patch_to_amxd_roundtrip` — wrap a .maxpat as .amxd, unwrap,
  structural equivalence.

## 4. Realistic Workflow Scenarios

### Workflow: "Build a sine-wave M4L device from scratch via CLI"
Simulates an agent authoring a minimal M4L audio effect without opening Max.

Operations chained:
1. `patch new /tmp/sine.maxpat`
2. `patch add-object ... --text "cycle~ 440" --outlets 1`
3. `patch add-object ... --text "dac~" --inlets 2 --outlets 0`
4. `patch connect /tmp/sine.maxpat cycle 0 dac 0`
5. `patch to-amxd /tmp/sine.maxpat /tmp/Sine.amxd`
6. `device validate /tmp/Sine.amxd`

Verified: .amxd file size > 0, ampf magic present, 2 boxes in patcher,
1 line, re-reading the amxd gives back a patcher dict structurally
equivalent to step 4.

### Workflow: "Render a known tone to a wav and verify it"
Simulates the primary "use the real software" validation loop.

Operations chained:
1. `launch headless --control-patch` (via fixture)
2. `control connect` (poll until /pong)
3. `render audio /tmp/render.wav --duration 1`
4. Verify on-disk output.

Verified: RIFF header, size within 20% of expected, path echoed for
inspection.

## 5. Test Results

Populated by Phase 6 (`pytest -v --tb=short` output, appended after
implementation). **See below.**

---

<!-- RESULTS_BELOW -->

### Run 2 — MIDI render added, module-scope fixture

After the tier-B run we added MIDI export via `[seq]` and changed the
`running_max` fixture from class-scope to module-scope so the whole E2E
suite launches Max exactly once. Test count grew from 35 → 37; wall
clock dropped from 18.93 s → 14.67 s.

```
============================= test session starts =============================
platform win32 -- Python 3.13.5, pytest-9.0.2, pluggy-1.6.0
collected 37 items

cli_anything/max/tests/test_core.py ........... (25 unit tests) .............. PASSED
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_ping PASSED
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_query_sr PASSED
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_query_patch PASSED
cli_anything/max/tests/test_full_e2e.py::TestAudioRender::test_one_second_wav PASSED
cli_anything/max/tests/test_full_e2e.py::TestMidiRender::test_c_major_riff_mid PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_help PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_version PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_doctor_json PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_new_and_info_json PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_full_workflow PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_render_midi_subprocess PASSED
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_to_amxd_roundtrip PASSED

============================= 37 passed in 14.67s =============================
```

New real artifact produced:

- File: `riff.mid` (and `sub.mid` from the subprocess test)
- Size: **40 bytes** — minimal valid SMF
- Header: `MThd` + 6-byte length + format=0 + tracks=1 + division=960
- Body: `MTrk` chunk with delta-timed note events from the 4-note riff
- Inspected manually during the probe:
  `b'MThd\x00\x00\x00\x06\x00\x00\x00\x01\x03\xc0MTrk\x00\x00\x00\x12\x82 \x90\x90\x90\x83\`\x80\x10\x00'`

This proves the Max `[seq]` pipeline records the JS-scheduled notes
and writes a conforming SMF file via `write <path>`. The same dispatcher
pattern can be reused for any future per-object file-producing render
(gen~, rnbo, jit.savepic, etc.).

### Run 1 — Tier B baseline

Command:

```bash
cd ~/colab/max-cli
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 CLI_ANYTHING_FORCE_INSTALLED=1 \
    python -m pytest cli_anything/max/tests/ -v --tb=short
```

`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` is required in this conda env because an
unrelated broken install of `langsmith`/`pydantic` prevents pytest plugin
autoload. Our tests do not rely on any third-party plugin.

Output:

```
============================= test session starts =============================
platform win32 -- Python 3.13.5, pytest-9.0.2, pluggy-1.6.0
rootdir: C:\Users\Owner\colab\max-cli
collected 35 items

cli_anything/max/tests/test_core.py::TestNewPatcher::test_has_required_envelope PASSED [  2%]
cli_anything/max/tests/test_core.py::TestNewPatcher::test_dimensions_applied PASSED [  5%]
cli_anything/max/tests/test_core.py::TestAddObject::test_auto_id_sequence PASSED [  8%]
cli_anything/max/tests/test_core.py::TestAddObject::test_explicit_id PASSED [ 11%]
cli_anything/max/tests/test_core.py::TestAddObject::test_duplicate_id_raises PASSED [ 14%]
cli_anything/max/tests/test_core.py::TestAddObject::test_outlet_count_default PASSED [ 17%]
cli_anything/max/tests/test_core.py::TestConnect::test_valid_connect_appends_line PASSED [ 20%]
cli_anything/max/tests/test_core.py::TestConnect::test_missing_source_raises PASSED [ 22%]
cli_anything/max/tests/test_core.py::TestConnect::test_missing_dest_raises PASSED [ 25%]
cli_anything/max/tests/test_core.py::TestConnect::test_out_of_range_outlet_raises PASSED [ 28%]
cli_anything/max/tests/test_core.py::TestConnect::test_out_of_range_inlet_raises PASSED [ 31%]
cli_anything/max/tests/test_core.py::TestRemoveBox::test_removes_box_and_touching_lines PASSED [ 34%]
cli_anything/max/tests/test_core.py::TestRemoveBox::test_missing_box_returns_false PASSED [ 37%]
cli_anything/max/tests/test_core.py::TestPatcherInfo::test_returns_structured_summary PASSED [ 40%]
cli_anything/max/tests/test_core.py::TestPatcherDiff::test_additions_and_removals PASSED [ 42%]
cli_anything/max/tests/test_core.py::TestPatcherRoundTrip::test_write_read_preserves_structure PASSED [ 45%]
cli_anything/max/tests/test_core.py::TestAmxd::test_write_read_round_trip PASSED [ 48%]
cli_anything/max/tests/test_core.py::TestAmxd::test_validate_returns_expected_fields PASSED [ 51%]
cli_anything/max/tests/test_core.py::TestAmxd::test_bad_magic_raises PASSED [ 54%]
cli_anything/max/tests/test_core.py::TestAmxd::test_truncated_chunk_raises PASSED [ 57%]
cli_anything/max/tests/test_core.py::TestAmxd::test_missing_patcher_key_raises PASSED [ 60%]
cli_anything/max/tests/test_core.py::TestMaxBackend::test_find_max_exe_on_this_machine PASSED [ 62%]
cli_anything/max/tests/test_core.py::TestMaxBackend::test_env_override_honored PASSED [ 65%]
cli_anything/max/tests/test_core.py::TestMaxBackend::test_invalid_env_override_raises PASSED [ 68%]
cli_anything/max/tests/test_core.py::TestMaxBackend::test_install_info_has_platform PASSED [ 71%]
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_ping PASSED [ 74%]
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_query_sr PASSED [ 77%]
cli_anything/max/tests/test_full_e2e.py::TestMaxControlPatch::test_query_patch PASSED [ 80%]
cli_anything/max/tests/test_full_e2e.py::TestAudioRender::test_one_second_wav PASSED [ 82%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_help PASSED [ 85%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_version PASSED [ 88%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_doctor_json PASSED [ 91%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_new_and_info_json PASSED [ 94%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_full_workflow PASSED [ 97%]
cli_anything/max/tests/test_full_e2e.py::TestCLISubprocess::test_patch_to_amxd_roundtrip PASSED [100%]

============================= 35 passed in 18.93s =============================
```

### Summary (Run 1)

- **35 / 35 passing** (100%)
- **Unit tests** (test_core.py): 25
- **E2E true-backend tests** (TestMaxControlPatch + TestAudioRender): 4
- **CLI subprocess tests** (TestCLISubprocess): 6
- **Execution time**: 18.93 s (most spent waiting for `MaxRT_nocef.exe` to boot)

### Real artifact produced (per HARNESS.md requirement)

The audio render test wrote a genuine 1-second sine tone to disk:

- File: `tone.wav` in the pytest tmp dir
- Size: **88,168 bytes** (expected ~88,244 for 1 s mono int16 @ 44.1 kHz)
- Header bytes 0–3: `RIFF`
- Header bytes 8–11: `WAVE`
- Inspected manually during the debug probe: header
  `b'RIFF`X\\x01\\x00WAVE'` — valid RIFF/WAVE.

This proves the CLI is driving the real Max binary, not a reimplemented
Python fake.

### Coverage notes / known gaps

- `core/session.py` is a minimal stub in tier B (only `status`) — no unit tests.
- REPL default-mode behavior is exercised only manually (no test yet).
- `launch edit` / `launch runtime` are wired but untested (only `headless`
  is exercised by E2E — launching the full editor would keep Max open
  indefinitely during CI).
- `render` image/midi/gen/rnbo are deliberately omitted (tier C).
- No round-trip GUI test (open CLI-built patch in Max editor, verify
  correctness by hand) — tier C.

