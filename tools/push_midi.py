"""Drop a .mid file onto the template's channels in one shot (talks to AbletonBridge on 9877).

    python C:/Users/Owner/colab/tools/push_midi.py FILE.mid [--scene N] [--scene-name NAME]
                                                   [--map "MIDI TRACK NAME=CHANNEL"]... [--dry-run]

Channel routing (by keyword in the MIDI track name, case-insensitive) unless --map overrides:
    drum*                          -> GM split across KICK / SNARE / HH CLOSED / CRASH / Drum Kit Full
    twin*                          -> SYNTH 1#2   (second SYNTH 1)
    call* | lead* | *sound a*      -> SYNTH 1
    response*low* | *low answer*   -> SYNTH 3
    response* | hook* | *sound b*  -> SYNTH 2
    sub* | bass*                   -> SUB 1
CHANNEL syntax: exact template track name, optional #n for the n-th duplicate ("SYNTH 1#2"),
or the word DRUMS for the GM split. Scene defaults to the first scene that is empty on every
target track. Clip length = whole bars covering the longest track. Nothing is created on --dry-run.
"""
import argparse
import json
import math
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(__file__))
import smf  # noqa: E402

# GM drum note -> (template channel, note to send). Drum Kit Full pads are the "Lycra Kit" map.
GM = {36: ("KICK", 60), 38: ("SNARE", 60), 40: ("Drum Kit Full", 88), 42: ("HH CLOSED", 60), 44: ("HH", 60), 49: ("CRASH", 60),
      57: ("CRASH", 60), 46: ("Drum Kit Full", 82), 37: ("Drum Kit Full", 91), 39: ("Drum Kit Full", 89),
      41: ("Drum Kit Full", 85), 43: ("Drum Kit Full", 85), 45: ("Drum Kit Full", 85), 47: ("Drum Kit Full", 87),
      48: ("Drum Kit Full", 83), 50: ("Drum Kit Full", 83), 51: ("Drum Kit Full", 82), 69: ("Drum Kit Full", 84),
      70: ("Drum Kit Full", 84)}
DRUM_LABEL = {"KICK": "kick", "SNARE": "snare", "HH CLOSED": "closed hats", "HH": "hats 2",
              "CRASH": "crash", "Drum Kit Full": "open hat/toms/clap"}


def route_by_name(name):
    n = name.lower()
    if n.startswith("drum") or " drums" in n:
        return "DRUMS"
    if "twin" in n:
        return "SYNTH 1#2"
    if n.startswith("call") or n.startswith("lead") or "sound a" in n:
        return "SYNTH 1"
    if ("response" in n and "low" in n) or "low answer" in n:
        return "SYNTH 3"
    if "response" in n or n.startswith("hook") or "sound b" in n:
        return "SYNTH 2"
    if n.startswith("sub") or n.startswith("bass"):
        return "SUB 1"
    return None


class Bridge:
    def __init__(self):
        self.s = socket.create_connection(("127.0.0.1", 9877), timeout=30)

    def rq(self, t, p=None, _retry=True):
        try:
            self.s.sendall((json.dumps({"type": t, "params": p or {}}) + "\n").encode())
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = self.s.recv(1 << 20)
                if not chunk:
                    raise ConnectionResetError("bridge closed socket")
                buf += chunk
        except (ConnectionResetError, ConnectionAbortedError, socket.timeout):
            # Live's Remote Script drops idle/racing clients now and then; one reconnect fixes it.
            if not _retry:
                raise
            self.s.close()
            self.s = socket.create_connection(("127.0.0.1", 9877), timeout=30)
            return self.rq(t, p, _retry=False)
        r = json.loads(buf)
        if r.get("status") != "success":
            raise SystemExit(f"{t} {p} -> {r}")
        return r.get("result")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mid")
    ap.add_argument("--scene", type=int)
    ap.add_argument("--scene-name")
    ap.add_argument("--map", action="append", default=[], metavar="TRACK=CHANNEL")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    overrides = dict(m.split("=", 1) for m in a.map)
    br = Bridge()
    n = br.rq("get_session_info")["track_count"]
    infos = [br.rq("get_track_info", {"track_index": i}) for i in range(n)]
    names = [t["name"] for t in infos]

    def idx(chan):
        base, _, nth = chan.partition("#")
        hits = [i for i, x in enumerate(names) if x == base]
        if not hits:
            raise SystemExit(f"template channel not found: {chan!r} (tracks: {names})")
        return hits[int(nth or 1) - 1]

    m = smf.read(a.mid)
    jobs = []  # (track_index, notes, clip_name)
    for tr in m["tracks"]:
        if not tr["notes"]:
            continue
        chan = overrides.get(tr["name"]) or route_by_name(tr["name"])
        if chan is None:
            print(f"  SKIP {tr['name']!r}: no route (use --map \"{tr['name']}=CHANNEL\")")
            continue
        if chan == "DRUMS":
            split = {}
            for p, st, du, v in tr["notes"]:
                if p not in GM:
                    print(f"  drop GM note {p} (no pad mapped)")
                    continue
                k, note = GM[p]
                split.setdefault(k, []).append((note, st, du, v))
            for k, notes in split.items():
                jobs.append((idx(k), notes, f"{tr['name'][:18]} · {DRUM_LABEL[k]}"))
        else:
            jobs.append((idx(chan), tr["notes"], tr["name"][:40]))

    if not jobs:
        raise SystemExit("nothing to push")
    end = max(st + du for _, notes, _ in jobs for _, st, du, _ in notes)
    length = float(max(4, math.ceil(end / 4) * 4))
    targets = sorted({ti for ti, _, _ in jobs})
    scene = a.scene
    if scene is None:
        nslots = min(len(infos[ti]["clip_slots"]) for ti in targets)
        scene = next((s for s in range(nslots)
                      if not any(infos[ti]["clip_slots"][s].get("has_clip") for ti in targets)), None)
        if scene is None:
            raise SystemExit("no scene is empty on all target tracks; pass --scene N")
    print(f"file {os.path.basename(a.mid)}  tempo {m['tempo']}  -> scene {scene}, clip length {length:.0f} beats")
    for ti, notes, cname in jobs:
        print(f"  {names[ti]:14s} [{ti:2d}] <- {cname}: {len(notes)} notes")
    if a.dry_run:
        print("dry run: nothing written")
        return
    for ti, notes, cname in jobs:
        br.rq("create_clip", {"track_index": ti, "clip_index": scene, "length": length})
        payload = [{"pitch": p, "start_time": round(st, 4), "duration": round(du, 4), "velocity": v}
                   for p, st, du, v in notes]
        br.rq("add_notes_to_clip", {"track_index": ti, "clip_index": scene, "notes": payload})
        br.rq("set_clip_name", {"track_index": ti, "clip_index": scene, "name": cname})
    sname = a.scene_name or os.path.splitext(os.path.basename(a.mid))[0][:40]
    try:
        br.rq("set_scene_name", {"scene_index": scene, "name": sname})
    except SystemExit:
        pass
    print(f"DONE: {len(jobs)} clips in scene {scene} ({sname!r})")


if __name__ == "__main__":
    main()
