"""Build the unfrozen native MIDI effect and its adjacent runtime files.

The installed stock Max MIDI Effect.amxd has metadata 0. Older CoLaB builders
used 1, described as a "meta_version"; we preserve the verified stock header
instead. This is an unfrozen AMXD, not a fabricated dependency archive.
"""

import argparse
import json
import shutil
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEVICE = ROOT / "device"
NAME = "CoLaB MouseMux"
WIDTH = 620
HEIGHT = 169
STOCK = Path(
    "C:/ProgramData/Ableton/Live 12 Suite/Resources/Misc/Max Devices/Max MIDI Effect.amxd"
)


def make_patcher():
    boxes = []
    lines = []

    def box(identity, maxclass, rect, **properties):
        value = {
            "id": identity,
            "maxclass": maxclass,
            "patching_rect": rect,
            "numinlets": 1,
            "numoutlets": 0,
        }
        value.update(properties)
        boxes.append({"box": value})

    def obj(identity, text, x, y, outlets=1, **properties):
        box(identity, "newobj", [x, y, max(65, min(len(text) * 6, 470)), 22],
            text=text, numoutlets=outlets, outlettype=[""] * outlets, **properties)

    def line(source, destination, outlet=0, inlet=0):
        lines.append({"patchline": {"source": [source, outlet], "destination": [destination, inlet]}})

    box("panel", "v8ui", [12, 12, WIDTH, HEIGHT], numoutlets=0, parameter_enable=0,
        presentation=1, presentation_rect=[0, 0, WIDTH, HEIGHT], background=1, ignoreclick=1,
        filename="colab-mousemux-panel.js",
        textfile={"filename": "colab-mousemux-panel.js", "flags": 0, "embed": 0, "autowatch": 0})

    actions = [
        ("launch", "Start MouseMux", "startmousemux", 106),
        ("connect", "Connect", "connect", 70),
        ("disconnect", "Disconnect", "disconnect", 80),
        ("refresh", "Refresh", "refresh", 58),
        ("native", "Native", "mode native", 68),
        ("switched", "Switched", "mode switched", 78),
        ("multiplex", "Multiplex", "mode multiplex", 84),
    ]
    x = 12
    for index, (identity, label, command, width) in enumerate(actions):
        box(identity, "live.text", [15 + index * 88, 230, width, 22],
            presentation=1, presentation_rect=[x, 123, width, 23],
            mode=0, parameter_enable=0, parameter_mappable=0, text=label, texton=label,
            annotation_name=label,
            annotation=("Requests a desktop-wide MouseMux mode. Wait for the reported mode above."
                        if command.startswith("mode ") else
                        "Disconnect this controller; leave MouseMux's desktop mode unchanged."
                        if identity == "disconnect" else
                        "Read the current MouseMux mode and physical mouse users."
                        if identity == "refresh" else
                        "Connect to the installed MouseMux Web SDK without changing its mode."
                        if identity == "connect" else
                        "Open the installed MouseMux application; then click Connect."),
            numoutlets=2, outlettype=["bang", ""], fontsize=10,
            activebgcolor=[0.24, 0.27, 0.31, 1],
            activebgoncolor=[0.35, 0.55, 0.48, 1],
            activetextcolor=[0.92, 0.94, 0.96, 1],
            activetextoncolor=[1, 1, 1, 1])
        box(identity + "-message", "message", [15 + index * 88, 300, 85, 22],
            text=command, numinlets=2, numoutlets=1, outlettype=[""])
        # In button mode live.text emits a bang, not the integer 1.
        line(identity, identity + "-message")
        line(identity + "-message", "manager")
        x += width + 6

    obj("manager", "node.script colab-mousemux-manager.js @autostart 1 @watch 0 @restart 0 @defer 1",
        15, 380, outlets=2,
        saved_object_attributes={"autostart": 1, "watch": 0, "restart": 0, "defer": 1})
    line("manager", "panel")
    obj("node-status", "print MouseMux-Node", 480, 415, outlets=0)
    line("manager", "node-status", outlet=1)

    obj("thisdevice", "live.thisdevice", 15, 450, outlets=3)
    obj("defer-init", "deferlow", 15, 480)
    box("init", "message", [15, 510, 40, 22], text="init", numinlets=2, numoutlets=1, outlettype=[""])
    obj("host", "v8 colab-mousemux-host.js", 15, 540)
    line("thisdevice", "defer-init")
    line("defer-init", "init")
    line("init", "host")
    line("host", "panel")

    obj("midi-in", "midiin", 320, 450)
    obj("midi-out", "midiout", 320, 485, outlets=0)
    line("midi-in", "midi-out")
    obj("free", "freebang", 450, 450)
    box("stop", "message", [450, 480, 40, 22], text="stop", numinlets=2, numoutlets=1, outlettype=[""])
    line("free", "stop")
    line("stop", "manager")

    box("debug-toggle", "toggle", [450, 545, 20, 20], numoutlets=1, outlettype=["int"], parameter_enable=0)
    obj("debug", "node.debug 9229", 480, 545)
    line("debug-toggle", "debug")
    line("debug", "manager")
    box("debug-label", "comment", [450, 575, 275, 38],
        text="Optional local Node inspector. Off by default.\nnode.debug is the supplied abstraction.", numinlets=1)
    box("scope", "comment", [15, 605, 650, 40],
        text="Installed MouseMux performs all cursor operations. Loading or removing this device does not change desktop mode.\nUse Native explicitly to restore standard MouseMux behavior.")

    patcher = {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 10, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100, 100, 750, 680],
        "openrect": [0, 0, WIDTH, HEIGHT],
        "devicewidth": WIDTH,
        "openinpresentation": 1,
        "default_fontsize": 11,
        "default_fontname": "Arial",
        "gridsize": [8, 8],
        "subpatcher_template": "AbletonLive",
        "description": "Native MouseMux control and two-mouse status for Ableton Live",
        "digest": "Controls the installed MouseMux engine; MIDI passes through.",
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [
            {"name": "colab-mousemux-manager.js", "type": "TEXT", "implicit": 1},
            {"name": "colab-mousemux-panel.js", "type": "TEXT", "implicit": 1},
            {"name": "colab-mousemux-host.js", "type": "TEXT", "implicit": 1},
            {"name": "node.debug.maxpat", "type": "JSON", "implicit": 1},
        ],
        "autosave": 0,
    }
    return {"patcher": patcher}


