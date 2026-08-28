"""Minimal Standard MIDI File reader (no deps).

read(path) -> {"tempo": float|None, "ppq": int,
               "tracks": [{"name": str, "notes": [(pitch, start_beats, dur_beats, velocity), ...]}]}
Times are in quarter-note beats from the start of the file, which is what Live's clip API wants.
"""
import struct


def _varlen(b, i):
    v = 0
    while True:
        c = b[i]
        i += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, i


def read(path):
    b = open(path, "rb").read()
    if b[:4] != b"MThd":
        raise ValueError(f"not a MIDI file: {path}")
    _fmt, ntrk, ppq = struct.unpack(">HHH", b[8:14])
    i = 14
    tracks = []
    tempo = None
    for _ in range(ntrk):
        if b[i:i + 4] != b"MTrk":
            raise ValueError("bad track chunk")
        ln = struct.unpack(">I", b[i + 4:i + 8])[0]
        d = b[i + 8:i + 8 + ln]
        i += 8 + ln
        j = t = status = 0
        name = ""
        on = {}
        notes = []
        while j < len(d):
            dt, j = _varlen(d, j)
            t += dt
            s = d[j]
            if s == 0xFF:
                typ = d[j + 1]
                l, j2 = _varlen(d, j + 2)
                data = d[j2:j2 + l]
                j = j2 + l
                if typ == 0x03:
                    name = data.decode("latin1")
                elif typ == 0x51:
                    tempo = 60_000_000 / int.from_bytes(data, "big")
                continue
            if s in (0xF0, 0xF7):
                l, j2 = _varlen(d, j + 1)
                j = j2 + l
                continue
            if s & 0x80:
                status = s
                j += 1
            ev = status & 0xF0
            if ev in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                a, c = d[j], d[j + 1]
                j += 2
                if ev == 0x90 and c > 0:
                    on.setdefault(a, []).append((t, c))
                elif ev in (0x80, 0x90) and on.get(a):
                    st, v = on[a].pop(0)
                    notes.append((a, st / ppq, max(t - st, 1) / ppq, v))
            else:  # program change / channel pressure: one data byte
                j += 1
        notes.sort(key=lambda n: (n[1], n[0]))
        tracks.append({"name": name, "notes": notes})
    return {"tempo": tempo, "ppq": ppq, "tracks": tracks}


def _vl(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def write(path, tempo, tracks, ppq=480):
    """tracks = [{"name": str, "notes": [(pitch, start_beats, dur_beats, vel)]}] -> format-1 SMF."""
    def chunk(events):  # events: (tick, bytes) sorted
        body = b""
        last = 0
        for t, ev in sorted(events, key=lambda e: e[0]):
            body += _vl(t - last) + ev
            last = t
        body += _vl(0) + b"\xFF\x2F\x00"
        return b"MTrk" + struct.pack(">I", len(body)) + body

    us = int(round(60_000_000 / tempo))
    out = [chunk([(0, b"\xFF\x51\x03" + us.to_bytes(3, "big")), (0, b"\xFF\x58\x04\x04\x02\x18\x08")])]
    for ch, tr in enumerate(tracks):
        c = 9 if "drum" in tr["name"].lower() else min(ch, 8)
        ev = [(0, b"\xFF\x03" + _vl(len(tr["name"])) + tr["name"].encode("latin1"))]
        for p, st, du, v in tr["notes"]:
            on = int(round(st * ppq))
            ev.append((on, bytes([0x90 | c, p, v])))
            ev.append((on + max(1, int(round(du * ppq))), bytes([0x80 | c, p, 0])))
        out.append(chunk(ev))
    with open(path, "wb") as f:
        f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(out), ppq) + b"".join(out))


if __name__ == "__main__":
    import sys
    m = read(sys.argv[1])
    print("tempo", m["tempo"], "ppq", m["ppq"])
    for k, tr in enumerate(m["tracks"]):
        n = tr["notes"]
        end = max((x[1] + x[2] for x in n), default=0)
        print(f"[{k}] {tr['name']!r}: {len(n)} notes, pitches {sorted({x[0] for x in n})}, ends beat {end:.2f}")
