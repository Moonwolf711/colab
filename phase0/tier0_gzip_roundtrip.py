#!/usr/bin/env python3
"""tier0_gzip_roundtrip.py — gunzip → re-gzip an .als with no XML touch.

This is the cheapest possible round-trip: read the gzipped .als, write
the inner XML payload back through gzip with default level, save to a
test output path. If Live rejects this, our gzip is broken or Live is
sensitive to gzip metadata fields (timestamp, OS byte, etc.).

Usage:
    python phase0/tier0_gzip_roundtrip.py "<path-to-.als>"

Output:
    /tmp/colab-phase0/tier0/<basename>     ← the round-tripped file

Pass: script prints "TIER 0 RESULT: PASS" and the inner XML byte count
      is non-zero.
Fail: any exception, or empty XML payload.
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path


def _out_dir() -> Path:
    # Use a fixed Windows-friendly tmp dir we can document in the runbook.
    base = Path(os.environ.get("TMP", os.environ.get("TEMP", "/tmp")))
    out = base / "colab-phase0" / "tier0"
    out.mkdir(parents=True, exist_ok=True)
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: tier0_gzip_roundtrip.py <path-to-.als>", file=sys.stderr)
        return 2

    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"ERROR: file not found: {src}", file=sys.stderr)
        return 1

    print("Tier 0: gzip round-trip")
    print(f"  input:    {src} ({src.stat().st_size} bytes)")

    # Step 1: ungzip
    try:
        with gzip.open(src, "rb") as f:
            xml_bytes = f.read()
    except OSError as e:
        print(f"  FAIL: ungzip raised {type(e).__name__}: {e}")
        return 1

    print(f"  ungzip:   {len(xml_bytes)} bytes of XML")
    if len(xml_bytes) == 0:
        print("  FAIL: ungzipped payload is empty")
        return 1

    # Sanity check: looks like XML?
    if not xml_bytes.lstrip().startswith(b"<"):
        print(f"  FAIL: ungzipped payload does not start with '<' "
              f"(first bytes: {xml_bytes[:32]!r})")
        return 1
    if b"<Ableton" not in xml_bytes[:512]:
        print(f"  WARN: ungzipped payload does not contain '<Ableton' "
              f"in first 512 bytes — file may not be a Live set")
        # Not fatal; continue.

    # Step 2: re-gzip with default level
    out_path = _out_dir() / src.name
    try:
        with gzip.open(out_path, "wb", compresslevel=6) as f:
            f.write(xml_bytes)
    except OSError as e:
        print(f"  FAIL: re-gzip raised {type(e).__name__}: {e}")
        return 1

    out_size = out_path.stat().st_size
    print(f"  re-gzip:  {out_size} bytes")
    print(f"  written:  {out_path}")

    # Sanity check: round-trip the round-tripped file and confirm we get
    # back the same XML bytes.
    with gzip.open(out_path, "rb") as f:
        roundtrip_xml = f.read()
    if roundtrip_xml != xml_bytes:
        print("  FAIL: round-tripped XML differs from original "
              f"({len(roundtrip_xml)} vs {len(xml_bytes)} bytes)")
        return 1

    print("TIER 0 RESULT: PASS  XML payload bytes identical, "
          "gzip wrapper differs only in metadata")
    print()
    print(f"Next step: open {out_path} in Live 12.x and confirm it loads "
          "without errors. Then save from Live and run "
          f"`python phase0/verify.py \"{src}\" \"{out_path}\"`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
