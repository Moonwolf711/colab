#!/usr/bin/env python3
"""verify.py — structural comparison of two .als files.

Compares an "original" .als and a "candidate" .als (typically the
post-Live-save output of a Phase 0 round-trip). Reports:

- Track count, type breakdown (MIDI / Audio / Return / Master)
- Clip count by track type
- Device count
- MIDI note count (across all clips)
- Sample reference count
- Tempo / time signature
- Track name list (top 10)

Exits 0 if the structures look "equivalent enough" (counts match
within tolerance), 1 if there are mismatches.

Usage:
    python phase0/verify.py "<original-path>" "<candidate-path>"

This is a sanity tool, not a strict bytewise diff. Live always touches
some metadata fields on save (timestamps, save count, view state),
so we focus on the structural elements that matter for "did the
project survive the round-trip cleanly".
"""

from __future__ import annotations

import gzip
import sys
from collections import Counter
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    print("ERROR: lxml not installed. Run: python -m pip install lxml")
    sys.exit(1)


def _ungzip_xml(path: Path) -> bytes:
    with gzip.open(path, "rb") as f:
        return f.read()


def _local(tag: str) -> str:
    """Strip XML namespace, leave just the local name."""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _parse(path: Path):
    return etree.fromstring(_ungzip_xml(path))


def _summarize(root) -> dict:
    out = {
        "total_elements": 0,
        "tracks": Counter(),     # tag -> count
        "clips": Counter(),
        "devices": 0,
        "midi_notes": 0,
        "sample_refs": 0,
        "tempo": None,
        "time_sig_num": None,
        "time_sig_den": None,
        "track_names": [],
    }

    for el in root.iter():
        out["total_elements"] += 1
        local = _local(el.tag)

        if local in ("MidiTrack", "AudioTrack", "ReturnTrack", "MasterTrack",
                     "GroupTrack"):
            out["tracks"][local] += 1
            # Track name lives in <Name><EffectiveName Value="..."/></Name> child
            name_el = el.find(".//{*}Name/{*}EffectiveName")
            if name_el is not None:
                v = name_el.get("Value")
                if v is not None:
                    out["track_names"].append(v)

        if local in ("MidiClip", "AudioClip"):
            out["clips"][local] += 1

        if local in ("PluginDevice", "AuPluginDevice", "VstPluginInfo",
                     "OriginalSimpler", "InstrumentRack", "DrumGroupDevice",
                     "AudioEffectGroupDevice", "MidiEffectGroupDevice",
                     "Compressor2", "Eq8", "Limiter", "Saturator", "Operator"):
            out["devices"] += 1

        if local == "MidiNoteEvent":
            out["midi_notes"] += 1

        if local == "FileRef":
            out["sample_refs"] += 1

        if local == "Tempo":
            manual = el.find(".//{*}Manual")
            if manual is not None:
                v = manual.get("Value")
                if v is not None and out["tempo"] is None:
                    try:
                        out["tempo"] = float(v)
                    except ValueError:
                        pass

        if local == "TimeSignature":
            num = el.find(".//{*}Numerator")
            den = el.find(".//{*}Denominator")
            if num is not None and num.get("Value"):
                out["time_sig_num"] = num.get("Value")
            if den is not None and den.get("Value"):
                out["time_sig_den"] = den.get("Value")

    return out


def _print_summary(label: str, summary: dict) -> None:
    print(f"== {label} ==")
    print(f"  total_elements:  {summary['total_elements']}")
    print(f"  tempo:           {summary['tempo']}")
    print(f"  time_sig:        {summary['time_sig_num']}/{summary['time_sig_den']}")
    print(f"  tracks:          {dict(summary['tracks'])}")
    print(f"  clips:           {dict(summary['clips'])}")
    print(f"  devices:         {summary['devices']}")
    print(f"  midi_notes:      {summary['midi_notes']}")
    print(f"  sample_refs:     {summary['sample_refs']}")
    if summary["track_names"]:
        names = summary["track_names"][:10]
        print(f"  track_names[0:10]: {names}")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify.py <original.als> <candidate.als>", file=sys.stderr)
        return 2

    a = Path(sys.argv[1])
    b = Path(sys.argv[2])
    if not a.is_file():
        print(f"ERROR: original not found: {a}", file=sys.stderr)
        return 1
    if not b.is_file():
        print(f"ERROR: candidate not found: {b}", file=sys.stderr)
        return 1

    print("verify.py — structural .als comparison")
    print(f"  original:  {a} ({a.stat().st_size} bytes)")
    print(f"  candidate: {b} ({b.stat().st_size} bytes)")
    print()

    try:
        sa = _summarize(_parse(a))
    except (OSError, etree.XMLSyntaxError) as e:
        print(f"ERROR: failed to parse original: {type(e).__name__}: {e}")
        return 1

    try:
        sb = _summarize(_parse(b))
    except (OSError, etree.XMLSyntaxError) as e:
        print(f"ERROR: failed to parse candidate: {type(e).__name__}: {e}")
        return 1

    _print_summary("ORIGINAL", sa)
    print()
    _print_summary("CANDIDATE", sb)
    print()

    # Compare structural counts
    diffs = []

    if sa["tempo"] != sb["tempo"]:
        diffs.append(f"tempo:        {sa['tempo']} → {sb['tempo']}")
    if sa["time_sig_num"] != sb["time_sig_num"]:
        diffs.append(f"time_sig_num: {sa['time_sig_num']} → {sb['time_sig_num']}")
    if sa["time_sig_den"] != sb["time_sig_den"]:
        diffs.append(f"time_sig_den: {sa['time_sig_den']} → {sb['time_sig_den']}")

    for k in ("MidiTrack", "AudioTrack", "ReturnTrack", "MasterTrack", "GroupTrack"):
        if sa["tracks"].get(k, 0) != sb["tracks"].get(k, 0):
            diffs.append(f"tracks[{k}]: {sa['tracks'].get(k, 0)} → {sb['tracks'].get(k, 0)}")

    for k in ("MidiClip", "AudioClip"):
        if sa["clips"].get(k, 0) != sb["clips"].get(k, 0):
            diffs.append(f"clips[{k}]:  {sa['clips'].get(k, 0)} → {sb['clips'].get(k, 0)}")

    if sa["devices"] != sb["devices"]:
        diffs.append(f"devices:    {sa['devices']} → {sb['devices']}")

    if sa["midi_notes"] != sb["midi_notes"]:
        diffs.append(f"midi_notes: {sa['midi_notes']} → {sb['midi_notes']}")

    if sa["sample_refs"] != sb["sample_refs"]:
        diffs.append(f"sample_refs: {sa['sample_refs']} → {sb['sample_refs']}")

    # Track name diff (top 10 only — the noisy total list is hard to read)
    a_names = sa["track_names"][:10]
    b_names = sb["track_names"][:10]
    if a_names != b_names:
        diffs.append(f"track_names[0:10]: {a_names} → {b_names}")

    if diffs:
        print("== STRUCTURAL DIFFERENCES ==")
        for d in diffs:
            print("  " + d)
        print()
        print(f"VERIFY RESULT: FAIL  {len(diffs)} structural difference(s)")
        return 1

    # Total element count is allowed to drift slightly because Live
    # touches view state and timestamps on every save. Report it but
    # don't fail.
    elem_delta = sb["total_elements"] - sa["total_elements"]
    if elem_delta != 0:
        sign = "+" if elem_delta >= 0 else ""
        print(f"  note: total_elements changed by {sign}{elem_delta} "
              "(view state / timestamps — non-structural)")
        print()

    print("VERIFY RESULT: PASS  structurally equivalent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
