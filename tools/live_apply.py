"""Serialized arrangement applier: writes MIDI + audio clips into Ableton's ARRANGEMENT view.

    python C:/Users/Owner/colab/tools/live_apply.py PLAN.json [--clear-range START END]
                                                    [--dry-run] [--stage-scene N]

Only this script writes to Live. Builders produce plan files; this applies them one at a
time, addressing tracks by NAME (indices shift whenever a track is created).

------------------------------------------------------------------ PLAN JSON SCHEMA
{
  "name": "optional label for logging",
  "tracks": {
    "HH": {                              # exact template track name; "SYNTH 1#2" = 2nd duplicate
      "clear_range": [2, 384],           # OPTIONAL, per-track. Before placing, delete THIS
                                         # track's arrangement clips whose START is in
                                         # [2, 384). Tracks without the key are untouched.
                                         # Matching is on start_time, not overlap, so a
                                         # clip starting at 0 or at 384+ always survives.
      "clips": [
        { "start_beat": 128, "length_beats": 8, "name": "hh drop A",
          "notes": [ {"pitch": 60, "start_time": 0.0, "duration": 0.25, "velocity": 90} ] }
      ]
    },
    "(SPICE) DRUMS": {                   # AUDIO track -> "file" instead of "notes"
      "clips": [
        { "start_beat": 128, "length_beats": 16, "name": "top loop",
          "file": "X:/Samples/Sol Good Samples Vol 2/Drums/Top Loops/SG Vol 2 - Shaker Loop 1.wav",
          "gain_db": -3.0,               # optional, default 0
          "warp": true,                  # optional, default true (tempo-lock to the set)
          "loop": true }                 # optional, default true (tile to fill length_beats)
      ]
    }
  }
}

MIDI clip:  start_beat, length_beats, name?, notes[]  -- note start_time/duration are in beats
            RELATIVE TO THE CLIP (0 = clip start), velocity 1-127.
AUDIO clip: start_beat, length_beats, name?, file (absolute path), gain_db?, warp?, loop?

CLEARING. Per-track "clear_range" is the safe form and needs no flag. The --clear-range
CLI flag is a manual override that applies to EVERY track in the plan, so it is REFUSED
outright when the plan declares any per-track clear_range -- otherwise it would also wipe
the tracks the plan deliberately left alone (mids.json clears SYNTH 1/1#2/2/3 but must
not touch SYNTH 5, which holds the user's audio at beats 32 and 64).
--dry-run prints every clip that would be deleted, by name and beat range, per track.

------------------------------------------------------------------ HOW IT WRITES
Live 12.3.8 has NO API that adds notes to, or loads a file into, an arrangement clip
directly (Track.create_audio_clip rejects the (time,length) call the bridge makes with
"Invalid parameter type", and nothing can add notes to a clip made by
create_arrangement_midi_clip). Verified path:

  MIDI  : create_clip -> add_notes_to_clip -> set_clip_name
          -> duplicate_clip_to_arrangement(time) -> delete staging clip
  AUDIO : show Session view -> select staging scene -> select track
          -> load_sample(browser URI) -> set warp
          -> duplicate_clip_to_arrangement(time) -> delete staging clip
          -> set_arrangement_clip_properties(loop/markers/gain/name)

`load_sample` only works on files Ableton's BROWSER can see, and ONLY while Live is in
Session view (in Arranger view load_item silently no-ops and reports success). Files
outside a browser root are copied into E:/User Library/_stinkmode/ and addressed as
    userfolder:E:/User%20Library#_stinkmode:<percent-encoded-filename>
Live nests path segments after '#' with ':' -- NOT '/'.

NEVER touched: 'RREFERANCE', any track whose name contains 'STINKMODE', and the VOCALS
group (the group track and every track folded inside it).
"""
import argparse
import collections
import json
import os
import shutil
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from push_midi import Bridge  # noqa: E402

# --- guards -------------------------------------------------------------------
PROTECTED_EXACT = {"RREFERANCE"}
PROTECTED_SUBSTR = ("STINKMODE",)
PROTECTED_GROUP = "VOCALS"          # the group track and everything folded inside it
PLACE_ONLY = {"VOX M", "VOX F"}     # inside VOCALS but writable for PLACEMENT; clearing refused

# --- SYNTH 1 content resolution (chair ruling 2026-08-28 04:40) ---------------
# THREE tracks are named "SYNTH 1". Ordinal resolution is unsafe because one of them is
# the USER'S new lane, which must never be written or cleared. Resolve by CLIP CONTENT:
#   "SYNTH 1"    -> the lane whose FIRST arrangement clip is 'CALL Bbm FM (A)' 0..128
#   "SYNTH 1#2"  -> the lane carrying clips named 'TWIN*'
# Any other lane named "SYNTH 1" is the user's and joins the protected set.
SYNTH1_BASE = "SYNTH 1"
SYNTH1_CALL_CLIP = "CALL Bbm FM (A)"
SYNTH1_CALL_START = 0.0
SYNTH1_CALL_END = 128.0
SYNTH1_TWIN_PREFIX = "TWIN"


