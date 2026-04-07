"""`.maxpat` patcher JSON manipulation.

A Max patcher is plain JSON wrapped in a top-level `{"patcher": {...}}`.
This module provides:

- ``PatcherDoc`` — an in-memory dict wrapper with helpers for boxes/lines
- ``new_patcher`` — create a minimal empty patcher
- ``read_patcher`` / ``write_patcher`` — disk I/O
- ``add_object`` / ``connect`` / ``remove_box`` — structural mutations
- ``patcher_info`` — JSON-friendly summary (boxes, lines, objects)
- ``patcher_diff`` — structural diff of two patchers
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Optional

# Default Max app version metadata we stamp on new patchers. Matches the
# Max 9.1.3 build that ships in `Max913_260310.zip`.
DEFAULT_APPVERSION: dict[str, Any] = {
    "major": 9,
    "minor": 0,
    "revision": 13,
    "architecture": "x64",
    "modernui": 1,
}


class PatcherError(ValueError):
    """Raised for any invalid patcher structure or operation."""


def new_patcher(
    *,
    width: int = 640,
    height: int = 480,
    fontsize: int = 12,
    fontname: str = "Arial",
) -> dict[str, Any]:
    """Return a minimal valid patcher dict with no boxes or lines."""
    return {
        "patcher": {
            "fileversion": 1,
            "appversion": dict(DEFAULT_APPVERSION),
            "classnamespace": "box",
            "rect": [0, 0, width, height],
            "openrect": [0, 0, width, height],
            "default_fontsize": fontsize,
            "default_fontname": fontname,
            "gridsize": [8, 8],
            "boxanimatetime": 0,
            "boxes": [],
            "lines": [],
        }
    }


def read_patcher(path: str | Path) -> dict[str, Any]:
    """Load a `.maxpat` (or `.maxhelp`) JSON file and validate the envelope."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        raise PatcherError(f"{p}: invalid JSON: {e}") from e
    if not isinstance(doc, dict) or "patcher" not in doc:
        raise PatcherError(f"{p}: missing top-level 'patcher' key")
    if not isinstance(doc["patcher"], dict):
        raise PatcherError(f"{p}: 'patcher' is not an object")
    doc["patcher"].setdefault("boxes", [])
    doc["patcher"].setdefault("lines", [])
    return doc


def write_patcher(doc: dict[str, Any], path: str | Path) -> Path:
    """Serialize a patcher dict to disk. Uses compact separators Max prefers."""
    if "patcher" not in doc:
        raise PatcherError("doc is missing top-level 'patcher' key")
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Max's own saved files use `, ` and `: ` — we match so diffs against a
    # Max-saved file are minimal.
    text = json.dumps(doc, indent=4, separators=(",", " : "))
    p.write_text(text, encoding="utf-8")
    return p


