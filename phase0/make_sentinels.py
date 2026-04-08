#!/usr/bin/env python3
"""make_sentinels.py — generate Strategy D survival test fixtures.

Strategy D is the architectural variant where coLaB hides its CRDT metadata
inside the .als itself by inserting a custom XML element (e.g.
<COLABSentinel>) under <LiveSet>. The bet is that Ableton, like most
schema-permissive XML loaders, ignores unknown elements on read AND
preserves them on save. The canonical synthesis predicts this is
near-certain dead — every reverse-engineered DAW strips unknown elements
on save because the in-memory model doesn't know about them.

This script generates two test fixtures per input .als so the prediction
can be cheaply falsified by a human in ≤2 minutes per fixture:

  1. <basename>-sentinel-username.als — modifies the first track's
     UserName attribute to embed a known marker. Tests whether Live
     preserves edits to *known schema fields* across save. Should
     always survive; if it doesn't, even safe field edits are dangerous.

  2. <basename>-sentinel-custom.als — injects a <COLABSentinel> element
     directly under <LiveSet>. Tests whether Live preserves *unknown*
     elements across save. Predicted: stripped. If it survives,
     Strategy D becomes a viable backstop and the architecture has a
     second option.

Usage:
    # Generate sentinels from a fixture:
    python phase0/make_sentinels.py "<path-to-.als>"

    # After Live opens + saves a sentinel file, verify what survived:
    python phase0/make_sentinels.py --verify <which> "<live-saved-path>"
        where <which> is "username" or "custom"

Outputs:
    /tmp/colab-phase0/sentinels/<basename>-sentinel-username.als
    /tmp/colab-phase0/sentinels/<basename>-sentinel-custom.als

Pass/fail criteria are explained in phase0/RUNBOOK.md § Strategy D.
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

# Sentinel markers — picked to be obviously synthetic so they're easy to
# find in the saved file but unlikely to break Ableton's loader.
USERNAME_SENTINEL = "[COLAB-PHASE0-USERNAME]"
CUSTOM_ELEMENT_TAG = "COLABSentinel"
CUSTOM_ELEMENT_VALUE = "phase0-strategy-d-test"
CUSTOM_ELEMENT_NOTE = (
    "If this element survived a Live save, Strategy D is viable. "
    "Predicted outcome was: stripped on save."
)


def _out_dir() -> Path:
    base = Path(os.environ.get("TMP", os.environ.get("TEMP", "/tmp")))
    out = base / "colab-phase0" / "sentinels"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _load_als(path: Path) -> ET.Element:
    with gzip.open(path, "rb") as f:
        xml_bytes = f.read()
    return ET.fromstring(xml_bytes)


def _save_als(root: ET.Element, path: Path) -> int:
    serialized = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with gzip.open(path, "wb", compresslevel=6) as f:
        f.write(serialized)
    return path.stat().st_size


def _first_track(root: ET.Element) -> ET.Element | None:
    """Return the first track element under <LiveSet><Tracks>, regardless
    of subtype (GroupTrack / MidiTrack / AudioTrack / ReturnTrack)."""
    live_set = root.find("LiveSet")
    if live_set is None:
        return None
    tracks = live_set.find("Tracks")
    if tracks is None:
        return None
    for child in tracks:
        if child.tag.endswith("Track"):
            return child
    return None


def make_username_sentinel(src: Path) -> dict:
    root = _load_als(src)
    track = _first_track(root)
    if track is None:
        raise SystemExit(f"FAIL: no track element under <LiveSet><Tracks> in {src}")

    name_el = track.find("Name")
    if name_el is None:
        # Build a minimal Name element if absent (rare).
        name_el = ET.SubElement(track, "Name")
    user_name = name_el.find("UserName")
    if user_name is None:
        user_name = ET.SubElement(name_el, "UserName")
    original = user_name.attrib.get("Value", "")
    new_value = f"{original} {USERNAME_SENTINEL}".strip()
    user_name.attrib["Value"] = new_value

    out = _out_dir() / f"{src.stem}-sentinel-username.als"
    size = _save_als(root, out)
    return {
        "out": out,
        "size": size,
        "track_tag": track.tag,
        "track_id": track.attrib.get("Id", "?"),
        "original_username": original,
        "modified_username": new_value,
    }


def make_custom_sentinel(src: Path) -> dict:
    root = _load_als(src)
    live_set = root.find("LiveSet")
    if live_set is None:
        raise SystemExit(f"FAIL: no <LiveSet> in {src}")
    el = ET.SubElement(live_set, CUSTOM_ELEMENT_TAG)
    el.attrib["Value"] = CUSTOM_ELEMENT_VALUE
    el.attrib["Phase"] = "0"
    el.attrib["Note"] = CUSTOM_ELEMENT_NOTE

    out = _out_dir() / f"{src.stem}-sentinel-custom.als"
    size = _save_als(root, out)
    return {
        "out": out,
        "size": size,
        "tag": CUSTOM_ELEMENT_TAG,
        "value": CUSTOM_ELEMENT_VALUE,
    }


def verify(which: str, saved_path: Path) -> int:
    if not saved_path.is_file():
        print(f"ERROR: file not found: {saved_path}", file=sys.stderr)
        return 1
    try:
        root = _load_als(saved_path)
    except Exception as e:
        print(f"FAIL: cannot read {saved_path}: {type(e).__name__}: {e}")
        return 1

    print(f"Strategy D verify: {which}")
    print(f"  saved_path: {saved_path}")

    if which == "username":
        track = _first_track(root)
        if track is None:
            print("  FAIL: no track found in saved file")
            return 1
        name_el = track.find("Name")
        user_name = name_el.find("UserName") if name_el is not None else None
        val = user_name.attrib.get("Value", "") if user_name is not None else ""
        print(f"  first_track: {track.tag} Id={track.attrib.get('Id', '?')}")
        print(f"  username:    {val!r}")
        if USERNAME_SENTINEL in val:
            print(f"STRATEGY D / USERNAME RESULT: PASS  "
                  f"sentinel {USERNAME_SENTINEL!r} survived Live save")
            print("  Implication: editing known schema fields offline IS safe.")
            return 0
        else:
            print(f"STRATEGY D / USERNAME RESULT: FAIL  "
                  f"sentinel {USERNAME_SENTINEL!r} stripped or moved")
            print("  Implication: even safe schema-field edits are risky. Investigate.")
            return 1

    elif which == "custom":
        matches = [el for el in root.iter() if el.tag == CUSTOM_ELEMENT_TAG]
        if matches:
            first = matches[0]
            print(f"  found {len(matches)} <{CUSTOM_ELEMENT_TAG}> element(s)")
            print(f"  first.Value: {first.attrib.get('Value', '')!r}")
            print(f"STRATEGY D / CUSTOM RESULT: SURVIVED  "
                  f"<{CUSTOM_ELEMENT_TAG}> preserved across Live save")
            print("  Implication: SURPRISE — Strategy D may be viable as a backstop.")
            print("  Tell the architecture doc owner immediately.")
            return 0
        else:
            print(f"  no <{CUSTOM_ELEMENT_TAG}> element found in saved file")
            print(f"STRATEGY D / CUSTOM RESULT: STRIPPED  "
                  f"<{CUSTOM_ELEMENT_TAG}> removed by Live (as predicted)")
            print("  Implication: Strategy D confirmed dead. "
                  "Strategy C (CFAPI) remains the only path.")
            return 0  # Predicted outcome — not a script failure.

    else:
        print(f"ERROR: unknown --verify mode {which!r}; "
              f"must be 'username' or 'custom'", file=sys.stderr)
        return 2


def generate(src: Path) -> int:
    if not src.is_file():
        print(f"ERROR: file not found: {src}", file=sys.stderr)
        return 1
    print("Strategy D sentinel generator")
    print(f"  input:    {src} ({src.stat().st_size} bytes)")

    info_un = make_username_sentinel(src)
    print(f"  username sentinel:")
    print(f"    track:   {info_un['track_tag']} Id={info_un['track_id']}")
    print(f"    edit:    {info_un['original_username']!r} -> {info_un['modified_username']!r}")
    print(f"    written: {info_un['out']} ({info_un['size']} bytes)")

    info_cu = make_custom_sentinel(src)
    print(f"  custom-element sentinel:")
    print(f"    tag:     <{info_cu['tag']} Value={info_cu['value']!r}/>")
    print(f"    written: {info_cu['out']} ({info_cu['size']} bytes)")

    print("STRATEGY D GENERATOR RESULT: PASS  fixtures ready for manual Live test")
    print()
    print(f"Next step: open each sentinel file in Live 12.x, save it, then run:")
    print(f"  python phase0/make_sentinels.py --verify username \"{info_un['out']}\"")
    print(f"  python phase0/make_sentinels.py --verify custom   \"{info_cu['out']}\"")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if len(args) >= 1 and args[0] == "--verify":
        if len(args) != 3:
            print("usage: make_sentinels.py --verify <username|custom> <saved-path>",
                  file=sys.stderr)
            return 2
        return verify(args[1], Path(args[2]))
    if len(args) != 1:
        print("usage: make_sentinels.py <path-to-.als>", file=sys.stderr)
        print("       make_sentinels.py --verify <username|custom> <saved-path>",
              file=sys.stderr)
        return 2
    return generate(Path(args[0]))


if __name__ == "__main__":
    sys.exit(main())
