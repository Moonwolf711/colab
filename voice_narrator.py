"""Spoken narration for the ClaudeBar, via nigel_speak.py -> Komplete MME.

An utterance costs ~5s (ElevenLabs round trip + playback) while tool calls fire
in well under a second, so this is deliberately lossy: actions go into a tiny
queue that drops the OLDEST entries under pressure. Narration that runs minutes
behind the DAW is worse than narration that skips a step, because the point is
to follow along live. Final answers are never dropped.
"""
import os
import queue
import re
import subprocess
import threading

PY = r"C:\ProgramData\miniconda3\python.exe"
SPEAK = r"C:\Users\Owner\scripts\voice-claude\nigel_speak.py"
CREATE_NO_WINDOW = 0x08000000  # else each utterance flashes a console over Ableton

_q: "queue.Queue[tuple[int, str]]" = queue.Queue()
_worker = None
_lock = threading.Lock()
enabled = True

# how many pending ACTION lines we tolerate before dropping the oldest
MAX_PENDING_ACTIONS = 2


def _speak_blocking(text: str) -> None:
    env = dict(os.environ, PYTHONNOUSERSITE="1")
    try:
        subprocess.run([PY, SPEAK, text], capture_output=True, text=True,
                       env=env, timeout=45,
                       creationflags=CREATE_NO_WINDOW)
    except Exception:
        pass  # narration must never take the bridge down


def _run() -> None:
    while True:
        prio, text = _q.get()
        try:
            if enabled and text:
                _speak_blocking(text)
        finally:
            _q.task_done()


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, daemon=True)
            _worker.start()


def say(text: str, final: bool = False) -> None:
    """Queue a line. final=True is never dropped; actions are."""
    if not enabled or not text:
        return
    if final:
        text = clean(text)
    _ensure_worker()
    if not final:
        # shed backlog so speech tracks the action instead of trailing it
        pending = [i for i in list(_q.queue) if i[0] == 1]
        while len(pending) >= MAX_PENDING_ACTIONS:
            try:
                _q.queue.remove(pending.pop(0))
            except ValueError:
                break
    _q.put((0 if final else 1, text))


# Spoken text is for the ear: markdown reads as literal asterisks, and a long
# answer becomes a monologue you cannot skip. Strip and cap.
_CODE = re.compile(r"```.*?```", re.S)
_MD = re.compile(r"[*_`#>|]+")
_LINK = re.compile(r"https?://\S+")


def clean(text: str, cap: int = 320) -> str:
    t = _CODE.sub(" code block ", text or "")
    t = _LINK.sub(" a link ", t)
    t = _MD.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > cap:
        cut = t[:cap]
        dot = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        t = (cut[:dot + 1] if dot > cap * 0.5 else cut) + " ... truncated."
    return t


def humanize(tool: str, inp) -> str:
    """Turn a tool call into something worth hearing. Empty string = stay quiet."""
    inp = inp if isinstance(inp, dict) else {}
    n = (tool or "").split("__")[-1].lower()
    t = inp.get("track_index", inp.get("track"))
    c = inp.get("clip_index", inp.get("clip_slot_index"))
    where = ""
    if t is not None and c is not None:
        where = f" on track {t}, clip {c}"
    elif t is not None:
        where = f" on track {t}"

    if n.startswith("get_") or n.startswith("list_") or n.startswith("inspect_"):
        return ""                                    # reads are noise, stay quiet
    if "set_tempo" in n:          return f"Setting tempo to {inp.get('tempo','')}."
    if "fire_clip" in n:          return f"Firing clip{where}."
    if "stop_clip" in n:          return f"Stopping clip{where}."
    if "start_playback" in n:     return "Starting playback."
    if "stop_playback" in n:      return "Stopping playback."
    if "create_midi_track" in n:  return "Creating a MIDI track."
    if "create_audio_track" in n: return "Creating an audio track."
    if "create_clip" in n:        return f"Creating a clip{where}."
    if "delete_clip" in n:        return f"Deleting a clip{where}."
    if "add_notes" in n:          return f"Writing notes{where}."
    if "set_device_parameter" in n: return "Adjusting a device parameter."
    if "load_instrument_or_effect" in n or "load_browser_item" in n:
        return "Loading a device."
    if "mixer" in n:              return f"Adjusting the mixer{where}."
    if "set_track_name" in n:     return f"Renaming track {t}." if t is not None else "Renaming a track."
    return n.replace("_", " ").capitalize() + "."
