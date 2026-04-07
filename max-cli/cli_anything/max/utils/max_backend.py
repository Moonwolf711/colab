"""Locate the Max executable on disk.

Max is a closed-source hard dependency. If the CLI cannot find a Max
install, commands that need a running Max must fail loudly with install
instructions — never silently fall back to a pure-Python fake.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Literal

Flavor = Literal["edit", "runtime", "runtime_nocef"]


class MaxNotInstalledError(RuntimeError):
    """Raised when Max cannot be located on disk."""


# Install roots to probe on each OS. Newest version first so the CLI picks
# Max 10 over Max 9 over Max 8 if multiple are installed.
_WIN_ROOTS = [
    Path(r"C:\Program Files\Cycling '74\Max 10"),
    Path(r"C:\Program Files\Cycling '74\Max 9"),
    Path(r"C:\Program Files\Cycling '74\Max 8"),
]

_MAC_ROOTS = [
    Path("/Applications/Max.app/Contents/MacOS"),
]

_FLAVOR_EXE_WIN: dict[Flavor, str] = {
    "edit": "Max.exe",
    "runtime": "MaxRT.exe",
    "runtime_nocef": "MaxRT_nocef.exe",
}

_FLAVOR_EXE_MAC: dict[Flavor, str] = {
    "edit": "Max",
    "runtime": "Max",
    "runtime_nocef": "Max",
}


def _install_instructions() -> str:
    if sys.platform == "darwin":
        return (
            "Max is not installed. Install from https://cycling74.com/downloads "
            "(free runtime available) and retry."
        )
    if sys.platform.startswith("win"):
        return (
            "Max is not installed under C:\\Program Files\\Cycling '74\\Max N\\. "
            "Install from https://cycling74.com/downloads (free runtime "
            "available) or set the MAX_EXE environment variable to an absolute "
            "path and retry."
        )
    return (
        "Max is not available on this platform. cli-anything-max currently "
        "supports Windows and macOS."
    )


def find_max_exe(flavor: Flavor = "runtime_nocef") -> Path:
    """Return the absolute path to a Max executable of the requested flavor.

    Search order:
      1. ``MAX_EXE`` environment variable (overrides everything)
      2. Known install roots for the current OS
      3. ``shutil.which("Max" / "Max.exe")`` as last resort

    Raises ``MaxNotInstalledError`` if nothing is found.
    """
    override = os.environ.get("MAX_EXE", "").strip()
    if override:
        p = Path(override)
        if not p.exists():
            raise MaxNotInstalledError(
                f"MAX_EXE={override!r} is set but the file does not exist."
            )
        return p

    if sys.platform.startswith("win"):
        exe_name = _FLAVOR_EXE_WIN[flavor]
        fallbacks = [_FLAVOR_EXE_WIN["runtime"], _FLAVOR_EXE_WIN["edit"]]
        for root in _WIN_ROOTS:
            candidate = root / exe_name
            if candidate.is_file():
                return candidate
            for fb in fallbacks:
                cand = root / fb
                if cand.is_file():
                    return cand
    elif sys.platform == "darwin":
        exe_name = _FLAVOR_EXE_MAC[flavor]
        for root in _MAC_ROOTS:
            candidate = root / exe_name
            if candidate.is_file():
                return candidate

    # Last resort — the user may have Max on PATH.
    which = shutil.which("Max.exe") or shutil.which("Max")
    if which:
        return Path(which)

    raise MaxNotInstalledError(_install_instructions())


def max_install_info() -> dict[str, object]:
    """Diagnostic summary of the Max install used by this CLI."""
    info: dict[str, object] = {"platform": sys.platform, "MAX_EXE": os.environ.get("MAX_EXE")}
    for flavor in ("edit", "runtime", "runtime_nocef"):
        try:
            info[flavor] = str(find_max_exe(flavor))  # type: ignore[arg-type]
        except MaxNotInstalledError as e:
            info[flavor] = f"not found: {e}"
    return info
