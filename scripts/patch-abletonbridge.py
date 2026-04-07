#!/usr/bin/env python3
"""patch-abletonbridge.py — idempotent env-var port override for AbletonBridge

The AbletonBridge Remote Script that ships in
https://github.com/hidingwill/AbletonBridge (and the user's fork at
~/colab/AbletonBridge/) hard-codes its TCP listen port and UDP realtime
port. That means two Ableton Live instances on the same machine cannot
both load the bridge — the second one fails to bind 9877.

This script patches the bridge's `__init__.py` so the ports come from
environment variables, with the original hard-coded values as defaults.
After applying, you can run two Live instances side by side via:

    set ABLETON_BRIDGE_PORT=9877 && "Ableton Live 12 Suite.exe" "test 1.als"
    set ABLETON_BRIDGE_PORT=9878 && "Ableton Live 12 Suite.exe" "test 2.als"

The patch is fully idempotent — safe to run multiple times against the
same file. If the file is already patched, the script reports
"already patched" and exits 0 without modifying anything.

Usage:

    python scripts/patch-abletonbridge.py <path-to-AbletonBridge-__init__.py>
    python scripts/patch-abletonbridge.py --check <path>      # report only
    python scripts/patch-abletonbridge.py --all               # patch every known install on this machine
    python scripts/patch-abletonbridge.py --check --all       # report state of all known installs

Common install locations the script knows about (Windows):

    C:\\ProgramData\\Ableton\\Live 12 Suite\\Resources\\MIDI Remote Scripts\\AbletonBridge\\__init__.py
    C:\\Users\\<user>\\AppData\\Roaming\\Ableton\\Live 12.x\\Preferences\\User Remote Scripts\\AbletonBridge\\__init__.py
    ~/colab/AbletonBridge/AbletonBridge_Remote_Script/__init__.py    (source repo copy)

The script does NOT install or modify the bridge code itself — it only
flips three lines that define the ports plus an `import os` near the
top. Live caches Python imports on load, so the patch only takes
effect on the next Live restart.

Note: this script is a temporary scaffold. If the parallel research
session at step 06 sticks with AbletonBridge as part of the recommended
runtime overlay stack, this script becomes load-bearing and stays. If
the session pivots toward AbletonOSC as the primary observer (currently
the leaning direction per ~/tasks/alsync-architecture.md § Five API
Contracts), this script and the patch it applies both go away in v1.

Either way, the script makes the dev environment reproducible
regardless of which direction v1 takes. Cheap to write, cheap to
delete, expensive to not have when sitting at a fresh machine three
months from now.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# The exact pre-patch lines we recognize. The order matters for the
# replacement: we anchor on the literal `DEFAULT_PORT = 9877` block.
PRE_PATCH_PATTERN = re.compile(
    r"""(?ms)
    ^(?P<indent>[\t\ ]*)DEFAULT_PORT\s*=\s*9877\s*\n
    (?P=indent)UDP_REALTIME_PORT\s*=\s*9882\s*\n
    (?P=indent)HOST\s*=\s*"localhost"\s*\n
    """,
    re.VERBOSE,
)

POST_PATCH_BLOCK = '''\
# Constants for socket communication
# Port can be overridden via the ABLETON_BRIDGE_PORT environment variable so
# multiple Ableton Live instances on the same machine can each bind their own
# bridge port. Set the env var BEFORE launching Live (e.g. on Windows:
#   set ABLETON_BRIDGE_PORT=9878 && "Ableton Live 12 Suite.exe"
# ). Defaults match the original hard-coded values for back-compat.
def _envint(name, default):
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default

DEFAULT_PORT = _envint("ABLETON_BRIDGE_PORT", 9877)
UDP_REALTIME_PORT = _envint("ABLETON_BRIDGE_UDP_PORT", 9882)
HOST = os.environ.get("ABLETON_BRIDGE_HOST", "localhost")
'''

# Recognition for the already-patched state (so re-runs no-op cleanly).
POST_PATCH_MARKER = "_envint(\"ABLETON_BRIDGE_PORT\", 9877)"

# `import os` may already be present (after a previous run, or by chance).
IMPORT_OS_PATTERN = re.compile(r"^import os\s*$", re.MULTILINE)

# We always want `import os` somewhere near the top, after `from __future__`.
IMPORT_OS_INSERTION_AFTER = re.compile(
    r"(from __future__ import [^\n]*\n)",
)

# Default install locations the script knows how to find on Windows.
# Listed in order of likely "the one Live actually loaded".
DEFAULT_TARGETS = [
    Path("C:/ProgramData/Ableton/Live 12 Suite/Resources/MIDI Remote Scripts/AbletonBridge/__init__.py"),
    Path("C:/ProgramData/Ableton/Live 11 Suite/Resources/MIDI Remote Scripts/AbletonBridge/__init__.py"),
    Path("~/colab/AbletonBridge/AbletonBridge_Remote_Script/__init__.py").expanduser(),
]


def _find_user_remote_scripts():
    """Find every Live preferences `User Remote Scripts/AbletonBridge/__init__.py`."""
    out = []
    appdata = Path("~/AppData/Roaming/Ableton").expanduser()
    if not appdata.is_dir():
        return out
    for live_dir in appdata.iterdir():
        candidate = live_dir / "Preferences" / "User Remote Scripts" / "AbletonBridge" / "__init__.py"
        if candidate.is_file():
            out.append(candidate)
    return out


def _all_known_targets():
    found = [p for p in DEFAULT_TARGETS if p.is_file()]
    found.extend(_find_user_remote_scripts())
    # de-dup while preserving order
    seen = set()
    unique = []
    for p in found:
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        unique.append(p)
    return unique


def _check(path):
    """Report the patch state of `path` without modifying it."""
    if not path.is_file():
        return "MISSING"
    text = path.read_text(encoding="utf-8")
    if POST_PATCH_MARKER in text:
        return "ALREADY_PATCHED"
    if PRE_PATCH_PATTERN.search(text):
        return "PATCHABLE"
    return "UNKNOWN_FORMAT"


def _patch_one(path, dry_run=False):
    """Apply the patch to `path`. Returns one of:
    NOT_FOUND / ALREADY_PATCHED / UNKNOWN_FORMAT / PATCHED / DRY_RUN_OK
    """
    if not path.is_file():
        return "NOT_FOUND"
    text = path.read_text(encoding="utf-8")

    if POST_PATCH_MARKER in text:
        return "ALREADY_PATCHED"

    match = PRE_PATCH_PATTERN.search(text)
    if not match:
        return "UNKNOWN_FORMAT"

    new_text = text.replace(match.group(0), POST_PATCH_BLOCK)

    # Make sure `import os` is somewhere in the import block.
    if not IMPORT_OS_PATTERN.search(new_text):
        future_match = IMPORT_OS_INSERTION_AFTER.search(new_text)
        if future_match:
            insertion_point = future_match.end()
            new_text = new_text[:insertion_point] + "import os\n" + new_text[insertion_point:]
        else:
            new_text = "import os\n" + new_text

    if dry_run:
        return "DRY_RUN_OK"

    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
    path.write_text(new_text, encoding="utf-8")
    return "PATCHED"


def main():
    p = argparse.ArgumentParser(
        description="Idempotent patcher for AbletonBridge Remote Script env-var port override."
    )
    p.add_argument("path", nargs="?", help="Path to AbletonBridge __init__.py to patch.")
    p.add_argument("--check", action="store_true", help="Report patch state, don't modify.")
    p.add_argument("--all", action="store_true", help="Patch all known install locations on this machine.")
    p.add_argument("--dry-run", action="store_true", help="Show what would change without writing.")
    args = p.parse_args()

    if args.all:
        targets = _all_known_targets()
        if not targets:
            print("[patch-abletonbridge] no AbletonBridge installs found in known locations")
            return 1
    elif args.path:
        targets = [Path(args.path)]
    else:
        p.print_help()
        return 2

    rc = 0
    for target in targets:
        if args.check:
            state = _check(target)
            print("[{:18}] {}".format(state, target))
            if state == "PATCHABLE":
                rc = max(rc, 1)
            continue

        state = _patch_one(target, dry_run=args.dry_run)
        print("[{:18}] {}".format(state, target))
        if state == "PATCHED":
            backup = target.with_suffix(target.suffix + ".bak")
            print("    backup: {}".format(backup))
        if state in ("NOT_FOUND", "UNKNOWN_FORMAT"):
            rc = max(rc, 1)

    return rc


if __name__ == "__main__":
    sys.exit(main())
