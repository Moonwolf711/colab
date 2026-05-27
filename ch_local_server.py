"""Local Collab-Hub-compatible socket.io relay. Bound 127.0.0.1 only."""
import eventlet
eventlet.monkey_patch()

import socketio
import time

NS = "/hub"
HOST = "127.0.0.1"
PORT = 3939  # private port for the ClaudeBar stack; 3000 collides with Docker's wildcard bind

sio = socketio.Server(cors_allowed_origins="*", async_mode="eventlet", logger=False)
app = socketio.WSGIApp(sio)
users: dict[str, str] = {}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


@sio.event(namespace=NS)
def connect(sid, environ):
    users[sid] = f"anon-{sid[:6]}"
    log(f"+ {users[sid]}")
    sio.emit("serverMessage", {"text": "connected"}, room=sid, namespace=NS)


@sio.event(namespace=NS)
def disconnect(sid):
    log(f"- {users.pop(sid, sid[:8])}")


@sio.on("addUsername", namespace=NS)
def add_username(sid, data):
    name = (data or {}).get("username", "").strip() or users.get(sid, sid[:6])
    users[sid] = name
    sio.emit("myUsername", {"username": name}, room=sid, namespace=NS)
    sio.emit("allUsers", {"users": list(users.values())}, namespace=NS)


@sio.on("joinRoom", namespace=NS)
def join_room(sid, data):
    room = (data or {}).get("room")
    if room:
        sio.enter_room(sid, room, namespace=NS)


@sio.on("leaveRoom", namespace=NS)
def leave_room(sid, data):
    room = (data or {}).get("room")
    if room:
        sio.leave_room(sid, room, namespace=NS)


def broadcast(sid, kind, data):
    payload = {**(data or {}), "from": users.get(sid, sid[:6])}
    sio.emit(kind, payload, namespace=NS, skip_sid=sid)
    log(f"{kind}:{payload.get('header')} from {payload['from']}")


@sio.on("control", namespace=NS)
def on_control(sid, data):
    broadcast(sid, "control", data)


@sio.on("event", namespace=NS)
def on_event(sid, data):
    broadcast(sid, "event", data)


@sio.on("chat", namespace=NS)
def on_chat(sid, data):
    payload = {**(data or {}), "id": users.get(sid, sid[:6])}
    sio.emit("chat", payload, namespace=NS, skip_sid=sid)


if __name__ == "__main__":
    log(f"CH server on http://{HOST}:{PORT}{NS}")
    eventlet.wsgi.server(eventlet.listen((HOST, PORT)), app, log_output=False)
