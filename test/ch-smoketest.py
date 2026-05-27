"""Smoke test: connect to local CH hub, optionally exercise full claudeIn->claudeOut chain."""
import socketio, sys, time

PING = "--ping" in sys.argv

c = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
state = {"conn": False, "user": False, "out": None, "status": None, "err": None}


def hx(s):   return s.encode("utf-8").hex()
def unhx(s):
    try: return bytes.fromhex(s).decode("utf-8", errors="replace")
    except ValueError: return s


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


try:
    c.connect("http://127.0.0.1:3939", namespaces=["/hub"], transports=["websocket"], wait_timeout=6)
    time.sleep(1.0)
    if PING:
        c.emit("control", {"mode": "push", "target": "all", "header": "claudeIn",
                           "values": [hx("Reply with exactly one word: pong")]}, namespace="/hub")
        deadline = time.time() + 25
        while time.time() < deadline and state["out"] is None and state["err"] is None:
            time.sleep(0.25)
    c.disconnect()
except Exception as e:
    print("CONNECT_ERROR:", repr(e)); sys.exit(2)

print("connect=%s username=%s" % (state["conn"], state["user"]))
if PING:
    print("claudeStatus=%r" % state["status"])
    print("claudeOut=%r" % state["out"])
    print("claudeErr=%r" % state["err"])
    sys.exit(0 if state["out"] else 3)
sys.exit(0 if state["conn"] else 1)