def call_lane_deletable(c):
    """CALL lane clearing is LIMITED until the user rules on their split CALL clips.

    Only our own original single loop -- start exactly 128.0, running out to the full
    397 -- may be deleted. Every other clip on that lane survives, and planned clips
    that would land on a survivor are SKIPPED and reported, never overwritten.
    """
    return abs(c["start_time"] - 128.0) < 1e-6 and c["end_time"] >= 397.0


# --- browser staging ----------------------------------------------------------
USER_LIB_DIR = "E:/User Library"
USER_LIB_URI_ROOT = "userfolder:E:/User%20Library"
STAGE_SUBDIR = "_stinkmode"


def uri_for_staged(filename):
    """Browser URI for a file inside E:/User Library/_stinkmode/.

    Live nests path segments after '#' with ':' (NOT '/'), each percent-encoded.
    """
    seg = urllib.parse.quote(filename, safe="")
    return "{0}#{1}:{2}".format(USER_LIB_URI_ROOT, STAGE_SUBDIR, seg)


class Applier:
    def __init__(self, dry_run=False, stage_scene=None, bridge=None):
        # `bridge` lets a caller share one serialized connection (the track pipeline)
        # or substitute an in-memory fake (offline tests).
        self.br = bridge if bridge is not None else Bridge()
        self.dry = dry_run
        self.stage_scene_override = stage_scene
        self.infos = []
        self.names = []
        self._view_switched = False
        self._sample_uri_cache = {}
        self._synth1 = None          # (call_index, twin_index), resolved by content
        self._synth1_by_content = False   # False = template ordinal fallback (no CALL lane)
        self._synth1_user = set()    # SYNTH 1 lanes belonging to the user
        self.skip_on_collision = set()   # track indices we never overwrite
        self.collisions = []
        self.unfolded = {}           # group index -> name, opened by us
        self.refresh_tracks()

    # -- track addressing ------------------------------------------------------
    def refresh_tracks(self):
        n = self.br.rq("get_session_info")["track_count"]
        self.infos = [self.br.rq("get_track_info", {"track_index": i}) for i in range(n)]
        self.names = [t["name"] for t in self.infos]
        self._synth1 = None   # indices shift on create/delete; re-resolve

    def _protected_indices(self):
        bad = set()
        for i, t in enumerate(self.infos):
            nm = t["name"]
            if nm in PROTECTED_EXACT or any(s in nm.upper() for s in PROTECTED_SUBSTR):
                bad.add(i)
            if nm == PROTECTED_GROUP and t.get("is_group_track"):
                bad.add(i)
                for j, u in enumerate(self.infos):
                    if u.get("group_track_index") == i and u["name"] not in PLACE_ONLY:
                        bad.add(j)
        return bad

    def arr_clips(self, ti):
        """Arrangement clips of one track, sorted by start. Group tracks return []."""
        try:
            return sorted(self.br.rq("get_arrangement_clips", {"track_index": ti})["clips"],
                          key=lambda c: c["start_time"])
        except SystemExit:
            return []

    def resolve_synth1(self):
        """(call_index, twin_index) for the 'SYNTH 1' lanes, BY CLIP CONTENT.

        Refuses rather than guessing: exactly one lane must look like CALL and exactly
        one like TWIN. Every other lane named 'SYNTH 1' is the user's and is recorded
        as protected so no code path can reach it.
        """
        if self._synth1 is not None:
            return self._synth1
        hits = [i for i, x in enumerate(self.names) if x == SYNTH1_BASE]
        if not hits:
            raise SystemExit("no track named {0!r}".format(SYNTH1_BASE))
        clips = dict((i, self.arr_clips(i)) for i in hits)
        call = [i for i in hits
                if clips[i]
                and clips[i][0]["name"] == SYNTH1_CALL_CLIP
                and abs(clips[i][0]["start_time"] - SYNTH1_CALL_START) < 1e-6
                and abs(clips[i][0]["end_time"] - SYNTH1_CALL_END) < 1e-6]
        twin = [i for i in hits
                if any(c["name"].startswith(SYNTH1_TWIN_PREFIX) for c in clips[i])]

        def show():
            return "; ".join("[{0}] {1}".format(i, ", ".join(
                "{0!r} {1:g}..{2:g}".format(c["name"][:24], c["start_time"], c["end_time"])
                for c in clips[i][:3]) or "<empty>") for i in hits)

        if not call and not twin and len(hits) == 2:
            # A set without the STINKMODE call/response lanes (e.g. a fresh copy of the
            # template): the template itself has exactly two SYNTH 1 lanes, first and
            # second, so ordinal addressing is safe. A third unmarked lane stays refused.
            self._synth1 = (hits[0], hits[1])
            self._synth1_by_content = False
            self._synth1_user = set()
            print("  resolve SYNTH 1 by template order (no CALL/TWIN lanes): "
                  "SYNTH 1=[{0}] SYNTH 1#2=[{1}]".format(hits[0], hits[1]))
            return self._synth1

        if len(call) != 1:
            raise SystemExit(
                "AMBIGUOUS 'SYNTH 1': {0} lane(s) open with {1!r} {2:g}..{3:g}; need exactly"
                " 1. Lanes: {4}".format(len(call), SYNTH1_CALL_CLIP, SYNTH1_CALL_START,
                                        SYNTH1_CALL_END, show()))
        if len(twin) != 1:
            raise SystemExit(
                "AMBIGUOUS 'SYNTH 1#2': {0} lane(s) carry {1}* clips; need exactly 1."
                " Lanes: {2}".format(len(twin), SYNTH1_TWIN_PREFIX, show()))
        if call[0] == twin[0]:
            raise SystemExit("AMBIGUOUS: one lane matches BOTH CALL and TWIN: {0}".format(show()))
        self._synth1 = (call[0], twin[0])
        self._synth1_by_content = True
        self._synth1_user = set(hits) - set(self._synth1)
        print("  resolve SYNTH 1 by content: CALL=[{0}] TWIN=[{1}]{2}".format(
            call[0], twin[0],
            "  USER(protected)={0}".format(sorted(self._synth1_user)) if self._synth1_user else ""))
        return self._synth1

    def resolve(self, chan):
        """Track index for a channel name. The 'SYNTH 1' family resolves BY CONTENT."""
        base, _, nth = chan.partition("#")
        k = int(nth or 1)
        if base == SYNTH1_BASE:
            call, twin = self.resolve_synth1()
            if k == 1:
                ti = call
            elif k == 2:
                ti = twin
            else:
                raise SystemExit(
                    "REFUSED {0!r}: only 'SYNTH 1' (CALL) and 'SYNTH 1#2' (TWIN) are"
                    " addressable; any other SYNTH 1 lane is the user's.".format(chan))
        else:
            hits = [i for i, x in enumerate(self.names) if x == base]
            if not hits:
                raise SystemExit("track not found: {0!r}".format(chan))
            if k > len(hits):
                raise SystemExit("track {0!r}: only {1} track(s) named {2!r}".format(
                    chan, len(hits), base))
            ti = hits[k - 1]
        if ti in self._protected_indices() or ti in self._synth1_user:
            raise SystemExit("REFUSED: {0!r} (index {1}) is a protected track".format(chan, ti))
        return ti

    # -- staging scene ---------------------------------------------------------
    def staging_scene(self, track_indices):
        if self.stage_scene_override is not None:
            return self.stage_scene_override
        nslots = min(len(self.infos[ti]["clip_slots"]) for ti in track_indices)
        for s in range(nslots - 1, -1, -1):   # prefer the HIGHEST empty scene
            if not any(self.infos[ti]["clip_slots"][s].get("has_clip") for ti in track_indices):
                return s
        self.br.rq("create_scene", {"index": -1, "name": "_stage"})
        self.refresh_tracks()
        return nslots

    def ensure_session_view(self):
        if not self._view_switched:
            self.br.rq("set_view", {"action": "show", "view_name": "Session"})
            self._view_switched = True

    def restore_view(self):
        if self._view_switched:
            self.br.rq("set_view", {"action": "show", "view_name": "Arranger"})
            self._view_switched = False

    # -- group folding ---------------------------------------------------------
    def ensure_track_visible(self, ti):
        """Unfold every folded ancestor group so `ti` can be selected.

        Live throws on `song.view.selected_track = track` for a track hidden inside a
        folded group, which the bridge surfaces only as "Internal error". Records the
        original fold state of each group it opens in self.unfolded.
        """
        info = self.br.rq("get_track_info", {"track_index": ti})
        if info.get("is_visible"):
            return
        chain = []
        cur = info.get("group_track_index")
        seen = set()
        while cur is not None and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = self.br.rq("get_track_info", {"track_index": cur}).get("group_track_index")
        for g in reversed(chain):
            gi = self.br.rq("get_track_info", {"track_index": g})
            if not gi.get("is_group_track"):
                continue
            self.unfolded.setdefault(g, gi["name"])
            # NB: the bridge parameter is `fold_state`, not `folded`.
            self.br.rq("set_track_fold", {"track_index": g, "fold_state": False})
            print("    unfolded group [{0}] {1!r} so {2!r} can be selected".format(
                g, gi["name"], self.names[ti]))
        time.sleep(0.4)

    # -- staging slot settling -------------------------------------------------
    def _stage_slot_empty(self, ti, stage, timeout=6.0):
        """Wait until the staging slot reports EMPTY (previous delete has settled)."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            cs = self.br.rq("get_track_info", {"track_index": ti})["clip_slots"]
            if stage >= len(cs) or not cs[stage].get("has_clip"):
                return True
            time.sleep(0.2)
        return False

    def _stage_slot_filled(self, ti, stage, timeout=8.0):
        """Wait until the staging slot reports a clip (the load has settled)."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            cs = self.br.rq("get_track_info", {"track_index": ti})["clip_slots"]
            if stage < len(cs) and cs[stage].get("has_clip"):
                return True
            time.sleep(0.2)
        return False

    def stage_sample(self, ti, stage, uri, label):
        """select scene+track, load_sample into the staging slot, confirm it appeared.

        Retries the load once: Live occasionally drops the first load onto a slot that
        was occupied moments earlier, and reports success either way.
        """
        self.ensure_session_view()
        self.ensure_track_visible(ti)
        if not self._stage_slot_empty(ti, stage):
            self.br.rq("delete_clip", {"track_index": ti, "clip_index": stage})
            self._stage_slot_empty(ti, stage)
        for attempt in (1, 2, 3):
            self.br.rq("select_scene", {"scene_index": stage})
            self.br.rq("select_track", {"track_index": ti})
            self.br.rq("load_sample", {"track_index": ti, "sample_uri": uri})
            if self._stage_slot_filled(ti, stage):
                if attempt > 1:
                    print("    note: {0} loaded on attempt {1} ({2})".format(
                        self.names[ti], attempt, label))
                return
            # Live can report a freshly copied file as found while its browser cache is
            # still stale, so load_item quietly loads nothing. Give the cache time.
            time.sleep(2.0 * attempt)
        raise SystemExit("load_sample made no clip on {0} slot {1} ({2}) after 3 attempts".format(
            self.names[ti], stage, label))

    # -- sample -> browser URI -------------------------------------------------
    def sample_uri(self, path):
        if path in self._sample_uri_cache:
            return self._sample_uri_cache[path]
        if not os.path.isfile(path):
            raise SystemExit("sample not found on disk: {0}".format(path))
        fn = os.path.basename(path)
        dest_dir = os.path.join(USER_LIB_DIR, STAGE_SUBDIR)
        dest = os.path.join(dest_dir, fn)
        if not os.path.exists(dest) or os.path.getsize(dest) != os.path.getsize(path):
            os.makedirs(dest_dir, exist_ok=True)
            shutil.copy2(path, dest)
        # Carry Live's analysis file along so the staged copy keeps the source's warp grid.
        if os.path.isfile(path + ".asd") and not os.path.exists(dest + ".asd"):
            shutil.copy2(path + ".asd", dest + ".asd")
        uri = uri_for_staged(fn)
        # Give Live's browser a moment to notice a freshly copied file.
        found = False
        for _ in range(6):
            r = self.br.rq("get_browser_item", {"uri": uri, "path": ""})
            if r.get("found"):
                found = True
                break
            time.sleep(0.5)
        if not found:
            # Fall back to discovering the real URI by name.
            stem = os.path.splitext(fn)[0]
            hits = self.br.rq("search_browser", {"query": stem, "category": "user_folders"})
            match = next((h for h in hits.get("results", [])
                          if h.get("is_loadable") and h.get("name", "").startswith(stem)), None)
            if not match:
                raise SystemExit("browser cannot see sample {0} (uri {1})".format(fn, uri))
            uri = match["uri"]
        self._sample_uri_cache[path] = uri
        return uri

    # -- clearing --------------------------------------------------------------
    def clips_in_range(self, ti, start, end):
        """[(arrangement_index, clip)] whose START falls in [start, end).

        Matching on start_time (not overlap) is what the plans rely on: a clear_range
        of [2, 384) on SYNTH 1 drops our looped C&R clips but keeps the user's 0-2
        fragment and their 397+ zaps, because neither STARTS inside the range.
        """
        clips = self.br.rq("get_arrangement_clips", {"track_index": ti})["clips"]
        return [(i, c) for i, c in enumerate(clips) if start <= c["start_time"] < end]

    def clear_range(self, ti, start, end, only=None):
        """Delete this ONE track's arrangement clips starting in [start, end).

        `only` is an optional predicate(clip)->bool that NARROWS the deletion: in-range
        clips failing it are KEPT and printed as 'keep'. The CALL lane uses this so the
        user's split clips survive an otherwise wide clear_range.
        """
        inrange = self.clips_in_range(ti, start, end)
        doomed = [(i, c) for i, c in inrange if only is None or only(c)]
        kept = [(i, c) for i, c in inrange if only is not None and not only(c)]
        print("  clear {0:22s} [{1:g}, {2:g}) -> {3} clip(s){4}".format(
            self.names[ti], start, end, len(doomed),
            "   LIMITED: {0} in-range clip(s) KEPT".format(len(kept)) if kept else ""))
        for _i, c in doomed:
            print("      - {0!r} {1:g}..{2:g}".format(c["name"], c["start_time"], c["end_time"]))
        for _i, c in kept:
            print("      keep {0!r} {1:g}..{2:g}".format(c["name"], c["start_time"], c["end_time"]))
        # Delete highest index first: deleting shifts every later index down by one.
        for i, _c in reversed(doomed):
            if not self.dry:
                self.br.rq("delete_arrangement_clip",
                           {"track_index": ti, "clip_index_in_arrangement": i})
        return doomed

    # -- placement -------------------------------------------------------------
    def place_midi(self, ti, stage, spec):
        length = float(spec["length_beats"])
        notes = [{"pitch": int(n["pitch"]), "start_time": round(float(n["start_time"]), 5),
                  "duration": round(float(n["duration"]), 5), "velocity": int(n["velocity"])}
                 for n in spec["notes"]]
        self.br.rq("create_clip", {"track_index": ti, "clip_index": stage, "length": length})
        if notes:
            self.br.rq("add_notes_to_clip", {"track_index": ti, "clip_index": stage, "notes": notes})
        if spec.get("name"):
            self.br.rq("set_clip_name", {"track_index": ti, "clip_index": stage, "name": spec["name"][:40]})
        self.br.rq("duplicate_clip_to_arrangement",
                   {"track_index": ti, "clip_index": stage, "time": float(spec["start_beat"])})
        self.br.rq("delete_clip", {"track_index": ti, "clip_index": stage})

    def place_audio_group(self, ti, stage, specs):
        """Place many clips that share one file+length+loop+warp from a SINGLE staging load.

        load_sample is by far the most expensive call (it walks Live's browser tree), and
        a plan can ask for the same one-shot 90+ times on one track. Staging it once and
        duplicating it to every start_beat turns ~300 loads into ~30.
        """
        first = specs[0]
        uri = self.sample_uri(first["file"])
        length = float(first["length_beats"])
        self.stage_sample(ti, stage, uri, os.path.basename(first["file"]))
        if first.get("warp", True):
            try:
                self.br.rq("set_clip_warp",
                           {"track_index": ti, "clip_index": stage, "warping_enabled": True})
            except SystemExit:
                pass
        samp_len = float(self.br.rq("get_clip_info",
                                    {"track_index": ti, "clip_index": stage})["length"])
        if first.get("transpose") is not None:
            # Arrangement clips do not reliably accept pitch, so transpose the STAGING clip
            # before duplicating -- every copy inherits it.
            self.br.rq("set_clip_pitch", {"track_index": ti, "clip_index": stage,
                                          "pitch_coarse": int(first["transpose"])})
        self.br.rq("set_clip_looping", {"track_index": ti, "clip_index": stage, "looping": True})
        self.br.rq("set_clip_loop_points",
                   {"track_index": ti, "clip_index": stage, "loop_start": 0.0, "loop_end": length})
        for spec in specs:
            self.br.rq("duplicate_clip_to_arrangement",
                       {"track_index": ti, "clip_index": stage, "time": float(spec["start_beat"])})
        self.br.rq("delete_clip", {"track_index": ti, "clip_index": stage})
        self._stage_slot_empty(ti, stage)
        # One read, then fix up every clip this group just placed.
        clips = self.br.rq("get_arrangement_clips", {"track_index": ti})["clips"]
        by_start = {round(c["start_time"], 4): i for i, c in enumerate(clips)}
        for spec in specs:
            ai = by_start.get(round(float(spec["start_beat"]), 4))
            if ai is None:
                continue
            props = {"track_index": ti, "clip_index_in_arrangement": ai}
            if spec.get("loop", True) and 0 < samp_len < length:
                props["loop_end"] = samp_len
            elif not spec.get("loop", True):
                props["looping"] = False
                props["end_marker"] = length
            if spec.get("name"):
                props["name"] = spec["name"][:40]
            if spec.get("gain_db") is not None:
                props["gain"] = 10.0 ** (float(spec["gain_db"]) / 20.0)
            if len(props) > 2:
                try:
                    self.br.rq("set_arrangement_clip_properties", props)
                except SystemExit as e:
                    print("    warn: props {0}@{1}: {2}".format(self.names[ti], spec["start_beat"], e))
        return len(specs)

    def place_chops(self, ti, stage, specs):
        """Place slices of ONE file (same transpose) from a single staging load.

        Each chop sets the staging clip's loop and markers to its slice, then duplicates it:
        the arrangement copy spans exactly the slice. A stutter is several short chops in a
        row. offset_beats >= 0 counts from the file start, < 0 from the file end (risers
        that must END on a downbeat). src_beats = the file's length at the set tempo; when
        Live warps the staged copy to a different length, offsets scale by that ratio.
        """
        first = specs[0]
        uri = self.sample_uri(first["file"])
        self.stage_sample(ti, stage, uri, os.path.basename(first["file"]))
        try:
            self.br.rq("set_clip_warp", {"track_index": ti, "clip_index": stage, "warping_enabled": True})
            if first.get("warp_mode"):   # the bridge's name map is off by one for complex_pro
                self.br.rq("set_warp_mode", {"track_index": ti, "clip_index": stage,
                                             "warp_mode": first["warp_mode"]})
        except SystemExit as e:
            print("    warn: warp setup on {0}: {1}".format(self.names[ti], e))
        if first.get("transpose") is not None:
            self.br.rq("set_clip_pitch", {"track_index": ti, "clip_index": stage,
                                          "pitch_coarse": int(first["transpose"])})
        samp_len = float(self.br.rq("get_clip_info", {"track_index": ti, "clip_index": stage})["length"])
        src = float(first.get("src_beats") or samp_len)
        ratio = samp_len / src if src > 0 else 1.0
        if abs(ratio - 1.0) > 0.002:
            print("    note: {0} staged at {1:.2f} beats vs {2:.2f} expected; offsets scaled x{3:.4f}".format(
                os.path.basename(first["file"]), samp_len, src, ratio))
        self.br.rq("set_clip_looping", {"track_index": ti, "clip_index": stage, "looping": True})
        for spec in sorted(specs, key=lambda s: float(s["start_beat"])):
            length = float(spec["length_beats"]) * ratio
            off = float(spec["offset_beats"]) * ratio
            a = off if off >= 0 else samp_len + off
            a = max(0.0, min(a, samp_len - length))
            b = a + length
            self.br.rq("set_clip_loop_points", {"track_index": ti, "clip_index": stage,
                                                "loop_start": a, "loop_end": b})
            self.br.rq("set_clip_start_end", {"track_index": ti, "clip_index": stage,
                                              "start_marker": a, "end_marker": b})
            self.br.rq("duplicate_clip_to_arrangement",
                       {"track_index": ti, "clip_index": stage, "time": float(spec["start_beat"])})
        self.br.rq("delete_clip", {"track_index": ti, "clip_index": stage})
        self._stage_slot_empty(ti, stage)
        clips = self.br.rq("get_arrangement_clips", {"track_index": ti})["clips"]
        by_start = {round(c["start_time"], 4): i for i, c in enumerate(clips)}
        for spec in specs:
            ai = by_start.get(round(float(spec["start_beat"]), 4))
            props = {"track_index": ti, "clip_index_in_arrangement": ai}
            if spec.get("name"):
                props["name"] = spec["name"][:40]
            if spec.get("gain_db") is not None:
                props["gain"] = 10.0 ** (float(spec["gain_db"]) / 20.0)
            if ai is None or len(props) == 2:
                continue
            try:
                self.br.rq("set_arrangement_clip_properties", props)
            except SystemExit as e:
                print("    warn: chop props {0}@{1}: {2}".format(self.names[ti], spec["start_beat"], e))
        return len(specs)

    def place_audio(self, ti, stage, spec):
        uri = self.sample_uri(spec["file"])
        length = float(spec["length_beats"])
        self.stage_sample(ti, stage, uri, os.path.basename(spec["file"]))
        if spec.get("warp", True):
            try:
                self.br.rq("set_clip_warp",
                           {"track_index": ti, "clip_index": stage, "warping_enabled": True})
            except SystemExit:
                pass  # some material refuses to warp; place it unwarped rather than abort
        # The sample's own musical length once warped -- the tile unit.
        samp_len = float(self.br.rq("get_clip_info",
                                    {"track_index": ti, "clip_index": stage})["length"])
        # duplicate_clip_to_arrangement gives the arrangement clip a timeline extent equal
        # to the SESSION clip's loop length. Set that loop to length_beats so the placed
        # clip spans exactly the region the plan asked for.
        self.br.rq("set_clip_looping", {"track_index": ti, "clip_index": stage, "looping": True})
        self.br.rq("set_clip_loop_points",
                   {"track_index": ti, "clip_index": stage, "loop_start": 0.0, "loop_end": length})
        self.br.rq("duplicate_clip_to_arrangement",
                   {"track_index": ti, "clip_index": stage, "time": float(spec["start_beat"])})
        self.br.rq("delete_clip", {"track_index": ti, "clip_index": stage})
        clips = self.br.rq("get_arrangement_clips", {"track_index": ti})["clips"]
        ai = next((i for i, c in enumerate(clips)
                   if abs(c["start_time"] - float(spec["start_beat"])) < 1e-6), None)
        if ai is None:
            return
        props = {"track_index": ti, "clip_index_in_arrangement": ai}
        if spec.get("loop", True) and samp_len > 0 and samp_len < length:
            # Shrink the loop brace back to one sample: the clip keeps its length_beats
            # extent on the timeline and tiles the sample across it.
            props["loop_end"] = samp_len
        elif not spec.get("loop", True):
            props["looping"] = False
            props["end_marker"] = length
        if spec.get("name"):
            props["name"] = spec["name"][:40]
        if spec.get("gain_db") is not None:
            props["gain"] = 10.0 ** (float(spec["gain_db"]) / 20.0)
        try:
            self.br.rq("set_arrangement_clip_properties", props)
        except SystemExit as e:
            print("    warn: clip props on {0}@{1}: {2}".format(self.names[ti], spec["start_beat"], e))

    # -- driver ----------------------------------------------------------------
    def apply(self, plan, clear=None):
        chans = list(plan["tracks"].keys())
        targets = {c: self.resolve(c) for c in chans}
        idxs = sorted(set(targets.values()))
        print("plan {0!r}: {1} track(s), {2} clip(s)".format(
            plan.get("name", "?"), len(chans),
            sum(len(v["clips"]) for v in plan["tracks"].values())))
        for c in chans:
            kind = "AUDIO" if self.infos[targets[c]]["is_audio_track"] else "MIDI"
            print("  {0:22s} [{1:2d}] {2:5s} {3} clip(s)".format(
                c, targets[c], kind, len(plan["tracks"][c]["clips"])))
        # Per-track clear_range declared by the plan itself. Each range clears ONLY the
        # track that declares it -- tracks without the key are never touched.
        declared = [(c, plan["tracks"][c]["clear_range"]) for c in chans
                    if "clear_range" in plan["tracks"][c]]
        if clear and declared:
            # A global range would also hit the plan's undeclared tracks, several of
            # which carry the user's own audio (e.g. SYNTH 5 at beats 32 and 64).
            raise SystemExit(
                "REFUSED: --clear-range is global, but this plan declares per-track "
                "clear_range on {0}. Applying it would also clear {1}, which the plan "
                "deliberately leaves alone. Drop --clear-range; the per-track keys are "
                "honoured automatically.".format(
                    ", ".join(repr(c) for c, _ in declared),
                    ", ".join(repr(c) for c in chans
                              if "clear_range" not in plan["tracks"][c]) or "nothing"))
        call_ti = self._synth1[0] if self._synth1 and self._synth1_by_content else None
        if call_ti is not None and call_ti in targets.values():
            # The CALL lane is never overwritten while the user's split clips are unruled.
            self.skip_on_collision.add(call_ti)
        for c, _rng in declared:
            if c.partition("#")[0] in PLACE_ONLY:
                raise SystemExit("REFUSED: clear_range on {0!r} -- VOCALS lanes accept placement only".format(c))
        cleared = {}
        if declared:
            print("per-track clear_range ({0} track(s)):".format(len(declared)))
            for c, rng in declared:
                ti = targets[c]
                only = call_lane_deletable if ti == call_ti else None
                if only is not None:
                    print("  NOTE {0!r} is the CALL lane -- clear is LIMITED to our own "
                          "128.0..397+ loop (user's split clips are kept).".format(c))
                # A plan may address ONE track through several keys ("SNARE" and
                # "SNARE#1") so it can carry two disjoint clear_ranges. Accumulate per
                # track index -- assigning would drop the earlier range's deletions from
                # the survivor set and mis-report collisions.
                cleared.setdefault(ti, []).extend(
                    self.clear_range(ti, float(rng[0]), float(rng[1]), only=only))
        if clear:
            print("GLOBAL --clear-range [{0:g}, {1:g}) on every plan track:".format(*clear))
            for ti in idxs:
                cleared.setdefault(ti, []).extend(self.clear_range(ti, clear[0], clear[1]))

        # ---- collision report: planned clips vs whatever SURVIVES the clears ----------
        # In --dry-run nothing was actually deleted, so survivors = current minus doomed;
        # in a real run the doomed starts are already gone and the subtraction is a no-op.
        self.collisions = []
        skip = {}
        for c in chans:
            ti = targets[c]
            doomed_starts = set(round(x[1]["start_time"], 4) for x in cleared.get(ti, []))
            survivors = [cc for cc in self.arr_clips(ti)
                         if round(cc["start_time"], 4) not in doomed_starts]
            for si, spec in enumerate(plan["tracks"][c]["clips"]):
                a0 = float(spec["start_beat"])
                a1 = a0 + float(spec["length_beats"])
                hit = [cc for cc in survivors if cc["start_time"] < a1 - 1e-6
                       and cc["end_time"] > a0 + 1e-6]
                if not hit:
                    continue
                will_skip = ti in self.skip_on_collision
                self.collisions.append({
                    "chan": c, "track_index": ti, "spec_index": si,
                    "name": spec.get("name", ""), "start": a0, "end": a1,
                    "skipped": will_skip,
                    "hits": [{"name": h["name"], "s": round(h["start_time"], 4),
                              "e": round(h["end_time"], 4)} for h in hit]})
                if will_skip:
                    skip.setdefault(c, set()).add(si)
        if self.collisions:
            nskip = sum(1 for x in self.collisions if x["skipped"])
            print("COLLISION: {0} planned clip(s) overlap surviving clips "
                  "({1} will be SKIPPED, {2} would OVERWRITE):".format(
                      len(self.collisions), nskip, len(self.collisions) - nskip))
            per = {}
            for x in self.collisions:
                per.setdefault(x["chan"], []).append(x)
            for c, xs in per.items():
                print("  {0:14s} [{1:2d}] {2:3d} clip(s) {3}  vs {4}".format(
                    c, xs[0]["track_index"], len(xs),
                    "SKIP" if xs[0]["skipped"] else "OVERWRITE",
                    ", ".join(sorted(set("{0!r} {1:g}..{2:g}".format(h["name"][:22], h["s"], h["e"])
                                         for x in xs for h in x["hits"])))[:150]))
                for x in xs[:4]:
                    print("      {0!r} {1:g}..{2:g}".format(x["name"][:34], x["start"], x["end"]))
                if len(xs) > 4:
                    print("      ... and {0} more".format(len(xs) - 4))
        if self.dry:
            print("dry run: nothing written")
            return 0
        stage = self.staging_scene(idxs)
        print("staging scene {0}".format(stage))
        placed = 0
        for c in chans:
            ti = targets[c]
            is_audio = self.infos[ti]["is_audio_track"]
            specs = [sp for si, sp in enumerate(plan["tracks"][c]["clips"])
                     if si not in skip.get(c, ())]
            if len(specs) != len(plan["tracks"][c]["clips"]):
                print("  SKIP {0:20s} {1} clip(s) held back (would overwrite a kept clip)".format(
                    c, len(plan["tracks"][c]["clips"]) - len(specs)))
            if not specs:
                continue
            t0 = time.time()
            if is_audio:
                groups = collections.OrderedDict()
                for spec in specs:
                    if "file" not in spec:
                        raise SystemExit("{0} is an AUDIO track; clip needs 'file'".format(c))
                    if "offset_beats" in spec:
                        key = ("chop", spec["file"], spec.get("transpose"), spec.get("warp_mode"))
                    else:
                        key = (spec["file"], float(spec["length_beats"]), bool(spec.get("loop", True)),
                               bool(spec.get("warp", True)), spec.get("transpose"))
                    groups.setdefault(key, []).append(spec)
                for key, gspecs in groups.items():
                    if key[0] == "chop":
                        placed += self.place_chops(ti, stage, gspecs)
                    else:
                        placed += self.place_audio_group(ti, stage, gspecs)
                print("  ok {0:22s} {1:3d} clip(s) from {2} staged load(s)  {3:.1f}s".format(
                    c, len(specs), len(groups), time.time() - t0))
            else:
                for spec in specs:
                    if "notes" not in spec:
                        raise SystemExit("{0} is a MIDI track; clip needs 'notes'".format(c))
                    self.place_midi(ti, stage, spec)
                    placed += 1
                print("  ok {0:22s} {1:3d} clip(s)  {2:.1f}s".format(c, len(specs), time.time() - t0))
        self.restore_view()
        return placed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--clear-range", nargs=2, type=float, metavar=("START", "END"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stage-scene", type=int)
    a = ap.parse_args()
    with open(a.plan, "r", encoding="utf-8") as f:
        plan = json.load(f)
    app = Applier(dry_run=a.dry_run, stage_scene=a.stage_scene)
    try:
        n = app.apply(plan, clear=a.clear_range)
    finally:
        app.restore_view()
    print("DONE: {0} clip(s) placed".format(n))


if __name__ == "__main__":
    main()
