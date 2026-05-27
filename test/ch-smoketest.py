"""Smoke test for the ClaudeBar hub.

  ch-smoketest.py                 -> just verify socket.io connect to /hub
  ch-smoketest.py --ping          -> fast-mode chain: claudeIn -> claudeOut == "pong"
  ch-smoketest.py --full "<task>" -> switch to /full, send task, print tool steps + reply
"""
import socketio, sys, time

PING = "--ping" in sys.argv
FULL_TASK = None
if "--full" in sys.argv:
    i = sys.argv.index("--full")
    FULL_TASK = sys.argv[i + 1] if i + 1 < len(sys.argv) else "Call get_session_info; reply with tempo + track count, one sentence."

c = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
state = {"conn": False, "user": False, "out": None, "status": None, "err": None, "steps": []}


def hx(s):   return s.encode("utf-8").hex()
def unhx(s):
    try: return bytes.fromhex(s).decode("utf-8", errors="replace")
    except ValueError: return s


def send(text):
    c.emit("control", {"mode": "push", "target": "all", "header": "claudeIn",
                       "values": [hx(text)]}, namespace="/hub")


@c.event(namespace="/hub")
def connect():
    state["conn"] = True
    c.emit("addUsername", {"username": "smoketest"}, namespace="/hub")


@c.on("myUsername", namespace="/hub")
def my_username(data):
    state["user"] = True


@c.on("control", namespace="/hub")
def on_control(d):
    h = (d or {}).get("header")
    v = unhx((d.get("values") or [""])[0]) if d else ""
    if h == "claudeOut":      state["out"] = v
    elif h == "claudeStatus": state["status"] = v
    elif h == "claudeErr":    state["err"] = v
    elif h == "claudeStep":   state["steps"].append(v)


def wait_for_out(timeout):
    deadline = time.time() + timeout
    while time.time() < deadline and state["out"] is None and state["err"] is None:
        time.sleep(0.25)


try:
    c.connect("http://127.0.0.1:3939", namespaces=["/hub"], transports=["websocket"], wait_timeout=6)
    time.sleep(1.0)
    if PING:
        send("Reply with exactly one word: pong")
        wait_for_out(25)
    elif FULL_TASK:
        send("/full")
        time.sleep(2.0)            # let the "mode -> full" ack land...
        state["out"] = None        # ...then ignore it; we want the task's reply
        send(FULL_TASK)
        wait_for_out(180)  # full mode cold-starts the MCP + may call tools
    c.disconnect()
except Exception as e:
    print("CONNECT_ERROR:", repr(e)); sys.exit(2)

print("connect=%s username=%s" % (state["conn"], state["user"]))
if PING or FULL_TASK:
    print("claudeStatus=%r" % state["status"])
    if FULL_TASK:
        print("tool steps (%d):" % len(state["steps"]))
        for s in state["steps"]:
            print("   ", s)
    print("claudeOut=%r" % state["out"])
    print("claudeErr=%r" % state["err"])
    sys.exit(0 if state["out"] else 3)
sys.exit(0 if state["conn"] else 1)
