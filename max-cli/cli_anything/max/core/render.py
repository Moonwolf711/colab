"""Render dispatch — tier B implements audio render only.

The control patch ships with this fixed signal chain::

    [cycle~ 440] -> [*~ 0.] -> [sfrecord~ 1] + [dac~]

Calling :func:`render_audio` will:

1. Send ``/render/audio <abs_path> <duration_ms>`` to the patch.
2. Wait for ``/render/start``.
3. Wait for ``/render/complete`` (up to ``duration_ms + margin_ms``).
4. Verify the ``.wav`` file exists and has a valid RIFF header.
5. Return a dict with ``path``, ``bytes``, ``duration_ms``, ``is_wav``.

The dispatcher uses a Max ``Task`` to fire the stop message after
``duration_ms``, so the CLI's job is purely to send the request and
validate the resulting file.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from cli_anything.max.core.control import MaxControlError, MaxNotRespondingError
from cli_anything.max.utils.osc_client import OSCBridge

_WAV_MAGIC_RIFF = b"RIFF"
_WAV_MAGIC_WAVE = b"WAVE"
_MIDI_MAGIC_MTHD = b"MThd"


def render_audio(
    out_path: str | Path,
    duration_s: float,
    *,
    margin_ms: int = 750,
    wait_for_file_ms: int = 1500,
) -> dict[str, Any]:
    """Render ``duration_s`` seconds of the control patch output to ``out_path``.

    Args:
        out_path: Destination ``.wav`` file path. Parent directory is
            created if it does not exist. On Windows we hand Max the
            native-separator absolute path.
        duration_s: Record duration in seconds. Must be > 0.
        margin_ms: Extra headroom on the reply wait, so the JS dispatcher
            has time to fire the stop message after the record window.
        wait_for_file_ms: How long to wait for the on-disk file to appear
            after ``/render/complete``. sfrecord~ can lag a touch.

    Raises:
        ``MaxNotRespondingError`` if the patch does not acknowledge.
        ``MaxControlError`` if the patch reports an error.
        ``FileNotFoundError`` if no file appears on disk after the wait.
        ``ValueError`` if the resulting file is not a valid RIFF/WAV.
    """
    if duration_s <= 0:
        raise ValueError(f"duration_s must be positive, got {duration_s!r}")

    out = Path(out_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    # Delete stale output so we can detect a fresh write.
    if out.exists():
        out.unlink()

    duration_ms = int(round(duration_s * 1000))
    max_wait_s = (duration_ms + margin_ms) / 1000.0

    # Max's js object on Windows mishandles backslashes in string args to
    # outlet() — sending `C:\foo\bar.wav` crashes the dispatcher silently.
    # Convert to forward slashes; sfrecord~ accepts them on Windows.
    max_path = str(out).replace("\\", "/")

    with OSCBridge() as bridge:
        bridge.send("/render/audio", max_path, duration_ms)

        start_reply = bridge.wait_for("/render/start", timeout_s=2.0)
        if start_reply is None:
            raise MaxNotRespondingError(
                "no /render/start within 2.0s — is the control patch loaded?"
            )
        if start_reply.address.endswith("/error"):
            raise MaxControlError(f"render start failed: {start_reply.args}")

        complete_reply = bridge.wait_for("/render/complete", timeout_s=max_wait_s)
        if complete_reply is None:
            raise MaxNotRespondingError(
                f"no /render/complete within {max_wait_s:.1f}s"
            )
        if complete_reply.address.endswith("/error"):
            raise MaxControlError(f"render failed: {complete_reply.args}")

    # Give the filesystem a moment to flush.
    deadline = time.time() + wait_for_file_ms / 1000.0
    while time.time() < deadline:
        if out.exists() and out.stat().st_size > 0:
            break
        time.sleep(0.05)

    if not out.exists():
        raise FileNotFoundError(
            f"render reported complete but {out} was not written"
        )

    size = out.stat().st_size
    if size < 44:
        raise ValueError(f"{out}: file too small for a WAV ({size} bytes)")

    with out.open("rb") as f:
        header = f.read(12)
    is_riff = header[0:4] == _WAV_MAGIC_RIFF
    is_wave = header[8:12] == _WAV_MAGIC_WAVE
    if not (is_riff and is_wave):
        raise ValueError(
            f"{out}: not a valid RIFF/WAV file "
            f"(header={header!r})"
        )

    return {
        "path": str(out),
        "bytes": size,
        "duration_ms": duration_ms,
        "is_wav": True,
        "riff": True,
    }


def render_midi(
    out_path: str | Path,
    *,
    wait_for_file_ms: int = 2500,
    reply_timeout_s: float = 4.0,
) -> dict[str, Any]:
    """Render a short built-in MIDI riff to ``out_path`` via ``seq``.

    The control patch's ``[seq]`` object records a 4-note C-major
    ascending riff (C D E F) played through JS ``Task`` scheduling,
    then writes a Standard MIDI File to the supplied path.

    Args:
        out_path: Destination ``.mid`` file path. Parent dir is
            created. Any existing file at this path is deleted so
            we can detect a fresh write.
        wait_for_file_ms: How long after ``/render/midi/complete`` to
            wait for the file to actually appear on disk. seq flushes
            with a small delay after ``write``.
        reply_timeout_s: How long to wait for the complete reply.

    Returns:
        ``{"path", "bytes", "is_midi": True, "mthd": True}``

    Raises:
        ``MaxNotRespondingError``, ``MaxControlError``,
        ``FileNotFoundError``, ``ValueError`` as for ``render_audio``.
    """
    out = Path(out_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    # Max's js object on Windows crashes on backslash paths (see the
    # render_audio workaround). Convert to forward slashes.
    max_path = str(out).replace("\\", "/")

    with OSCBridge() as bridge:
        bridge.send("/render/midi", max_path)

        start_reply = bridge.wait_for("/render/midi/start", timeout_s=2.0)
        if start_reply is None:
            raise MaxNotRespondingError(
                "no /render/midi/start within 2.0s — is the control patch loaded?"
            )
        if start_reply.address.endswith("/error"):
            raise MaxControlError(f"midi start failed: {start_reply.args}")

        complete_reply = bridge.wait_for(
            "/render/midi/complete", timeout_s=reply_timeout_s
        )
        if complete_reply is None:
            raise MaxNotRespondingError(
                f"no /render/midi/complete within {reply_timeout_s:.1f}s"
            )
        if complete_reply.address.endswith("/error"):
            raise MaxControlError(f"midi render failed: {complete_reply.args}")

    # seq's disk flush lags the `write` message a bit. Poll for the file.
    deadline = time.time() + wait_for_file_ms / 1000.0
    while time.time() < deadline:
        if out.exists() and out.stat().st_size > 0:
            break
        time.sleep(0.05)

    if not out.exists():
        raise FileNotFoundError(
            f"midi render reported complete but {out} was not written"
        )

    size = out.stat().st_size
    if size < 14:
        # An SMF has at least a 14-byte header chunk (MThd + 6 + format + tracks + div).
        raise ValueError(f"{out}: file too small for an SMF ({size} bytes)")

    with out.open("rb") as f:
        header = f.read(14)
    if header[0:4] != _MIDI_MAGIC_MTHD:
        raise ValueError(
            f"{out}: not a valid SMF (missing MThd, header={header[:4]!r})"
        )

    return {
        "path": str(out),
        "bytes": size,
        "is_midi": True,
        "mthd": True,
    }
