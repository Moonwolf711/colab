"""Build ClaudeBar.amxd — a thin M4L MIDI Effect device with a jweb chat UI.

Sizes the device to fit the M4L device strip (~570 wide).
Loads claude-chat.html from this folder.
No node.debug: Node for Max is not installed and the object does not
exist in Max 9 - it only produced 'No such object' errors on every load.
"""
import json
import struct
import os

OUT = r"C:\Users\Owner\colab\ClaudeBar.amxd"
HTML_FILE = r"C:/Users/Owner/colab/claude-chat.html"  # forward slashes for Max
HTML_URL = "file:///" + HTML_FILE

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 10, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [40.0, 100.0, 900.0, 500.0],
        "openrect": [0.0, 0.0, 570.0, 160.0],
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontname": "Arial",
        "gridsize": [8.0, 8.0],
        "boxanimatetime": 0,
        "devicewidth": 570.0,
        "description": "Claude chat bar — talks to local Collab-Hub server.",
        "digest": "Claude Terminal Bar",
        "tags": "claude chat",
        "boxes": [
            {"box": {"id": "obj-1", "maxclass": "newobj", "numinlets": 1, "numoutlets": 3,
                     "outlettype": ["", "", ""], "patching_rect": [20.0, 20.0, 110.0, 22.0],
                     "text": "live.thisdevice"}},
            {"box": {"id": "obj-comment", "maxclass": "comment", "numinlets": 1, "numoutlets": 0,
                     "patching_rect": [20.0, 60.0, 540.0, 22.0],
                     "text": "ClaudeBar — jweb UI talks via socket.io to 127.0.0.1:3939/hub"}},
            {"box": {
                "id": "obj-web", "maxclass": "jweb",
                "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                "patching_rect": [20.0, 100.0, 560.0, 150.0],
                "presentation": 1,
                "presentation_rect": [0.0, 0.0, 570.0, 155.0],
                "url": HTML_URL,
                "background": 1,
            }},
            # cursor router — selects Ableton tracks/clips when Claude edits them
            {"box": {"id": "obj-cursor", "maxclass": "newobj", "numinlets": 1, "numoutlets": 0,
                     "patching_rect": [320.0, 280.0, 240.0, 22.0],
                     "text": "js C:/Users/Owner/colab/claude_cursor.js"}},
            # MIDI passthrough (required for MIDI Effect device)
            {"box": {"id": "obj-min",  "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                     "outlettype": [""], "patching_rect": [20.0, 280.0, 50.0, 22.0],
                     "text": "midiin"}},
            {"box": {"id": "obj-mout", "maxclass": "newobj", "numinlets": 1, "numoutlets": 0,
                     "patching_rect": [20.0, 320.0, 50.0, 22.0],
                     "text": "midiout"}},
        ],
        "lines": [
            {"patchline": {"source": ["obj-min", 0], "destination": ["obj-mout", 0]}},
            {"patchline": {"source": ["obj-web", 0], "destination": ["obj-cursor", 0]}},
        ],
    }
}

def build():
    js = json.dumps(patcher, separators=(',', ' : ')).encode('utf-8')
    out = bytearray()
    out += b'ampf' + struct.pack('<I', 4)
    out += b'mmmmmeta' + struct.pack('<I', 4)
    out += struct.pack('<I', 1)
    out += b'ptch' + struct.pack('<I', len(js))
    out += js
    with open(OUT, 'wb') as f:
        f.write(out)
    print(f"wrote {OUT} ({len(out)} bytes)")

if __name__ == "__main__":
    build()