class PatcherDoc:
    """Dict-backed helper with structural mutation methods.

    PatcherDoc deliberately keeps a reference to the underlying dict so
    callers can still hand it to ``write_patcher``.
    """

    def __init__(self, doc: dict[str, Any]) -> None:
        if "patcher" not in doc:
            raise PatcherError("doc is missing 'patcher' key")
        self.doc = doc

    @property
    def patcher(self) -> dict[str, Any]:
        return self.doc["patcher"]

    @property
    def boxes(self) -> list[dict[str, Any]]:
        return self.patcher.setdefault("boxes", [])

    @property
    def lines(self) -> list[dict[str, Any]]:
        return self.patcher.setdefault("lines", [])

    # ── ID helpers ────────────────────────────────────────────────────

    def _box_ids(self) -> set[str]:
        return {b["box"]["id"] for b in self.boxes if "box" in b and "id" in b["box"]}

    def next_id(self, prefix: str = "obj") -> str:
        """Return a fresh ``obj-N`` style id not currently used."""
        used = self._box_ids()
        n = 1
        while True:
            candidate = f"{prefix}-{n}"
            if candidate not in used:
                return candidate
            n += 1

    def get_box(self, box_id: str) -> Optional[dict[str, Any]]:
        for b in self.boxes:
            if b.get("box", {}).get("id") == box_id:
                return b["box"]
        return None

    # ── Mutations ─────────────────────────────────────────────────────

    def add_object(
        self,
        text: str,
        *,
        id: Optional[str] = None,
        rect: Optional[list[int]] = None,
        maxclass: str = "newobj",
        numinlets: int = 1,
        numoutlets: int = 1,
        outlettype: Optional[list[str]] = None,
    ) -> str:
        """Add a new box to the patcher and return its id.

        Defaults produce a ``newobj`` with the given text at a sensible
        offset below the existing boxes.
        """
        if id is None:
            id = self.next_id()
        elif id in self._box_ids():
            raise PatcherError(f"box id {id!r} is already used")

        if rect is None:
            # Stack new boxes vertically below existing ones.
            y = 20 + 30 * len(self.boxes)
            rect = [20, y, max(80, len(text) * 8 + 20), 22]

        if outlettype is None:
            outlettype = ["anything"] * max(0, numoutlets)

        box: dict[str, Any] = {
            "id": id,
            "maxclass": maxclass,
            "patching_rect": rect,
            "numinlets": numinlets,
            "numoutlets": numoutlets,
        }
        # `message` and `newobj` carry text; `comment` also does.
        if maxclass in ("newobj", "message", "comment"):
            box["text"] = text
        if numoutlets > 0:
            box["outlettype"] = outlettype

        self.boxes.append({"box": box})
        return id

    def connect(
        self,
        src_id: str,
        src_outlet: int,
        dst_id: str,
        dst_inlet: int,
    ) -> None:
        """Wire two boxes. Both ids must already exist."""
        ids = self._box_ids()
        if src_id not in ids:
            raise PatcherError(f"source id {src_id!r} not in patcher")
        if dst_id not in ids:
            raise PatcherError(f"destination id {dst_id!r} not in patcher")
        src_box = self.get_box(src_id)
        dst_box = self.get_box(dst_id)
        assert src_box and dst_box
        if src_outlet >= src_box.get("numoutlets", 0):
            raise PatcherError(
                f"{src_id} has {src_box.get('numoutlets', 0)} outlets; "
                f"requested outlet {src_outlet}"
            )
        if dst_inlet >= dst_box.get("numinlets", 0):
            raise PatcherError(
                f"{dst_id} has {dst_box.get('numinlets', 0)} inlets; "
                f"requested inlet {dst_inlet}"
            )
        self.lines.append(
            {
                "patchline": {
                    "source": [src_id, src_outlet],
                    "destination": [dst_id, dst_inlet],
                }
            }
        )

    def remove_box(self, box_id: str) -> bool:
        """Remove a box and all lines touching it. Returns True if removed."""
        before = len(self.boxes)
        self.boxes[:] = [b for b in self.boxes if b.get("box", {}).get("id") != box_id]
        if len(self.boxes) == before:
            return False
        self.lines[:] = [
            l
            for l in self.lines
            if l.get("patchline", {}).get("source", [None])[0] != box_id
            and l.get("patchline", {}).get("destination", [None])[0] != box_id
        ]
        return True


def patcher_info(doc: dict[str, Any]) -> dict[str, Any]:
    """Return a JSON-friendly summary of a patcher."""
    pd = PatcherDoc(doc)
    objs = []
    for b in pd.boxes:
        box = b.get("box", {})
        objs.append(
            {
                "id": box.get("id"),
                "class": box.get("maxclass"),
                "text": box.get("text", ""),
                "inlets": box.get("numinlets", 0),
                "outlets": box.get("numoutlets", 0),
                "rect": box.get("patching_rect"),
            }
        )
    wires = []
    for l in pd.lines:
        pl = l.get("patchline", {})
        src = pl.get("source") or [None, None]
        dst = pl.get("destination") or [None, None]
        wires.append(
            {"from": {"id": src[0], "outlet": src[1]}, "to": {"id": dst[0], "inlet": dst[1]}}
        )
    return {
        "fileversion": pd.patcher.get("fileversion"),
        "appversion": pd.patcher.get("appversion"),
        "rect": pd.patcher.get("rect"),
        "boxes": len(objs),
        "lines": len(wires),
        "objects": objs,
        "wires": wires,
    }


def patcher_diff(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Structural diff of two patchers. Shallow: tracks box/line add/remove only."""
    pa = PatcherDoc(copy.deepcopy(a))
    pb = PatcherDoc(copy.deepcopy(b))

    a_box_ids = {x.get("box", {}).get("id") for x in pa.boxes}
    b_box_ids = {x.get("box", {}).get("id") for x in pb.boxes}

    def wire_key(l: dict[str, Any]) -> tuple:
        pl = l.get("patchline", {})
        return tuple(pl.get("source", [None, None]) + pl.get("destination", [None, None]))

    a_wires = {wire_key(l) for l in pa.lines}
    b_wires = {wire_key(l) for l in pb.lines}

    return {
        "boxes_added": sorted(b_box_ids - a_box_ids, key=lambda x: (x is None, x)),
        "boxes_removed": sorted(a_box_ids - b_box_ids, key=lambda x: (x is None, x)),
        "wires_added": sorted(b_wires - a_wires),
        "wires_removed": sorted(a_wires - b_wires),
    }
