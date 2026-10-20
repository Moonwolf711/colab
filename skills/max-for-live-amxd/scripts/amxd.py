#!/usr/bin/env python3
"""Inspect or pack the simple, unfrozen ampf v4 layout used by stock devices.

This is a container/patcher structure check, not a Max or Live runtime check.
Frozen devices and other container layouts are intentionally unsupported.
"""

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import struct
import tempfile


KINDS = {b"mmmm": "MIDI Effect", b"aaaa": "Audio Effect", b"iiii": "Instrument"}


class AmxdError(ValueError):
    """An unsupported container or malformed patcher."""


@dataclass
class Device:
    prefix: bytes
    document: dict
    terminal_nul: bool
    payload_bytes: int
    patchers: int
    boxes: int
    lines: int

    def summary(self):
        return {
            "format": "simple unfrozen ampf v4",
            "type": KINDS[self.prefix[8:12]],
            "metadata": struct.unpack_from("<I", self.prefix, 20)[0],
            "payload_bytes": self.payload_bytes,
            "terminal_nul": self.terminal_nul,
            "patchers": self.patchers,
            "boxes": self.boxes,
            "patchlines": self.lines,
        }


def decode_json(payload):
    def reject_constant(_value):
        raise AmxdError("Non-finite numbers are not valid JSON")

    try:
        return json.loads(payload.decode("utf-8"), parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AmxdError("Patcher payload must be valid UTF-8 JSON") from exc


def validate_document(document):
    """Return recursive patcher, box, and patchline counts."""
    if not isinstance(document, dict) or not isinstance(document.get("patcher"), dict):
        raise AmxdError("JSON root must contain a patcher object")

    def visit(patcher):
        boxes = patcher.get("boxes", [])
        lines = patcher.get("lines", [])
        if not isinstance(boxes, list) or not isinstance(lines, list):
            raise AmxdError("Each patcher's boxes and lines must be arrays")
        objects = {}
        counts = [1, len(boxes), len(lines)]
        for entry in boxes:
            box = entry.get("box") if isinstance(entry, dict) else None
            if not isinstance(box, dict):
                raise AmxdError("Each boxes entry must contain a box object")
            identifier = box.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise AmxdError("Every box must have a nonempty string id")
            if identifier in objects:
                raise AmxdError("Duplicate box id within one patcher")
            objects[identifier] = box
            for attribute in ("numinlets", "numoutlets"):
                if attribute in box:
                    count = box[attribute]
                    if type(count) is not int or count < 0:
                        raise AmxdError("Declared inlet/outlet counts must be nonnegative integers")
            if "patcher" in box:
                if not isinstance(box["patcher"], dict):
                    raise AmxdError("A nested patcher must be an object")
                nested = visit(box["patcher"])
                counts = [left + right for left, right in zip(counts, nested)]
        for entry in lines:
            line = entry.get("patchline") if isinstance(entry, dict) else None
            if not isinstance(line, dict):
                raise AmxdError("Each lines entry must contain a patchline object")
            for direction, attribute in (("source", "numoutlets"), ("destination", "numinlets")):
                endpoint = line.get(direction)
                if not isinstance(endpoint, list) or len(endpoint) != 2:
                    raise AmxdError("Patchline endpoints must be [box_id, port_index]")
                identifier, port = endpoint
                if not isinstance(identifier, str) or identifier not in objects:
                    raise AmxdError("Patchline endpoint references a missing box")
                if type(port) is not int or port < 0:
                    raise AmxdError("Patchline port indices must be nonnegative integers")
                bound = objects[identifier].get(attribute)
                if bound is not None and port >= bound:
                    raise AmxdError("Patchline port index exceeds a declared inlet/outlet count")
        return tuple(counts)

    return visit(document["patcher"])


def read_device(data):
    if data[:4] != b"ampf":
        raise AmxdError("Expected ampf binary container; raw JSON is not an .amxd device")
    if len(data) < 32:
        raise AmxdError("Truncated ampf header")
    if struct.unpack_from("<I", data, 4)[0] != 4:
        raise AmxdError("Only ampf version 4 is supported")
    if data[8:12] not in KINDS:
        raise AmxdError("Unsupported device type marker")
    if data[12:16] != b"meta" or struct.unpack_from("<I", data, 16)[0] != 4:
        raise AmxdError("Only the simple four-byte meta layout is supported")
    if data[24:28] != b"ptch":
        raise AmxdError("Expected ptch marker at byte 24")
    payload_length = struct.unpack_from("<I", data, 28)[0]
    expected_length = 32 + payload_length
    if len(data) < expected_length:
        raise AmxdError("Truncated patcher payload")
    if len(data) > expected_length:
        raise AmxdError("Trailing container data or frozen sections are unsupported")
    payload = data[32:]
    terminal_nul = payload.endswith(b"\0")
    document = decode_json(payload[:-1] if terminal_nul else payload)
    counts = validate_document(document)
    return Device(data[:28], document, terminal_nul, payload_length, *counts)


def pack_device(template_path, patcher_path, output_path, force=False):
    template_path, patcher_path, output_path = map(Path, (template_path, patcher_path, output_path))
    if output_path.suffix.lower() != ".amxd":
        raise AmxdError("Output must have an .amxd extension")
    for source in (template_path, patcher_path):
        same_path = output_path.resolve() == source.resolve()
        same_file = output_path.exists() and source.exists() and output_path.samefile(source)
        if same_path or same_file:
            raise AmxdError("Output must not overwrite either input")
    template = read_device(template_path.read_bytes())
    document = decode_json(patcher_path.read_bytes())
    validate_document(document)
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if template.terminal_nul:
        payload += b"\0"
    if len(payload) > 0xFFFFFFFF:
        raise AmxdError("Patcher is too large for a 32-bit payload length")
    data = template.prefix + struct.pack("<I", len(payload)) + payload
    device = read_device(data)
    if force:
        # Replace only after the complete, validated file is written successfully.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output_path.parent, suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(data)
            os.replace(temporary, output_path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    else:
        with output_path.open("xb") as handle:
            handle.write(data)
    return device


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_parser = commands.add_parser("inspect", help="Validate and summarize one simple .amxd")
    inspect_parser.add_argument("device", type=Path)
    pack_parser = commands.add_parser("pack", help="Pack .maxpat JSON using an explicit simple .amxd template")
    pack_parser.add_argument("--template", type=Path, required=True)
    pack_parser.add_argument("--patcher", type=Path, required=True)
    pack_parser.add_argument("--output", type=Path, required=True)
    pack_parser.add_argument("--force", action="store_true", help="Replace an existing output, never either input")
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            device = read_device(args.device.read_bytes())
        else:
            device = pack_device(args.template, args.patcher, args.output, args.force)
        print(json.dumps(device.summary(), indent=2))
    except (AmxdError, OSError, RecursionError) as exc:
        parser.exit(1, f"amxd: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
