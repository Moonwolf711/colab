"""Package regressions; these checks do not substitute for loading in Live."""

import importlib.util
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("device_builder", ROOT / "scripts" / "build-device.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class DeviceTests(unittest.TestCase):
    def setUp(self):
        self.document = BUILDER.make_patcher()
        self.boxes = {entry["box"]["id"]: entry["box"] for entry in self.document["patcher"]["boxes"]}
        self.lines = [entry["patchline"] for entry in self.document["patcher"]["lines"]]

    def test_momentary_action_bangs_reach_command_messages(self):
        commands = {
            "launch": "startmousemux", "connect": "connect", "disconnect": "disconnect",
            "refresh": "refresh", "native": "mode native", "switched": "mode switched",
            "multiplex": "mode multiplex",
        }
        for identity, command in commands.items():
            with self.subTest(action=identity):
                control = self.boxes[identity]
                self.assertEqual((control["maxclass"], control["mode"]), ("live.text", 0))
                self.assertEqual(control["parameter_enable"], 0)
                self.assertIn({"source": [identity, 0], "destination": [identity + "-message", 0]}, self.lines)
                self.assertEqual(self.boxes[identity + "-message"]["text"], command)
                self.assertIn({"source": [identity + "-message", 0], "destination": ["manager", 0]}, self.lines)

    def test_presentation_and_signal_path(self):
        BUILDER.validate(self.document)
        self.assertEqual(self.document["patcher"]["openrect"][3], 169)
        self.assertEqual(self.boxes["panel"]["ignoreclick"], 1)
        self.assertEqual(self.boxes["panel"]["background"], 1)
        self.assertIn({"source": ["midi-in", 0], "destination": ["midi-out", 0]}, self.lines)
        self.assertIn({"source": ["thisdevice", 0], "destination": ["defer-init", 0]}, self.lines)
        self.assertIn({"source": ["init", 0], "destination": ["host", 0]}, self.lines)
        self.assertNotIn({"source": ["init", 0], "destination": ["manager", 0]}, self.lines)

    def test_all_adjacent_max_dependencies_exist(self):
        for dependency in self.document["patcher"]["dependency_cache"]:
            self.assertTrue((ROOT / "device" / dependency["name"]).is_file(), dependency["name"])
            self.assertFalse(Path(dependency["name"]).is_absolute())

    def test_panel_draws_the_same_script_instance_that_receives_state(self):
        panel = self.boxes["panel"]
        self.assertEqual(panel["filename"], "colab-mousemux-panel.js")
        self.assertEqual(panel["textfile"]["filename"], panel["filename"])
        self.assertNotIn("jspainterfile", panel)
        self.assertIn({"source": ["host", 0], "destination": ["panel", 0]}, self.lines)
        self.assertIn({"source": ["manager", 0], "destination": ["panel", 0]}, self.lines)

    def test_packaged_manager_loads_under_an_esm_ancestor_without_starting_bridge(self):
        with tempfile.TemporaryDirectory() as temporary:
            ancestor = Path(temporary)
            (ancestor / "package.json").write_text('{"type":"module"}', encoding="utf-8")
            source = ancestor / "source"
            shutil.copytree(ROOT / "device", source)
            installed = ancestor / "Live User Library" / BUILDER.NAME
            # Exercise real packaging without rewriting the working tree or dist.
            with patch.object(BUILDER, "DEVICE", source), redirect_stdout(io.StringIO()):
                BUILDER.build(installed)
            self.assertEqual(json.loads((installed / "package.json").read_text())["type"], "commonjs")
            max_api = installed / "node_modules" / "max-api"
            max_api.mkdir(parents=True)
            (max_api / "index.js").write_text(
                "module.exports={addHandler(){},outlet(...args){console.log(JSON.stringify(args))}};",
                encoding="utf-8",
            )
            result = subprocess.run(
                [os.environ.get("MOUSEMUX_TEST_NODE", "node"), str(installed / "colab-mousemux-manager.js")],
                env={**os.environ, "MAX_ENV": "maxforlive"}, capture_output=True, text=True,
                cwd=installed, timeout=10, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output[0], "event")
            initial_state = json.loads(output[1])
            self.assertEqual((initial_state["event"], initial_state["state"]), ("status", "disconnected"))

    def test_ci_fallback_keeps_stock_nul_inside_payload_length(self):
        data = BUILDER.encode_amxd(self.document, template_path=None)
        self.assertEqual(data[:16], b"ampf\x04\0\0\0mmmmmeta")
        self.assertEqual(struct.unpack_from("<I", data, 20)[0], 0)
        self.assertEqual(struct.unpack_from("<I", data, 28)[0], len(data) - 32)
        self.assertEqual(data[-1:], b"\0")
        self.assertEqual(json.loads(data[32:-1]), self.document)

    def test_template_header_and_nul_convention_are_preserved(self):
        for terminal_nul in (False, True):
            with self.subTest(terminal_nul=terminal_nul), tempfile.TemporaryDirectory() as temporary:
                payload = b'{"patcher":{}}' + (b"\0" if terminal_nul else b"")
                prefix = b"ampf" + struct.pack("<I", 4) + b"mmmmmeta" + struct.pack("<II", 4, 7) + b"ptch"
                template = Path(temporary) / "template.amxd"
                template.write_bytes(prefix + struct.pack("<I", len(payload)) + payload)
                data = BUILDER.encode_amxd(self.document, template)
                self.assertEqual(data[:28], prefix)
                self.assertEqual(data.endswith(b"\0"), terminal_nul)
                self.assertEqual(struct.unpack_from("<I", data, 28)[0], len(data) - 32)

    def test_unknown_chunks_and_truncated_template_are_not_discarded(self):
        stock = BUILDER.encode_amxd(self.document, template_path=None)
        for malformed in (stock + b"unknown", stock[:-1], b'{"patcher":{}}'):
            with self.subTest(size=len(malformed)), tempfile.TemporaryDirectory() as temporary:
                template = Path(temporary) / "template.amxd"
                template.write_bytes(malformed)
                with self.assertRaises(ValueError):
                    BUILDER.encode_amxd(self.document, template)


if __name__ == "__main__":
    unittest.main()
