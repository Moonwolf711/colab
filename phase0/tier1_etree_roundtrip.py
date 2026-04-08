#!/usr/bin/env python3
"""tier1_etree_roundtrip.py — gunzip → ElementTree parse → serialize → re-gzip

Tier 1 of the Phase 0 unblock-gate. Uses Python's stdlib XML parser
(`xml.etree.ElementTree`). The output WILL differ from the input bytes
because ElementTree normalizes attribute order, whitespace, and
namespace declarations. The question this tier answers is whether
**Live still accepts the result** as a valid project file.

If Live accepts ElementTree's output, almost any "good" XML lib will
work for the materializer. If Live rejects it, we know we need a
serializer that preserves attribute order — go run Tier 2 (lxml).

Usage:
    python phase0/tier1_etree_roundtrip.py "<path-to-.als>"

Output:
    /tmp/colab-phase0/tier1/<basename>     ← the round-tripped file
"""

from __future__ import annotations

import gzip
import io
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def _out_dir() -> Path:
    base = Path(os.environ.get("TMP", os.environ.get("TEMP", "/tmp")))
    out = base / "colab-phase0" / "tier1"
    out.mkdir(parents=True, exist_ok=True)
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: tier1_etree_roundtrip.py <path-to-.als>", file=sys.stderr)
        return 2

    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"ERROR: file not found: {src}", file=sys.stderr)
        return 1

    print("Tier 1: Python xml.etree.ElementTree round-trip")
    print(f"  input:        {src}")

    # Step 1: ungzip
    try:
        with gzip.open(src, "rb") as f:
            xml_bytes = f.read()
    except OSError as e:
        print(f"  FAIL: ungzip raised {type(e).__name__}: {e}")
        return 1
    print(f"  ungzip:       {len(xml_bytes)} bytes of XML")

    # Step 2: parse
    try:
        # Preserve the XML declaration by stashing the first line if present.
        first_line_end = xml_bytes.find(b"\n") + 1
        first_line = xml_bytes[:first_line_end] if first_line_end else b""
        keep_decl = first_line.lstrip().startswith(b"<?xml")

        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"  FAIL: ElementTree.parse raised ParseError: {e}")
        return 1
    print(f"  parse:        OK — root tag = {root.tag!r}")

    # Step 3: serialize
    buf = io.BytesIO()
    try:
        tree = ET.ElementTree(root)
        tree.write(
            buf,
            encoding="utf-8",
            xml_declaration=keep_decl,
        )
    except Exception as e:
        print(f"  FAIL: ElementTree.write raised {type(e).__name__}: {e}")
        return 1
    new_xml = buf.getvalue()
    print(f"  serialize:    {len(new_xml)} bytes")

    # Step 4: re-gzip
    out_path = _out_dir() / src.name
    try:
        with gzip.open(out_path, "wb", compresslevel=6) as f:
            f.write(new_xml)
    except OSError as e:
        print(f"  FAIL: re-gzip raised {type(e).__name__}: {e}")
        return 1
    print(f"  re-gzip:      {out_path.stat().st_size} bytes")
    print(f"  written:      {out_path}")

    # Sanity: ungzip it again and re-parse to confirm the round-trip
    # at least produces something that ElementTree itself can read back
    with gzip.open(out_path, "rb") as f:
        check = f.read()
    try:
        ET.fromstring(check)
    except ET.ParseError as e:
        print(f"  FAIL: round-tripped output cannot be re-parsed: {e}")
        return 1

    delta = len(new_xml) - len(xml_bytes)
    sign = "+" if delta >= 0 else ""
    print(f"  bytes delta:  {sign}{delta} ({len(new_xml)} - {len(xml_bytes)})")

    print("TIER 1 RESULT: PASS  XML serialized cleanly, "
          "output differs from input but is a structurally complete XML doc")
    print()
    print(f"Next step: open {out_path} in Live 12.x and confirm it loads "
          "without errors. If yes, save from Live and run "
          f"`python phase0/verify.py \"{src}\" \"{out_path}\"`. "
          "If Live rejects it, run Tier 2 (lxml) for a more attribute-preserving serializer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
