"""`.amxd` Max for Live device file I/O.

An `.amxd` file is a small binary envelope wrapping a `.maxpat` JSON payload.
The format is documented in `~/colab/CLAUDE.md` and reproduced here.

Layout::

    offset  size  content
    0       4     b'ampf'
    4       4     uint32 LE = 4
    8       8     b'mmmmmeta'
    16      4     uint32 LE = 4         (meta length)
    20      4     uint32 LE = 1         (meta version)
    24      4     b'ptch'
    28      4     uint32 LE = N         (patcher JSON length)
    32      N     UTF-8 patcher JSON

Writing raw patcher JSON to a file with the `.amxd` extension does NOT work —
Ableton will refuse to load it. The `ampf` wrapper is mandatory.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

_AMPF_MAGIC = b"ampf"
_META_MAGIC = b"mmmmmeta"
_PTCH_MAGIC = b"ptch"


class AmxdError(ValueError):
    """Raised for any malformed `.amxd` envelope."""


def write_amxd(patcher_doc: dict[str, Any], path: str | Path) -> Path:
    """Write a patcher dict to an `.amxd` file with the correct ampf wrapper."""
    if "patcher" not in patcher_doc:
        raise AmxdError("patcher_doc must have a top-level 'patcher' key")

    # Max saves with `, ` and ` : ` separators — match so diffs against a
    # Max-saved device are minimal.
    patcher_json = json.dumps(patcher_doc, separators=(",", " : ")).encode("utf-8")

    blob = bytearray()
    blob += _AMPF_MAGIC
    blob += struct.pack("<I", 4)                       # ampf version = 4
    blob += _META_MAGIC
    blob += struct.pack("<I", 4)                       # meta chunk length = 4
    blob += struct.pack("<I", 1)                       # meta version = 1
    blob += _PTCH_MAGIC
    blob += struct.pack("<I", len(patcher_json))       # patcher chunk length
    blob += patcher_json

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(bytes(blob))
    return p


def read_amxd(path: str | Path) -> dict[str, Any]:
    """Read an `.amxd` file and return the wrapped patcher dict."""
    p = Path(path)
    data = p.read_bytes()
    if len(data) < 32:
        raise AmxdError(f"{p}: file too short ({len(data)} bytes)")
    if data[0:4] != _AMPF_MAGIC:
        raise AmxdError(f"{p}: missing 'ampf' magic, got {data[0:4]!r}")
    # data[4:8] is ampf version (4) — we don't enforce exact match.
    if data[8:16] != _META_MAGIC:
        raise AmxdError(f"{p}: missing 'mmmmmeta' marker at offset 8")
    meta_len = struct.unpack("<I", data[16:20])[0]
    if meta_len != 4:
        raise AmxdError(f"{p}: unexpected meta length {meta_len}, expected 4")
    # data[20:24] is meta version (1).
    ptch_offset = 24
    if data[ptch_offset:ptch_offset + 4] != _PTCH_MAGIC:
        raise AmxdError(
            f"{p}: missing 'ptch' marker at offset {ptch_offset}, "
            f"got {data[ptch_offset:ptch_offset + 4]!r}"
        )
    json_len = struct.unpack("<I", data[ptch_offset + 4:ptch_offset + 8])[0]
    json_start = ptch_offset + 8
    json_end = json_start + json_len
    if json_end > len(data):
        raise AmxdError(
            f"{p}: patcher chunk claims {json_len} bytes but only "
            f"{len(data) - json_start} remain"
        )
    json_bytes = data[json_start:json_end]
    try:
        doc = json.loads(json_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise AmxdError(f"{p}: patcher chunk is not valid JSON: {e}") from e
    if not isinstance(doc, dict) or "patcher" not in doc:
        raise AmxdError(f"{p}: patcher chunk has no top-level 'patcher' key")
    return doc


def validate_amxd(path: str | Path) -> dict[str, Any]:
    """Check an `.amxd` envelope and return a summary dict.

    Raises ``AmxdError`` on any structural problem.
    """
    p = Path(path)
    data = p.read_bytes()
    doc = read_amxd(p)  # raises if invalid
    patcher = doc["patcher"]
    return {
        "file": str(p),
        "bytes": len(data),
        "ampf_version": struct.unpack("<I", data[4:8])[0],
        "meta_version": struct.unpack("<I", data[20:24])[0],
        "patcher_json_bytes": struct.unpack("<I", data[28:32])[0],
        "boxes": len(patcher.get("boxes", [])),
        "lines": len(patcher.get("lines", [])),
        "appversion": patcher.get("appversion"),
    }
