import json, struct
from m4l_builder import MidiEffect

# Get proper header from m4l_builder
device = MidiEffect("CoLanew", width=477, height=200)
device.add_newobj("x", "live.thisdevice", numinlets=1, numoutlets=3, outlettype=["bang","int","int"])
header = device.to_bytes()[:32]

# Use the EXACT working patcher from the user, just add presentation to v8ui
patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 10, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [0, 0, 477, 200],
        "openrect": [0, 0, 477, 200],
        "openinpresentation": 1,
        "default_fontsize": 10,
        "default_fontname": "Arial",
        "gridsize": [8, 8],
        "boxanimatetime": 500,
        "devicewidth": 477,
        "boxes": [
            {"box": {"maxclass": "v8ui", "patching_rect": [312, 218, 548, 165],
                     "numoutlets": 1, "outlettype": [""], "parameter_enable": 0,
                     "id": "obj-1", "numinlets": 1,
                     "presentation": 1,
                     "presentation_rect": [0, 0, 477, 169],
                     "jspainterfile": "C:/Users/Owner/OneDrive/Desktop/ONE DRIVE NEW/OneDrive/Documents/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/control-panel-ui.js",
                     "filename": "control-panel-ui.js",
                     "textfile": {"filename": "control-panel-ui.js", "flags": 0, "embed": 0, "autowatch": 1}}},
            {"box": {"maxclass": "message", "text": "connect 192.168.0.83",
                     "patching_rect": [365, 149, 108, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-2", "numinlets": 2}},
            {"box": {"maxclass": "newobj", "text": "prepend incoming",
                     "patching_rect": [217, 154, 95, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-34", "numinlets": 1}},
            {"box": {"maxclass": "newobj", "text": "udpreceive 8001",
                     "patching_rect": [307, 121, 86, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-33", "numinlets": 1}},
            {"box": {"maxclass": "newobj", "text": "udpsend 192.168.0.83 8001",
                     "patching_rect": [31, 144, 136, 20], "numoutlets": 0,
                     "id": "obj-32", "numinlets": 1}},
            {"box": {"maxclass": "newobj", "text": "metro 100",
                     "patching_rect": [68.75, 8, 56, 20], "numoutlets": 1,
                     "outlettype": ["bang"], "id": "obj-31", "numinlets": 2}},
            {"box": {"maxclass": "message", "text": "poll",
                     "patching_rect": [82, 68, 29.5, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-30", "numinlets": 2}},
            {"box": {"maxclass": "message", "text": "compile",
                     "patching_rect": [114, 99, 46, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-28", "numinlets": 2}},
            {"box": {"maxclass": "message", "text": "init",
                     "patching_rect": [390, 55, 29.5, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-26", "numinlets": 2}},
            {"box": {"maxclass": "newobj", "text": "js C:/Users/Owner/colab/colab_hub_v4.js",
                     "patching_rect": [142, 22, 204, 20], "numoutlets": 1,
                     "outlettype": [""], "id": "obj-24", "numinlets": 1,
                     "saved_object_attributes": {"filename": "C:/Users/Owner/colab/colab_hub_v4.js", "parameter_enable": 0}}},
            {"box": {"maxclass": "newobj", "text": "live.thisdevice",
                     "patching_rect": [238, 66, 77, 20], "numoutlets": 3,
                     "outlettype": ["bang", "int", "int"], "id": "obj-23", "numinlets": 1}}
        ],
        "lines": [
            {"patchline": {"source": ["obj-1", 0], "destination": ["obj-24", 0]}},
            {"patchline": {"source": ["obj-34", 0], "destination": ["obj-24", 0]}},
            {"patchline": {"source": ["obj-33", 0], "destination": ["obj-34", 0]}},
            {"patchline": {"source": ["obj-31", 0], "destination": ["obj-30", 0]}},
            {"patchline": {"source": ["obj-30", 0], "destination": ["obj-24", 0]}},
            {"patchline": {"source": ["obj-28", 0], "destination": ["obj-24", 0]}},
            {"patchline": {"source": ["obj-26", 0], "destination": ["obj-24", 0]}},
            {"patchline": {"source": ["obj-24", 0], "destination": ["obj-32", 0]}},
            {"patchline": {"source": ["obj-23", 0], "destination": ["obj-31", 0], "order": 1}},
            {"patchline": {"source": ["obj-23", 0], "destination": ["obj-26", 0], "order": 0}},
            {"patchline": {"source": ["obj-2", 0], "destination": ["obj-24", 0]}}
        ]
    }
}

json_bytes = json.dumps(patcher).encode('utf-8')
header = bytearray(header)
struct.pack_into('<I', header, 28, len(json_bytes))

dst = "C:/Users/Owner/OneDrive/Desktop/ONE DRIVE NEW/OneDrive/Documents/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/CoLanew.amxd"
with open(dst, 'wb') as f:
    f.write(header)
    f.write(json_bytes)

# Also save as CoLaB Sync
dst2 = dst.replace("CoLanew.amxd", "CoLaB Sync.amxd")
with open(dst2, 'wb') as f:
    f.write(header)
    f.write(json_bytes)

print(f"Built: {len(header) + len(json_bytes)} bytes")
print("Added: presentation=1, presentation_rect=[0,0,477,169], jspainterfile")
