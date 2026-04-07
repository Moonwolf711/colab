"""E2E tests for cli-anything-max.

These tests are gated by ``@pytest.mark.e2e`` because they launch the
real ``MaxRT_nocef.exe`` with the shipped control patch and verify a
genuine audio render lands on disk with valid RIFF/WAV headers.

Per HARNESS.md: no graceful degradation. If Max is installed but the
patch fails to load or the dispatcher does not respond, these tests
FAIL — they do not skip. Use ``-m 'not e2e'`` to exclude them from a
pure unit run.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import pytest

from cli_anything.max import __version__
from cli_anything.max.core import control as control_mod
from cli_anything.max.core import launch as launch_mod
from cli_anything.max.core import render as render_mod
from cli_anything.max.utils.max_backend import MaxNotInstalledError, find_max_exe

PKG_DATA = Path(__file__).resolve().parent.parent / "data"
CONTROL_PATCH = PKG_DATA / "cli_anything_max_control.maxpat"


def _resolve_cli(name: str) -> list[str]:
    """Return the argv prefix for invoking the installed CLI, with a fallback.

    Set ``CLI_ANYTHING_FORCE_INSTALLED=1`` in the environment to require
    the console_scripts entry point (and fail the test if it is missing).
    """
    force = os.environ.get("CLI_ANYTHING_FORCE_INSTALLED", "").strip() == "1"
    exe = shutil.which(name)
    if exe:
        print(f"[_resolve_cli] Using installed command: {exe}")
        return [exe]
    if force:
        raise RuntimeError(
            f"{name} not found in PATH and CLI_ANYTHING_FORCE_INSTALLED=1. "
            f"Install with: pip install -e ."
        )
    print(f"[_resolve_cli] Falling back to: {sys.executable} -m cli_anything.max")
    return [sys.executable, "-m", "cli_anything.max"]


CLI_BASE = _resolve_cli("cli-anything-max")


# ── Running-Max fixtures ─────────────────────────────────────────────


@pytest.fixture(scope="module")
def running_max():
    """Launch MaxRT_nocef.exe with the shipped control patch.

    Polls ``/ping`` until the dispatcher responds (up to 30s), then
    yields the ``MaxProcess`` handle. Tears down at class end.
    """
    if not CONTROL_PATCH.exists():
        pytest.fail(f"control patch missing: {CONTROL_PATCH}")
    try:
        find_max_exe("runtime_nocef")
    except MaxNotInstalledError as e:
        pytest.fail(f"Max is required for E2E tests: {e}")

    proc = launch_mod.launch(flavor="runtime_nocef", patch=CONTROL_PATCH)
    print(f"\n[running_max] launched pid={proc.pid} exe={proc.exe}")

    # Poll for /pong up to 30 seconds.
    deadline = time.time() + 30.0
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        if not proc.is_running():
            pytest.fail(
                f"Max exited early with code {proc.popen.returncode} "
                f"before the dispatcher came up"
            )
        try:
            control_mod.ping(timeout_s=0.75)
            break
        except control_mod.MaxNotRespondingError as e:
            last_err = e
            time.sleep(0.5)
    else:
        proc.terminate()
        pytest.fail(f"Max did not respond to /ping within 30s (last: {last_err})")

    print(f"[running_max] dispatcher ready")
    yield proc

    print(f"[running_max] terminating pid={proc.pid}")
    proc.terminate()


@pytest.mark.e2e
class TestMaxControlPatch:
    def test_ping(self, running_max):
        result = control_mod.ping(timeout_s=2.0)
        assert result.ok
        assert result.round_trip_ms < 2000.0
        print(f"\n  ping: {result.round_trip_ms:.2f}ms rtt, patch_time={result.patch_time_ms}")

    def test_query_sr(self, running_max):
        result = control_mod.query("sr")
        assert result["value"] == 44100

    def test_query_patch(self, running_max):
        result = control_mod.query("patch")
        assert "cli_anything_max_control" in str(result["value"])


@pytest.mark.e2e
class TestAudioRender:
    def test_one_second_wav(self, running_max, tmp_path: Path):
        out = tmp_path / "tone.wav"
        result = render_mod.render_audio(out, duration_s=1.0)

        assert result["is_wav"] is True
        assert result["riff"] is True
        size = result["bytes"]
        # 1 sec @ 44.1 kHz mono int16 ≈ 88_200 samples + 44 byte header
        # Accept ±20% to leave headroom for different SRs / metadata.
        assert 60_000 < size < 120_000, f"unexpected wav size: {size}"

        print(f"\n  WAV: {result['path']} ({size:,} bytes)")

        # Double-check the magic bytes on disk (not just what render.py returns).
        with out.open("rb") as f:
            hdr = f.read(12)
        assert hdr[0:4] == b"RIFF"
        assert hdr[8:12] == b"WAVE"


@pytest.mark.e2e
class TestMidiRender:
    def test_c_major_riff_mid(self, running_max, tmp_path: Path):
        out = tmp_path / "riff.mid"
        result = render_mod.render_midi(out)

        assert result["is_midi"] is True
        assert result["mthd"] is True
        size = result["bytes"]
        # A minimal SMF with a few notes is on the order of 30-200 bytes.
        # We only require "plausibly an SMF with content" — strict event
        # counts depend on real-time scheduler jitter inside Max and are
        # not a useful stability target.
        assert 30 <= size <= 5000, f"unexpected mid size: {size}"

        print(f"\n  MID: {result['path']} ({size:,} bytes)")

        with out.open("rb") as f:
            hdr = f.read(14)
        # MThd + 6-byte length + format + tracks + division
        assert hdr[0:4] == b"MThd"
        assert hdr[4:8] == b"\x00\x00\x00\x06"
        fmt = int.from_bytes(hdr[8:10], "big")
        tracks = int.from_bytes(hdr[10:12], "big")
        division = int.from_bytes(hdr[12:14], "big")
        assert fmt in (0, 1, 2)
        assert tracks >= 1
        assert division > 0
        print(f"    SMF format={fmt} tracks={tracks} division={division}")

        # Also verify the MTrk chunk exists directly after the header.
        with out.open("rb") as f:
            all_bytes = f.read()
        assert b"MTrk" in all_bytes, "no MTrk chunk in file"


# ── Subprocess tests (no running Max required) ──────────────────────


class TestCLISubprocess:
    def _run(self, args: list[str], check: bool = True, **kw) -> subprocess.CompletedProcess:
        return subprocess.run(
            CLI_BASE + args,
            capture_output=True,
            text=True,
            check=check,
            **kw,
        )

    def test_help(self):
        result = self._run(["--help"])
        assert result.returncode == 0
        assert "cli-anything-max" in result.stdout.lower() or "usage" in result.stdout.lower()

    def test_version(self):
        result = self._run(["--version"])
        assert result.returncode == 0
        assert __version__ in result.stdout

    def test_doctor_json(self):
        result = self._run(["--json", "doctor"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert "platform" in data
        assert "control_patch" in data
        assert data["control_patch_exists"] is True

    def test_patch_new_and_info_json(self, tmp_path: Path):
        patch_path = tmp_path / "new.maxpat"
        r1 = self._run(["--json", "patch", "new", str(patch_path)])
        assert r1.returncode == 0
        d1 = json.loads(r1.stdout)
        assert d1["created"] is True

        r2 = self._run(["--json", "patch", "info", str(patch_path)])
        assert r2.returncode == 0
        d2 = json.loads(r2.stdout)
        assert d2["boxes"] == 0
        assert d2["lines"] == 0

    def test_patch_full_workflow(self, tmp_path: Path):
        patch_path = tmp_path / "sine.maxpat"
        self._run(["--json", "patch", "new", str(patch_path)])
        self._run(
            [
                "--json",
                "patch",
                "add-object",
                str(patch_path),
                "--text",
                "cycle~ 440",
                "--id",
                "osc",
                "--outlets",
                "1",
            ]
        )
        self._run(
            [
                "--json",
                "patch",
                "add-object",
                str(patch_path),
                "--text",
                "dac~",
                "--id",
                "out",
                "--inlets",
                "2",
                "--outlets",
                "0",
            ]
        )
        self._run(
            ["--json", "patch", "connect", str(patch_path), "osc", "0", "out", "0"]
        )
        r_info = self._run(["--json", "patch", "info", str(patch_path)])
        info = json.loads(r_info.stdout)
        assert info["boxes"] == 2
        assert info["lines"] == 1
        ids = [o["id"] for o in info["objects"]]
        assert set(ids) == {"osc", "out"}

    @pytest.mark.e2e
    def test_render_midi_subprocess(self, running_max, tmp_path: Path):
        """Run `cli-anything-max render midi` against the real installed binary.

        Requires the ``running_max`` fixture because this command actually
        drives the control patch.
        """
        out = tmp_path / "sub.mid"
        result = self._run(["--json", "render", "midi", str(out)])
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert data["is_midi"] is True
        assert data["mthd"] is True
        assert out.exists()
        with out.open("rb") as f:
            assert f.read(4) == b"MThd"
        print(f"\n  subprocess MID: {out} ({data['bytes']} bytes)")

    def test_patch_to_amxd_roundtrip(self, tmp_path: Path):
        patch_path = tmp_path / "d.maxpat"
        amxd_path = tmp_path / "D.amxd"
        extract_path = tmp_path / "d_out.maxpat"

        self._run(["--json", "patch", "new", str(patch_path)])
        self._run(
            [
                "--json",
                "patch",
                "add-object",
                str(patch_path),
                "--text",
                "plugin~",
                "--id",
                "in",
                "--inlets",
                "0",
                "--outlets",
                "2",
            ]
        )
        self._run(
            [
                "--json",
                "patch",
                "add-object",
                str(patch_path),
                "--text",
                "plugout~",
                "--id",
                "out",
                "--inlets",
                "2",
                "--outlets",
                "0",
            ]
        )
        self._run(["--json", "patch", "connect", str(patch_path), "in", "0", "out", "0"])
        self._run(["--json", "patch", "connect", str(patch_path), "in", "1", "out", "1"])

        r_wrap = self._run(
            ["--json", "patch", "to-amxd", str(patch_path), str(amxd_path)]
        )
        wrap = json.loads(r_wrap.stdout)
        assert wrap["bytes"] > 0

        r_val = self._run(["--json", "device", "validate", str(amxd_path)])
        val = json.loads(r_val.stdout)
        assert val["valid"] is True
        assert val["boxes"] == 2
        assert val["lines"] == 2

        r_ext = self._run(
            ["--json", "patch", "from-amxd", str(amxd_path), str(extract_path)]
        )
        assert r_ext.returncode == 0
        assert extract_path.exists()
