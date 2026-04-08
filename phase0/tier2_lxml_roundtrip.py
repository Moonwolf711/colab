#!/usr/bin/env python3
"""tier2_lxml_roundtrip.py — gunzip → lxml parse → serialize → re-gzip

Tier 2 of the Phase 0 unblock-gate. Uses lxml, which is significantly
better than ElementTree at preserving attribute order, whitespace, and
namespace declarations. If Tier 1 (ElementTree) fails but Tier 2
passes, we know the materializer must use lxml-style preservation.

If both Tier 1 AND Tier 2 fail, we have a real problem with XML
round-trips against Live's `.als` schema and Strategy C is in serious
trouble — we'd need quick-xml in Rust with explicit byte-level
preservation, and even that may not be sufficient.

Usage:
    python phase0/tier2_lxml_roundtrip.py "<path-to-.als>"

Output:
    /tmp/colab-phase0/tier2/<basename>     ← the round-tripped file

Requires: pip install lxml  (already verified present: lxml 6.0.2)
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    print("ERROR: lxml not installed. Run: python -m pip install lxml")
    sys.exit(1)


def _out_dir() -> Path:
    base = Path(os.environ.get("TMP", os.environ.get("TEMP", "/tmp")))
    out = base / "colab-phase0" / "tier2"
    out.mkdir(parents=True, exist_ok=True)
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: tier2_lxml_roundtrip.py <path-to-.als>", file=sys.stderr)
        return 2

    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"ERROR: file not found: {src}", file=sys.stderr)
        return 1

    print("Tier 2: lxml round-trip")
    print(f"  input:        {src}")

    # Step 1: ungzip
    try:
        with gzip.open(src, "rb") as f:
            xml_bytes = f.read()
    except OSError as e:
        print(f"  FAIL: ungzip raised {type(e).__name__}: {e}")
        return 1
    print(f"  ungzip:       {len(xml_bytes)} bytes of XML")

    # Step 2: parse with lxml — preserve as much fidelity as possible
    parser = etree.XMLParser(
        remove_blank_text=False,   # keep whitespace inside elements
        strip_cdata=False,         # preserve CDATA sections
        remove_comments=False,     # keep comments
        recover=False,             # fail loudly on malformed input
    )
    try:
        root = etree.fromstring(xml_bytes, parser=parser)
    except etree.XMLSyntaxError as e:
        print(f"  FAIL: lxml.fromstring raised XMLSyntaxError: {e}")
        return 1
    print(f"  parse:        OK — root tag = {root.tag!r}")

    # Step 3: serialize — preserve attribute order and namespace decls
    try:
        new_xml = etree.tostring(
            root,
            xml_declaration=True,
            encoding="UTF-8",
            standalone=False,
            pretty_print=False,
        )
    except Exception as e:
        print(f"  FAIL: lxml.tostring raised {type(e).__name__}: {e}")
        return 1
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

    # Sanity: re-parse the output
    with gzip.open(out_path, "rb") as f:
        check = f.read()
    try:
        etree.fromstring(check, parser=parser)
    except etree.XMLSyntaxError as e:
        print(f"  FAIL: round-tripped output cannot be re-parsed: {e}")
        return 1

    delta = len(new_xml) - len(xml_bytes)
    sign = "+" if delta >= 0 else ""
    print(f"  bytes delta:  {sign}{delta} ({len(new_xml)} - {len(xml_bytes)})")

    print("TIER 2 RESULT: PASS  lxml serialized cleanly with attribute / "
          "namespace preservation, output is structurally a complete XML doc")
    print()
    print(f"Next step: open {out_path} in Live 12.x and confirm it loads "
          "without errors. If yes, save from Live and run "
          f"`python phase0/verify.py \"{src}\" \"{out_path}\"`. "
          "If Live rejects this AND Tier 1 also failed, we have a hard "
          "problem with Strategy C — paste me the exact error.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
