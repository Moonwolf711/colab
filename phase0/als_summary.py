#!/usr/bin/env python3
"""als_summary.py — quick "what's in this .als" reporter.

Standalone summary of one .als file. Useful for spot-checking before
running a round-trip experiment, and for re-checking the original
fixtures over time.

NOTE: this file is NOT named `inspect.py` because Python adds the
script's directory to `sys.path[0]`, and a local `inspect.py` would
shadow the stdlib `inspect` module — which lxml depends on internally
via `from inspect import getfullargspec`. Naming it `als_summary.py`
keeps the stdlib visible.

Usage:
    python phase0/als_summary.py "<path-to-.als>"
"""

from __future__ import annotations

import sys
from pathlib import Path

# Reuse verify.py's helpers — same module dir
sys.path.insert(0, str(Path(__file__).parent))
from verify import _parse, _summarize, _print_summary  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: als_summary.py <path-to-.als>", file=sys.stderr)
        return 2
    p = Path(sys.argv[1])
    if not p.is_file():
        print(f"ERROR: file not found: {p}", file=sys.stderr)
        return 1
    print(f"als_summary.py — summary of {p} ({p.stat().st_size} bytes)")
    print()
    summary = _summarize(_parse(p))
    _print_summary(p.name, summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
