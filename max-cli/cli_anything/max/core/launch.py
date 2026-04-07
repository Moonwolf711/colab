"""Subprocess control for launching Max with a target patch.

Max is a GUI app — ``Max.exe --help`` does not print anything useful and
there are no ``--headless --convert-to`` style flags. The only CLI surface
is: pass a ``.maxpat`` path as a positional argument, and Max opens it.

Three flavors:

- ``edit`` — ``Max.exe <patch>`` — full editor, loud
- ``runtime`` — ``MaxRT.exe <patch>`` — runtime, no editor UI (but still
  renders front-most windows)
- ``runtime_nocef`` — ``MaxRT_nocef.exe <patch>`` — runtime without the
  embedded Chromium; preferred for E2E tests because it starts faster and
  skips network-dependent components.

This module keeps the launched process handle and provides ``terminate``
with a polite-then-forceful shutdown path.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from cli_anything.max.utils.max_backend import Flavor, find_max_exe


@dataclass
class MaxProcess:
    """Handle to a launched Max subprocess."""

    pid: int
    flavor: Flavor
    exe: Path
    patch: Optional[Path]
    popen: subprocess.Popen = field(repr=False)
    started_at: float = field(default_factory=time.time)

    # ── Lifecycle ─────────────────────────────────────────────────────

    def poll(self) -> Optional[int]:
        return self.popen.poll()

    def is_running(self) -> bool:
        return self.poll() is None

    def terminate(self, timeout: float = 5.0) -> int:
        """Polite terminate → wait → kill fallback. Returns exit code."""
        if not self.is_running():
            return self.popen.returncode or 0
        try:
            self.popen.terminate()
            return self.popen.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.popen.kill()
            return self.popen.wait(timeout=timeout)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "flavor": self.flavor,
            "exe": str(self.exe),
            "patch": str(self.patch) if self.patch else None,
            "running": self.is_running(),
            "returncode": self.popen.returncode,
            "started_at": self.started_at,
            "uptime_s": time.time() - self.started_at,
        }


def launch(
    flavor: Flavor = "runtime_nocef",
    patch: Optional[str | Path] = None,
    *,
    cwd: Optional[str | Path] = None,
    extra_args: Optional[list[str]] = None,
    capture_output: bool = False,
) -> MaxProcess:
    """Launch Max with an optional patch. Returns a ``MaxProcess`` handle.

    Args:
        flavor: Which Max executable to launch. See module docstring.
        patch: Path to a `.maxpat` file (absolute or relative) to open on
            launch. Max expects native paths (backslashes on Windows); we
            pass the path from ``Path.resolve()`` to guarantee that.
        cwd: Working directory for the subprocess. Defaults to the patch's
            parent, or the Max install dir if no patch is given.
        extra_args: Additional positional args to hand Max.
        capture_output: If True, redirect stdout/stderr to pipes so callers
            can read them. Max rarely prints anything — leave False unless
            debugging.
    """
    exe = find_max_exe(flavor)
    args: list[str] = [str(exe)]

    resolved_patch: Optional[Path] = None
    if patch is not None:
        resolved_patch = Path(patch).resolve()
        if not resolved_patch.exists():
            raise FileNotFoundError(f"patch not found: {resolved_patch}")
        # Max on Windows strongly prefers native backslash paths. On POSIX
        # this is a no-op.
        args.append(str(resolved_patch))

    if extra_args:
        args.extend(extra_args)

    if cwd is None:
        cwd = resolved_patch.parent if resolved_patch else exe.parent

    popen_kwargs: dict[str, Any] = {"cwd": str(cwd)}
    if capture_output:
        popen_kwargs["stdout"] = subprocess.PIPE
        popen_kwargs["stderr"] = subprocess.PIPE
    else:
        # Silence Max's stdout/stderr so our CLI output stays clean.
        popen_kwargs["stdout"] = subprocess.DEVNULL
        popen_kwargs["stderr"] = subprocess.DEVNULL

    # On Windows, detach from the console so Ctrl-C in our terminal
    # doesn't also take Max down unexpectedly.
    if sys.platform.startswith("win"):
        popen_kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        )

    proc = subprocess.Popen(args, **popen_kwargs)
    return MaxProcess(
        pid=proc.pid,
        flavor=flavor,
        exe=exe,
        patch=resolved_patch,
        popen=proc,
    )
