"""Claude bridge: Collab-Hub <-> Anthropic API / Claude Code CLI.

control:claudeIn -> Haiku (fast) or `claude --print` (full) -> control:claudeOut.
"""
import json
import os
import subprocess
import threading
import time
import uuid

import _env; _env.load()

import socketio
from anthropic import Anthropic


CFG = {
    "url":      os.environ.get("CH_SERVER", "http://127.0.0.1:3939"),
    "ns":       "/" + os.environ.get("CH_NAMESPACE", "hub"),
    "user":     os.environ.get("CH_USERNAME", "claude-bridge"),
    "h_in":     os.environ.get("CH_HEADER_IN", "claudeIn"),
    "h_out":    os.environ.get("CH_HEADER_OUT", "claudeOut"),
    "h_stat":   "claudeStatus",
    "h_mode":   "claudeMode",
    "h_step":   "claudeStep",
    "h_curs":   "claudeCursor",
    "cwd":      os.environ.get("CT_CWD", r"C:\Users\Owner\colab"),
    "fast":     os.environ.get("CT_MODEL_FAST", "claude-haiku-4-5-20251001"),
    "full":     os.environ.get("CT_MODEL_FULL", "claude-sonnet-4-6"),
    "mode":     os.environ.get("CT_MODE", "fast"),
    # Dedicated session UUID so --continue / --session-id never picks up the user's
    # main Claude Code session and dumps its history into our bar.
    "session":  os.environ.get("CT_SESSION_ID", str(uuid.uuid4())),
    # Minimal tool whitelist — strips ~80% of schema tokens vs loading every MCP.
    "tools":    os.environ.get("CT_TOOLS",
                "Task Bash Read Write Edit Glob Grep TodoWrite "
                "mcp__ableton-mcp__get_session_info "
                "mcp__ableton-mcp__get_track_info "
                "mcp__ableton-mcp__set_clip_name "
                "mcp__ableton-mcp__create_clip "
                "mcp__ableton-mcp__add_notes_to_clip "
                "mcp__ableton-mcp__fire_clip "
                "mcp__ableton-mcp__stop_clip "
                "mcp__ableton-mcp__start_playback "
                "mcp__ableton-mcp__stop_playback"),
}
CURRENT_PROC = {"p": None}  # holds the active Popen so /cancel can kill it

SYSTEM = (
    "You are inside Ableton Live in a thin chat bar at the bottom of the screen.\n"
    "\n"
    "HARD RULES for any Ableton action:\n"
    "  - PRIMARY: ableton-mcp tools (names start with `mcp__ableton-mcp__`) for tracks,\n"
    "    clips, notes, playback.\n"
    "  - SECONDARY: AbletonOSC via the helper:\n"
    "      `python C:/Users/Owner/colab/osc.py <address> [args...]`\n"
    "    The helper handles the fixed 11001 reply-port. Address may be passed without\n"
    "    leading slash to avoid Git-Bash path mangling (e.g. `osc.py live/song/get/tempo`).\n"
    "    Never bind raw UDP sockets — replies go to 11001 and your random port misses them.\n"
    "  - Use osc.py for: device params, locators (`live/song/get/cue_points`,\n"
    "    `live/song/jump_to_cue_point <name>`), mixer (`live/track/set/volume <idx> <v>`),\n"
    "    sends, returns, automation. Never any non-loopback host.\n"
    "  - HARD BAN: port 8001 (CoLaB device, NOT Ableton). HARD BAN: any non-loopback host.\n"
    "  - NEVER create new tracks. Do NOT call create_midi_track,\n"
    "    load_instrument_or_effect, or load_drum_kit — the user's template has\n"
    "    every channel set up already with the right instrument.\n"
    "  - Find tracks BY NAME. Iterate get_track_info until name matches, then use that\n"
    "    index. Indices shift between sessions.\n"
    "  - Stay inside PRE MASTER group. Don't rename, don't move tracks.\n"
    "  - MIDI clips at song-section locators (INTRO 1-8 / BUILD 9-16 / DROP 17-32 /\n"
    "    BREAKDOWN 33-40 / DROP 2 41-56 / OUTRO 57-64). Use create_clip + set_clip_name.\n"
    "\n"
    "ableton-mcp tools available:\n"
    "  get_session_info, get_track_info, set_clip_name, create_clip, add_notes_to_clip,\n"
    "  fire_clip, stop_clip, start_playback, stop_playback.\n"
    "\n"
    "Channel agents (Task tool with subagent_type):\n"
    "  track-drums, track-kick, track-snare, track-cymbols, track-hh, track-hh-closed,\n"
    "  track-crash, track-synth-1, track-synth-2, track-synth-3, track-synth-4,\n"
    "  track-synth-5, track-synth-6, track-sub, track-sub-1, track-fx,\n"
    "  track-rise-1, track-rise-2, track-rise-3, track-down-1, track-down-2,\n"
    "  track-down-3, track-vocals, track-vox.\n"
    "Each agent carries its own OSC parameter whitelist and section-locator pattern map.\n"
    "Delegate via Task tool — never edit a channel without its specialist agent.\n"
    "\n"
    "Replies: plain text, 1-3 sentences. No markdown."
)
HISTORY: list[dict] = []
LOCK = threading.Lock()

sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)
anth = Anthropic()


def log(m):       print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
def hx(s):        return s.encode("utf-8").hex()
def unhx(s):
    try: return bytes.fromhex(s).decode("utf-8", errors="replace")
    except ValueError: return s  # plain text fallback
def emit(h, v):   sio.emit("control", {"mode": "push", "target": "all", "header": h, "values": [hx(v)]}, namespace=CFG["ns"])
def out(text):    emit(CFG["h_out"], text)
def status(s):    emit(CFG["h_stat"], s)
def step(s):      emit(CFG["h_step"], s)
def cursor(kind, idx=-1, idx2=-1): emit(CFG["h_curs"], f"{kind}:{idx}:{idx2}")


def cursor_from_tool(name, inp):
    """Map ableton-mcp tool calls to a cursor target inside Ableton."""
    inp = inp if isinstance(inp, dict) else {}
    n = (name or "").lower()
    ti = inp.get("track_index", inp.get("track", -1))
    ci = inp.get("clip_index", inp.get("clip_slot_index", -1))
    if "tempo" in n:                       cursor("tempo")
    elif "playback" in n or n == "play":   cursor("transport")
    elif "scene" in n and "fire" in n:     cursor("scene", inp.get("scene_index", -1))
    elif "clip" in n and ti != -1:         cursor("clip", ti, ci)
    elif "track" in n and ti != -1:        cursor("track", ti)
    elif "device" in n and ti != -1:       cursor("track", ti)
    elif "browser" in n:                   cursor("browser")


def ask_fast(prompt):
    HISTORY.append({"role": "user", "content": prompt})
    del HISTORY[:-20]
    try:
        r = anth.messages.create(model=CFG["fast"], max_tokens=400, system=SYSTEM, messages=HISTORY)
        text = "".join(b.text for b in r.content if hasattr(b, "text")).strip()
    except Exception as e:
        HISTORY.pop()
        return f"API err: {e}"[:400]
    HISTORY.append({"role": "assistant", "content": text})
    return text or "(empty)"


def _summ(s, n=80):
    s = str(s).replace("\n", " ").strip()
    return s if len(s) <= n else s[:n-1] + "…"


def _summ_input(d):
    if not isinstance(d, dict): return _summ(d, 60)
    keys = list(d.keys())[:3]
    return ", ".join(f"{k}={_summ(d[k], 30)}" for k in keys)


def ask_full(prompt):
    args = ["claude", "--print", "--model", CFG["full"],
            "--permission-mode", "bypassPermissions",
            "--append-system-prompt", SYSTEM,
            "--output-format", "stream-json", "--verbose",
            "--session-id", str(uuid.uuid4()),
            "--allowed-tools", *CFG["tools"].split(),
            "--", prompt]
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                cwd=CFG["cwd"], encoding="utf-8", errors="replace",
                                bufsize=1)
    except FileNotFoundError:
        return "claude CLI not in PATH"
    CURRENT_PROC["p"] = proc

    deadline = time.time() + 1800

    final_text = []
    try:
        for line in proc.stdout:
            if time.time() > deadline:
                proc.kill()
                return "aborted: 30 min wall hit"
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "system":
                sub = ev.get("subtype", "")
                if sub == "init":
                    step(f"-> {ev.get('model','?')} ({len(ev.get('tools',[]))} tools)")
            elif t == "assistant":
                for c in ev.get("message", {}).get("content", []):
                    ct = c.get("type")
                    if ct == "text":
                        txt = c.get("text", "").strip()
                        if txt:
                            final_text.append(txt)
                            step(f"thinking: {_summ(txt, 100)}")
                    elif ct == "tool_use":
                        nm = c.get("name", "")
                        step(f"→ {nm}({_summ_input(c.get('input'))})")
                        if "ableton-mcp" in nm:
                            cursor_from_tool(nm.split("__")[-1], c.get("input"))
            elif t == "user":
                for c in ev.get("message", {}).get("content", []):
                    if c.get("type") == "tool_result":
                        content = c.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(x.get("text", "") for x in content if isinstance(x, dict))
                        step(f"  ↳ {_summ(content, 100)}")
            elif t == "result":
                final = ev.get("result") or "\n".join(final_text).strip()
                proc.wait(timeout=5)
                return final or "(no reply)"
        # stream ended without result
        err = proc.stderr.read() if proc.stderr else ""
        rc = proc.wait(timeout=5)
        if rc:
            return f"claude err ({rc}): {err.strip()[:300]}"
        return "\n".join(final_text).strip() or "(no reply)"
    except Exception as e:
        try: proc.kill()
        except Exception: pass
        return f"stream err: {e}"[:300]
    finally:
        CURRENT_PROC["p"] = None


