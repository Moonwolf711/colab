"""
Build CoLanew.amxd for BOTH local and HAVEN.
- Local: colab_livesync.js, peer=192.168.0.83, UI=control-panel-ui.js
- HAVEN: colab_livesync_haven.js, peer=192.168.0.3, UI=control-panel-ui-haven.js
"""
import json, struct, shutil, os
from m4l_builder import MidiEffect

# Get proper ampf header from m4l_builder
device = MidiEffect("CoLanew", width=477, height=200)
device.add_newobj("x", "live.thisdevice", numinlets=1, numoutlets=3, outlettype=["bang","int","int"])
header = bytearray(device.to_bytes()[:32])

def build_amxd(js_file, peer_ip, ui_js_path, output_path):
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
                         "jspainterfile": ui_js_path,
                         "filename": os.path.basename(ui_js_path),
                         "textfile": {"filename": os.path.basename(ui_js_path), "flags": 0, "embed": 0, "autowatch": 1}}},
                {"box": {"maxclass": "message", "text": f"connect {peer_ip}",
                         "patching_rect": [365, 149, 108, 20], "numoutlets": 1,
                         "outlettype": [""], "id": "obj-2", "numinlets": 2}},
                {"box": {"maxclass": "newobj", "text": "prepend incoming",
                         "patching_rect": [217, 154, 95, 20], "numoutlets": 1,
                         "outlettype": [""], "id": "obj-34", "numinlets": 1}},
                {"box": {"maxclass": "newobj", "text": "udpreceive 8001",
                         "patching_rect": [307, 121, 86, 20], "numoutlets": 1,
                         "outlettype": [""], "id": "obj-33", "numinlets": 1}},
                {"box": {"maxclass": "newobj", "text": f"udpsend {peer_ip} 8001",
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
                {"box": {"maxclass": "newobj", "text": f"js {js_file}",
                         "patching_rect": [142, 22, 204, 20], "numoutlets": 1,
                         "outlettype": [""], "id": "obj-24", "numinlets": 1,
                         "saved_object_attributes": {"filename": js_file, "parameter_enable": 0}}},
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
    h = bytearray(header)
    struct.pack_into('<I', h, 28, len(json_bytes))

    with open(output_path, 'wb') as f:
        f.write(h)
        f.write(json_bytes)

    print(f"  Built: {output_path} ({len(h) + len(json_bytes)} bytes)")

# ========== LOCAL VERSION ==========
LOCAL_M4L_DIR = "C:/Users/Owner/OneDrive/Desktop/ONE DRIVE NEW/OneDrive/Documents/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect"
LOCAL_JS = "C:/Users/Owner/colab/colab_livesync.js"
LOCAL_UI = "C:/Users/Owner/OneDrive/Desktop/ONE DRIVE NEW/OneDrive/Documents/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/control-panel-ui.js"

print("=== Building LOCAL CoLanew.amxd ===")
print(f"  JS engine: colab_livesync.js (peer=192.168.0.83)")

# Copy UI to M4L dir so Max can find it
ui_src = "C:/Users/Owner/colab/control-panel-ui.js"
if os.path.exists(ui_src):
    shutil.copy2(ui_src, LOCAL_UI)
    print(f"  Copied control-panel-ui.js -> M4L dir")

build_amxd(LOCAL_JS, "192.168.0.83", LOCAL_UI, f"{LOCAL_M4L_DIR}/CoLanew.amxd")

# ========== HAVEN VERSION ==========
HAVEN_JS = "C:/Users/Owner/colab/colab_livesync_haven.js"
HAVEN_UI = "C:/Users/Owner/colab/control-panel-ui-haven.js"
HAVEN_OUTPUT = "C:/Users/Owner/colab/CoLanew-HAVEN.amxd"

# Create HAVEN UI with IP = 192.168.0.3
if os.path.exists(ui_src):
    with open(ui_src, 'r') as f:
        ui_code = f.read()
    ui_code = ui_code.replace("ipOctets = [192, 168, 0, 83]", "ipOctets = [192, 168, 0, 3]")
    with open(HAVEN_UI, 'w') as f:
        f.write(ui_code)
    print(f"  Created control-panel-ui-haven.js (peer=192.168.0.3)")

print("=== Building HAVEN CoLanew.amxd ===")
print(f"  JS engine: colab_livesync_haven.js (peer=192.168.0.3)")

# HAVEN paths — must use HAVEN's filesystem paths
HAVEN_M4L_UI = "C:/Users/4382/colab/control-panel-ui-haven.js"
HAVEN_JS_PATH = "C:/Users/4382/colab/colab_livesync_haven.js"
build_amxd(HAVEN_JS_PATH, "192.168.0.3", HAVEN_M4L_UI, HAVEN_OUTPUT)

print("\n=== DONE ===")
print(f"LOCAL: {LOCAL_M4L_DIR}/CoLanew.amxd")
print(f"HAVEN: {HAVEN_OUTPUT} (ready to SCP)")
