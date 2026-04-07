"""Unit tests for cli_anything.max.core.* and .utils.max_backend.

These tests use only synthetic data and file I/O in ``tmp_path``. They do
NOT launch Max and are safe to run on any machine with the package
installed.
"""

from __future__ import annotations

import json
import os
import struct
from pathlib import Path

import pytest

from cli_anything.max.core import device as device_mod
from cli_anything.max.core import patch as patch_mod
from cli_anything.max.utils import max_backend


# ── patch.py ─────────────────────────────────────────────────────────


class TestNewPatcher:
    def test_has_required_envelope(self):
        doc = patch_mod.new_patcher()
        assert "patcher" in doc
        p = doc["patcher"]
        assert p["fileversion"] == 1
        assert p["classnamespace"] == "box"
        assert p["boxes"] == []
        assert p["lines"] == []
        assert "appversion" in p and p["appversion"]["major"] == 9

    def test_dimensions_applied(self):
        doc = patch_mod.new_patcher(width=320, height=240)
        assert doc["patcher"]["rect"] == [0, 0, 320, 240]


class TestAddObject:
    def test_auto_id_sequence(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        ids = [pd.add_object("print"), pd.add_object("cycle~ 440"), pd.add_object("dac~")]
        assert ids == ["obj-1", "obj-2", "obj-3"]

    def test_explicit_id(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        assert pd.add_object("print", id="log") == "log"
        box = pd.get_box("log")
        assert box is not None
        assert box["text"] == "print"

    def test_duplicate_id_raises(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("print", id="dup")
        with pytest.raises(patch_mod.PatcherError, match="already used"):
            pd.add_object("print", id="dup")

    def test_outlet_count_default(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("cycle~ 440", id="osc", numoutlets=1)
        box = pd.get_box("osc")
        assert box is not None
        assert box["numoutlets"] == 1
        assert box["outlettype"] == ["anything"]


class TestConnect:
    def _two_box_doc(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("cycle~ 440", id="osc", numoutlets=1)
        pd.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        return pd

    def test_valid_connect_appends_line(self):
        pd = self._two_box_doc()
        pd.connect("osc", 0, "out", 0)
        assert len(pd.lines) == 1
        line = pd.lines[0]["patchline"]
        assert line["source"] == ["osc", 0]
        assert line["destination"] == ["out", 0]

    def test_missing_source_raises(self):
        pd = self._two_box_doc()
        with pytest.raises(patch_mod.PatcherError, match="source id"):
            pd.connect("nope", 0, "out", 0)

    def test_missing_dest_raises(self):
        pd = self._two_box_doc()
        with pytest.raises(patch_mod.PatcherError, match="destination id"):
            pd.connect("osc", 0, "nope", 0)

    def test_out_of_range_outlet_raises(self):
        pd = self._two_box_doc()
        with pytest.raises(patch_mod.PatcherError, match="outlet 5"):
            pd.connect("osc", 5, "out", 0)

    def test_out_of_range_inlet_raises(self):
        pd = self._two_box_doc()
        with pytest.raises(patch_mod.PatcherError, match="inlet 7"):
            pd.connect("osc", 0, "out", 7)


class TestRemoveBox:
    def test_removes_box_and_touching_lines(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("cycle~ 440", id="osc", numoutlets=1)
        pd.add_object("*~ 0.5", id="gain", numinlets=2, numoutlets=1)
        pd.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        pd.connect("osc", 0, "gain", 0)
        pd.connect("gain", 0, "out", 0)
        assert len(pd.lines) == 2
        assert pd.remove_box("gain") is True
        assert pd.get_box("gain") is None
        # Both lines touched gain → both must be gone.
        assert len(pd.lines) == 0

    def test_missing_box_returns_false(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        assert pd.remove_box("ghost") is False


class TestPatcherInfo:
    def test_returns_structured_summary(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("cycle~ 440", id="osc", numoutlets=1)
        pd.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        pd.connect("osc", 0, "out", 0)
        info = patch_mod.patcher_info(pd.doc)
        assert info["boxes"] == 2
        assert info["lines"] == 1
        assert len(info["objects"]) == 2
        assert info["wires"][0]["from"]["id"] == "osc"
        assert info["wires"][0]["to"]["id"] == "out"


class TestPatcherDiff:
    def test_additions_and_removals(self):
        pa = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pa.add_object("cycle~ 440", id="osc", numoutlets=1)
        pa.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        pa.connect("osc", 0, "out", 0)

        pb = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pb.add_object("cycle~ 880", id="osc", numoutlets=1)  # same id
        pb.add_object("gate~", id="gate", numinlets=2, numoutlets=1)
        pb.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        pb.connect("osc", 0, "gate", 0)
        pb.connect("gate", 0, "out", 0)

        diff = patch_mod.patcher_diff(pa.doc, pb.doc)
        assert "gate" in diff["boxes_added"]
        assert diff["boxes_removed"] == []
        assert len(diff["wires_added"]) >= 1
        assert len(diff["wires_removed"]) >= 1


class TestPatcherRoundTrip:
    def test_write_read_preserves_structure(self, tmp_path: Path):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("cycle~ 440", id="osc", numoutlets=1)
        pd.add_object("dac~", id="out", numinlets=2, numoutlets=0)
        pd.connect("osc", 0, "out", 0)

        path = tmp_path / "sine.maxpat"
        patch_mod.write_patcher(pd.doc, path)
        assert path.exists()

        loaded = patch_mod.read_patcher(path)
        # Compare the patcher section (ignores any ordering cosmetics).
        assert loaded["patcher"]["boxes"] == pd.doc["patcher"]["boxes"]
        assert loaded["patcher"]["lines"] == pd.doc["patcher"]["lines"]


# ── device.py ────────────────────────────────────────────────────────


class TestAmxd:
    def _doc(self):
        pd = patch_mod.PatcherDoc(patch_mod.new_patcher())
        pd.add_object("plugin~", id="in", numinlets=0, numoutlets=2)
        pd.add_object("plugout~", id="out", numinlets=2, numoutlets=0)
        pd.connect("in", 0, "out", 0)
        pd.connect("in", 1, "out", 1)
        return pd.doc

    def test_write_read_round_trip(self, tmp_path: Path):
        doc = self._doc()
        amxd_path = tmp_path / "Device.amxd"
        device_mod.write_amxd(doc, amxd_path)
        assert amxd_path.exists()
        loaded = device_mod.read_amxd(amxd_path)
        assert loaded["patcher"]["boxes"] == doc["patcher"]["boxes"]
        assert loaded["patcher"]["lines"] == doc["patcher"]["lines"]

    def test_validate_returns_expected_fields(self, tmp_path: Path):
        doc = self._doc()
        amxd_path = tmp_path / "Device.amxd"
        device_mod.write_amxd(doc, amxd_path)
        info = device_mod.validate_amxd(amxd_path)
        assert info["bytes"] > 0
        assert info["ampf_version"] == 4
        assert info["meta_version"] == 1
        assert info["boxes"] == 2
        assert info["lines"] == 2
        assert info["appversion"]["major"] == 9

    def test_bad_magic_raises(self, tmp_path: Path):
        bad = tmp_path / "bad.amxd"
        bad.write_bytes(b"XXXX" + b"\x00" * 60)
        with pytest.raises(device_mod.AmxdError, match="ampf"):
            device_mod.read_amxd(bad)

    def test_truncated_chunk_raises(self, tmp_path: Path):
        doc = self._doc()
        amxd_path = tmp_path / "trunc.amxd"
        device_mod.write_amxd(doc, amxd_path)
        data = amxd_path.read_bytes()
        # Claim a giant patcher chunk length but keep the real payload small.
        tampered = bytearray(data)
        struct.pack_into("<I", tampered, 28, 10_000_000)
        amxd_path.write_bytes(bytes(tampered))
        with pytest.raises(device_mod.AmxdError, match="patcher chunk claims"):
            device_mod.read_amxd(amxd_path)

    def test_missing_patcher_key_raises(self, tmp_path: Path):
        with pytest.raises(device_mod.AmxdError, match="top-level 'patcher'"):
            device_mod.write_amxd({"not_a_patcher": {}}, tmp_path / "nope.amxd")


# ── max_backend.py ───────────────────────────────────────────────────


class TestMaxBackend:
    def test_find_max_exe_on_this_machine(self):
        # Max 9 is known to be installed on this development machine.
        exe = max_backend.find_max_exe()
        assert exe.exists()
        assert exe.is_file()

    def test_env_override_honored(self, tmp_path: Path, monkeypatch):
        fake = tmp_path / "fake_max.exe"
        fake.write_bytes(b"PE\x00\x00")  # just needs to exist
        monkeypatch.setenv("MAX_EXE", str(fake))
        assert max_backend.find_max_exe() == fake

    def test_invalid_env_override_raises(self, monkeypatch):
        monkeypatch.setenv("MAX_EXE", r"C:\does\not\exist\Max.exe")
        with pytest.raises(max_backend.MaxNotInstalledError, match="does not exist"):
            max_backend.find_max_exe()

    def test_install_info_has_platform(self):
        info = max_backend.max_install_info()
        assert "platform" in info
        assert isinstance(info["platform"], str)
