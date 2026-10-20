"""Offline tests; no Max, Ableton Live, network, or third-party dependencies."""

import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest

import amxd


def patcher():
    return {"patcher": {
        "boxes": [
            {"box": {"id": "input", "numinlets": 0, "numoutlets": 1}},
            {"box": {"id": "output", "numinlets": 1, "numoutlets": 0}},
        ],
        "lines": [{"patchline": {"source": ["input", 0], "destination": ["output", 0]}}],
    }}


def container(document=None, nul=True, kind=b"mmmm", metadata=0):
    payload = json.dumps(document if document is not None else patcher(), ensure_ascii=False).encode("utf-8")
    payload += b"\0" if nul else b""
    return (b"ampf" + struct.pack("<I", 4) + kind + b"meta"
            + struct.pack("<II", 4, metadata) + b"ptch"
            + struct.pack("<I", len(payload)) + payload)


class ContainerTests(unittest.TestCase):
    def test_all_kinds_and_optional_nul(self):
        for kind, name in amxd.KINDS.items():
            for nul in (False, True):
                with self.subTest(kind=kind, nul=nul):
                    device = amxd.read_device(container(kind=kind, nul=nul))
                    self.assertEqual(device.summary()["type"], name)
                    self.assertEqual(device.terminal_nul, nul)
                    self.assertEqual((device.patchers, device.boxes, device.lines), (1, 2, 1))

    def test_raw_json_is_not_a_device(self):
        with self.assertRaisesRegex(amxd.AmxdError, "raw JSON"):
            amxd.read_device(json.dumps(patcher()).encode())

    def test_header_and_container_corruption(self):
        valid = container()
        corruptions = {
            "truncated header": valid[:12],
            "version": valid[:4] + struct.pack("<I", 5) + valid[8:],
            "kind": valid[:8] + b"zzzz" + valid[12:],
            "meta marker": valid[:12] + b"xxxx" + valid[16:],
            "meta size": valid[:16] + struct.pack("<I", 8) + valid[20:],
            "ptch marker": valid[:24] + b"xxxx" + valid[28:],
            "truncated payload": valid[:-2],
            "frozen/trailing data": valid + b"dlst\x00\x00\x00\x00",
        }
        for label, data in corruptions.items():
            with self.subTest(label=label), self.assertRaises(amxd.AmxdError):
                amxd.read_device(data)

    def test_invalid_utf8_json_and_extra_nul(self):
        for payload in (b"\xff", b"{", b'{"patcher": NaN}', b"{}\0\0"):
            data = container()[:28] + struct.pack("<I", len(payload)) + payload
            with self.subTest(payload=payload), self.assertRaises(amxd.AmxdError):
                amxd.read_device(data)

    def test_root_shape(self):
        for document in ([], {}, {"patcher": []}):
            with self.subTest(document=document), self.assertRaises(amxd.AmxdError):
                amxd.read_device(container(document))

    def test_duplicate_and_dangling_box_ids(self):
        duplicate = patcher()
        duplicate["patcher"]["boxes"][1]["box"]["id"] = "input"
        dangling = patcher()
        dangling["patcher"]["lines"][0]["patchline"]["source"][0] = "missing"
        for document in (duplicate, dangling):
            with self.subTest(document=document), self.assertRaises(amxd.AmxdError):
                amxd.read_device(container(document))

    def test_endpoint_port_validation(self):
        for endpoint in (["input", -1], ["input", True], ["input", 1], ["input"], "input"):
            document = patcher()
            document["patcher"]["lines"][0]["patchline"]["source"] = endpoint
            with self.subTest(endpoint=endpoint), self.assertRaises(amxd.AmxdError):
                amxd.read_device(container(document))

    def test_nested_patcher_ids_are_local_and_wiring_is_checked(self):
        document = patcher()
        nested = copy.deepcopy(document["patcher"])
        document["patcher"]["boxes"][0]["box"]["patcher"] = nested
        device = amxd.read_device(container(document))
        self.assertEqual((device.patchers, device.boxes, device.lines), (2, 4, 2))
        nested["lines"][0]["patchline"]["destination"][0] = "missing"
        with self.assertRaisesRegex(amxd.AmxdError, "missing box"):
            amxd.read_device(container(document))


class PackTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.template = self.root / "template.amxd"
        self.patcher_file = self.root / "patcher.maxpat"
        self.output = self.root / "output.amxd"
        self.template.write_bytes(container())
        self.document = patcher()
        self.document["patcher"]["description"] = "Caf\u00e9 \U0001f3b9 \u65e5\u672c\u8a9e"
        self.patcher_file.write_text(json.dumps(self.document, ensure_ascii=False), encoding="utf-8")

    def test_unicode_byte_lengths_and_template_preservation(self):
        for nul in (False, True):
            with self.subTest(nul=nul):
                original = container(nul=nul, kind=b"iiii", metadata=123)
                self.template.write_bytes(original)
                device = amxd.pack_device(self.template, self.patcher_file, self.output, force=True)
                result = self.output.read_bytes()
                self.assertEqual(result[:28], original[:28])
                self.assertEqual(struct.unpack_from("<I", result, 28)[0], len(result) - 32)
                self.assertEqual(result.endswith(b"\0"), nul)
                self.assertEqual(device.document, self.document)
                payload = result[32:-1] if nul else result[32:]
                self.assertGreater(len(payload), len(payload.decode("utf-8")))

    def test_existing_output_is_not_overwritten_without_force(self):
        self.output.write_bytes(b"keep existing output")
        with self.assertRaises(FileExistsError):
            amxd.pack_device(self.template, self.patcher_file, self.output)
        self.assertEqual(self.output.read_bytes(), b"keep existing output")
        amxd.pack_device(self.template, self.patcher_file, self.output, force=True)
        self.assertEqual(amxd.read_device(self.output.read_bytes()).document, self.document)

    def test_new_output_is_created_without_force(self):
        device = amxd.pack_device(self.template, self.patcher_file, self.output)
        self.assertEqual(device.document, self.document)
        self.assertEqual(amxd.read_device(self.output.read_bytes()).document, self.document)

    def test_inputs_cannot_be_overwritten_even_with_force(self):
        # Also test JSON input with an .amxd suffix so the path check, rather than
        # the output-extension check, has to protect it.
        json_input = self.root / "json-input.amxd"
        json_input.write_bytes(self.patcher_file.read_bytes())
        for source in (self.template, json_input):
            original = source.read_bytes()
            with self.subTest(source=source), self.assertRaises(amxd.AmxdError):
                amxd.pack_device(self.template, json_input, source, force=True)
            self.assertEqual(source.read_bytes(), original)

    def test_invalid_source_preserves_existing_output(self):
        self.output.write_bytes(b"keep existing output")
        self.patcher_file.write_text('{"patcher": {"boxes": [null]}}', encoding="utf-8")
        with self.assertRaises(amxd.AmxdError):
            amxd.pack_device(self.template, self.patcher_file, self.output, force=True)
        self.assertEqual(self.output.read_bytes(), b"keep existing output")
        self.assertEqual(list(self.root.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
