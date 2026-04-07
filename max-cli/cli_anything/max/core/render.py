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