def make_debug():
    # Max ships no node.debug external. This explicit abstraction satisfies the
    # workspace debugging convention without introducing an unknown Max object.
    return {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 10, "architecture": "x64"},
        "rect": [100, 100, 340, 200],
        "boxes": [
            {"box": {"id": "in", "maxclass": "inlet", "patching_rect": [30, 25, 30, 30], "numinlets": 0, "numoutlets": 1}},
            {"box": {"id": "prefix", "maxclass": "newobj", "text": "prepend debug", "patching_rect": [30, 65, 100, 22], "numinlets": 1, "numoutlets": 1}},
            {"box": {"id": "port", "maxclass": "newobj", "text": "append #1", "patching_rect": [30, 100, 100, 22], "numinlets": 1, "numoutlets": 1}},
            {"box": {"id": "out", "maxclass": "outlet", "patching_rect": [30, 140, 30, 30], "numinlets": 1, "numoutlets": 0}},
        ],
        "lines": [
            {"patchline": {"source": ["in", 0], "destination": ["prefix", 0]}},
            {"patchline": {"source": ["prefix", 0], "destination": ["port", 0]}},
            {"patchline": {"source": ["port", 0], "destination": ["out", 0]}},
        ],
    }}


def validate(patcher):
    boxes = {entry["box"]["id"]: entry["box"] for entry in patcher["patcher"]["boxes"]}
    assert len(boxes) == len(patcher["patcher"]["boxes"]), "Duplicate box IDs"
    for entry in patcher["patcher"]["lines"]:
        connection = entry["patchline"]
        source, outlet = connection["source"]
        destination, inlet = connection["destination"]
        assert source in boxes and destination in boxes, "Dangling patch cord"
        assert 0 <= outlet < boxes[source]["numoutlets"], "Invalid outlet"
        assert 0 <= inlet < boxes[destination]["numinlets"], "Invalid inlet"
    assert any(entry["patchline"] == {"source": ["midi-in", 0], "destination": ["midi-out", 0]}
               for entry in patcher["patcher"]["lines"]), "MIDI passthrough is missing"
    for box in boxes.values():
        if box.get("presentation"):
            x, y, width, height = box["presentation_rect"]
            assert x >= 0 and y >= 0 and x + width <= WIDTH and y + height <= HEIGHT, \
                "Presentation object exceeds Live's device panel"


def encode_amxd(patcher, template_path=STOCK):
    """Preserve the installed simple MIDI template, including its terminal NUL.

    CI without Live uses the same verified stock header and NUL convention.
    Unknown chunks or frozen archives must be handled by Max, never truncated.
    """
    header = b"ampf" + struct.pack("<I", 4) + b"mmmmmeta" + struct.pack("<II", 4, 0) + b"ptch"
    terminal_nul = True
    if template_path is not None and template_path.exists():
        template = template_path.read_bytes()
        if len(template) < 32 or template[:20] != header[:20] or template[24:28] != b"ptch":
            raise ValueError("Installed MIDI template is not the verified simple unfrozen format")
        if len(template) != 32 + struct.unpack_from("<I", template, 28)[0]:
            raise ValueError("Installed MIDI template has truncated data or unsupported extra chunks")
        template_payload = template[32:]
        terminal_nul = template_payload.endswith(b"\0")
        template_document = json.loads(template_payload[:-1] if terminal_nul else template_payload)
        if not isinstance(template_document, dict) or not isinstance(template_document.get("patcher"), dict):
            raise ValueError("Installed MIDI template has no patcher object")
        header = template[:28]
    payload = json.dumps(patcher, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if terminal_nul:
        payload += b"\0"
    data = header + struct.pack("<I", len(payload)) + payload
    assert json.loads(data[32:-1] if terminal_nul else data[32:]) == patcher
    return data


def build(output):
    patcher = make_patcher()
    validate(patcher)
    DEVICE.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    (DEVICE / f"{NAME}.maxpat").write_text(json.dumps(patcher, indent=2), encoding="utf-8")
    (DEVICE / "node.debug.maxpat").write_text(json.dumps(make_debug(), indent=2), encoding="utf-8")
    data = encode_amxd(patcher)
    (output / f"{NAME}.amxd").write_bytes(data)
    assert data[:4] == b"ampf" and data[8:16] == b"mmmmmeta"
    for source in DEVICE.iterdir():
        if source.suffix in (".js", ".maxpat") or source.name == "package.json":
            shutil.copy2(source, output / source.name)
    print(f"Built {output / (NAME + '.amxd')} ({len(data):,} bytes)")
    print("Validated MIDI header, JSON round trip, all patch cords, and MIDI passthrough.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / NAME)
    build(parser.parse_args().output.resolve())