def slash(text):
    """Return ('answer', str)  - reply immediately
            ('prompt', str)  - translated NL prompt for the model
            None             - unknown, pass through unchanged."""
    cmd, _, rest = text.partition(" ")
    rest = rest.strip()
    if cmd in ("/fast", "/full"):
        CFG["mode"] = cmd[1:]; emit(CFG["h_mode"], CFG["mode"])
        return ("answer", f"mode -> {CFG['mode']} ({CFG[CFG['mode']]})")
    if cmd == "/reset":
        HISTORY.clear(); return ("answer", "history cleared")
    if cmd == "/status":
        return ("answer", f"mode={CFG['mode']} model={CFG[CFG['mode']]} cwd={CFG['cwd']} hist={len(HISTORY)}")
    if cmd == "/model":
        if rest: CFG[CFG["mode"]] = rest; return ("answer", f"{CFG['mode']} model -> {rest}")
        return ("answer", f"fast={CFG['fast']}  full={CFG['full']}")
    if cmd == "/cwd":
        if not rest: return ("answer", f"cwd = {CFG['cwd']}")
        if not os.path.isdir(rest): return ("answer", f"not a dir: {rest}")
        CFG["cwd"] = rest; return ("answer", f"cwd -> {rest}")
    if cmd == "/help":
        return ("answer",
                "bridge: /fast /full /reset /status /model /cwd /help  ·  "
                "tools: /tools /agents /swarm /memory /tracks /tempo /play /stop")
    translations = {
        "/tools":   "List the MCP tools you have available, grouped by server. Plain text, no markdown.",
        "/agents":  "List the claude-flow agents available via claude-flow MCP. Plain text.",
        "/swarm":   f"Spawn a claude-flow swarm to: {rest}" if rest else "Explain how to spawn a swarm.",
        "/memory":  f"Search agentdb memory for: {rest}" if rest else "Show memory stats via claude-flow MCP.",
        "/tracks":  "Call ableton-mcp get_session_info, then for tracks 0-12 call get_track_info; list index + name. Plain text.",
        "/tempo":   f"Set the ableton tempo to {rest} using ableton-mcp set_tempo." if rest else "Ask user what tempo.",
        "/play":    "Start ableton playback using ableton-mcp start_playback.",
        "/stop":    "Stop ableton playback using ableton-mcp stop_playback.",
    }
    if cmd in translations:
        return ("prompt", translations[cmd])
    return None


def process(prompt):
    if not LOCK.acquire(blocking=False):
        out("(busy — wait)")
        return
    try:
        status("busy")
        log(f"USER ({CFG['mode']}): {prompt[:100]}")
        if prompt.startswith("/"):
            r = slash(prompt)
            if r is not None:
                kind, val = r
                if kind == "answer":
                    out(val); status("ready"); return
                if kind == "prompt":
                    step(f"(translated {prompt.split()[0]} -> NL)")
                    prompt = val
        t0 = time.time()
        text = ask_fast(prompt) if CFG["mode"] == "fast" else ask_full(prompt)
        log(f"REPLY ({time.time()-t0:.1f}s): {text[:100]}")
        out(text)
        status("ready")
    finally:
        LOCK.release()


@sio.event(namespace=CFG["ns"])
def connect():
    log(f"connected {CFG['url']}{CFG['ns']} as {CFG['user']}")
    sio.emit("addUsername", {"username": CFG["user"]}, namespace=CFG["ns"])
    emit(CFG["h_mode"], CFG["mode"]); status("ready")


@sio.event(namespace=CFG["ns"])
def disconnect():
    log("disconnected")


@sio.on("control", namespace=CFG["ns"])
def on_control(data):
    if (data or {}).get("header") != CFG["h_in"]:
        return
    prompt = " ".join(unhx(str(v)) for v in (data.get("values") or [])).strip()
    if not prompt:
        return
    if prompt in ("/cancel", "/abort", "/kill"):
        p = CURRENT_PROC.get("p")
        if p and p.poll() is None:
            try:
                p.kill()
                out("aborted current job")
            except Exception as e:
                out(f"cancel err: {e}")
        else:
            out("nothing running")
        status("ready")
        return
    threading.Thread(target=process, args=(prompt,), daemon=True).start()


if __name__ == "__main__":
    log(f"-> {CFG['url']}{CFG['ns']}  fast={CFG['fast']}  full={CFG['full']}")
    sio.connect(CFG["url"], namespaces=[CFG["ns"]], transports=["websocket"], wait=True, wait_timeout=10)
    sio.wait()
