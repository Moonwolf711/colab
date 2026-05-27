"""ClaudeBar auto-start: ensure the local CH hub server + Claude bridge are running.

Idempotent. Safe to run repeatedly (logon task runs it once per login).
- Server bind check is by IPv4 127.0.0.1:3000 (the exact address the jweb bar dials).
- Bridge liveness is tracked via logs/bridge.pid + tasklist (avoids os.kill quirks).
Children are spawned detached + windowless so they outlive this launcher.
"""
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
LOGS = BASE / "logs"
LOGS.mkdir(exist_ok=True)

PY = sys.executable  # pythonw.exe when launched from the logon task -> no console
CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
FLAGS = CREATE_NO_WINDOW | DETACHED_PROCESS


def llog(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    with open(LOGS / "launch.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def our_server_listening() -> bool:
    """True only if our CH server is LISTENING on 127.0.0.1:3939.

    Match the literal 127.0.0.1:3939 listen entry rather than a connect-probe so a
    foreign listener on the same port can never produce a false positive.
    """
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
        ).stdout
    except Exception:
        return False
    for line in out.splitlines():
        if "127.0.0.1:3939 " in line and "LISTENING" in line.upper():
            return True
    return False


def pid_alive(pid: int) -> bool:
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
        ).stdout
    except Exception:
        return False
    return f'"{pid}"' in out or f",{pid}," in out


def spawn(script: str, name: str) -> int:
    out = open(LOGS / f"{name}.out.log", "a", encoding="utf-8")
    err = open(LOGS / f"{name}.err.log", "a", encoding="utf-8")
    return subprocess.Popen(
        [PY, str(BASE / script)], cwd=str(BASE),
        stdout=out, stderr=err, stdin=subprocess.DEVNULL,
        creationflags=FLAGS, close_fds=True,
    ).pid


def ensure_server() -> str:
    if our_server_listening():
        return "server: already listening on 127.0.0.1:3939"
    spawn("ch_local_server.py", "server")
    for _ in range(24):  # up to ~6s for eventlet to bind
        if our_server_listening():
            return "server: started"
        time.sleep(0.25)
    return "server: START TIMEOUT (check logs/server.err.log)"


def ensure_bridge() -> str:
    pidf = LOGS / "bridge.pid"
    if pidf.exists():
        try:
            if pid_alive(int(pidf.read_text().strip())):
                return "bridge: already running"
        except Exception:
            pass
    pid = spawn("claude_terminal_bridge_ch.py", "bridge")
    pidf.write_text(str(pid))
    return f"bridge: started (pid {pid})"


if __name__ == "__main__":
    llog(ensure_server())   # server first — bridge dials it on connect
    llog(ensure_bridge())
