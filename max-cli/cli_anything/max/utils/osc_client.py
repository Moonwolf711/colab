"""Thin wrapper around python-osc for CLI ↔ control-patch messaging.

Design:

- ``OSCBridge`` owns a ``SimpleUDPClient`` for sending to ``localhost:8002``
  (the control patch's ``[udpreceive 8002]``) and a background
  ``BlockingOSCUDPServer`` on ``localhost:8003`` for replies from the
  patch's ``[udpsend 127.0.0.1 8003]``.
- Incoming messages are placed on a ``queue.Queue`` so callers can do
  synchronous request/reply with a timeout.
- All public methods are blocking but bounded by ``timeout_s``.

The CLI never holds an ``OSCBridge`` across subcommand invocations — each
subcommand creates one, runs its request, and tears it down. That keeps
state simple and avoids port-lock issues on Windows.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import BlockingOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient


DEFAULT_SEND_PORT = 8002
DEFAULT_RECV_PORT = 8003
DEFAULT_HOST = "127.0.0.1"


@dataclass
class OSCReply:
    """One message received from the control patch."""

    address: str
    args: list[Any]
    t_recv: float


class OSCBridge:
    """Bidirectional OSC bridge to a running Max control patch.

    Usage::

        with OSCBridge() as bridge:
            bridge.send("/ping")
            reply = bridge.wait_for("/pong", timeout_s=2.0)
            print(reply.args[0])
    """

    def __init__(
        self,
        send_host: str = DEFAULT_HOST,
        send_port: int = DEFAULT_SEND_PORT,
        recv_host: str = DEFAULT_HOST,
        recv_port: int = DEFAULT_RECV_PORT,
    ) -> None:
        self.send_host = send_host
        self.send_port = send_port
        self.recv_host = recv_host
        self.recv_port = recv_port

        self._client = SimpleUDPClient(send_host, send_port)
        self._queue: queue.Queue[OSCReply] = queue.Queue()

        disp = Dispatcher()
        disp.set_default_handler(self._on_any)
        self._server = BlockingOSCUDPServer((recv_host, recv_port), disp)
        self._server_thread = threading.Thread(
            target=self._server.serve_forever,
            name="cli-anything-max-osc",
            daemon=True,
        )
        self._started = False

    # ── Context manager ──────────────────────────────────────────────

    def __enter__(self) -> OSCBridge:
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    # ── Lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        if self._started:
            return
        self._server_thread.start()
        self._started = True

    def close(self) -> None:
        try:
            self._server.shutdown()
        except Exception:
            pass
        try:
            self._server.server_close()
        except Exception:
            pass

    # ── OSC send/recv ────────────────────────────────────────────────

    def send(self, address: str, *args: Any) -> None:
        """Send an OSC message. Args are passed through python-osc as-is."""
        self._client.send_message(address, list(args) if args else [])

    def _on_any(self, address: str, *osc_args: Any) -> None:
        self._queue.put(OSCReply(address=address, args=list(osc_args), t_recv=time.time()))

    def drain(self) -> list[OSCReply]:
        """Non-blocking drain of the pending reply queue."""
        out: list[OSCReply] = []
        while True:
            try:
                out.append(self._queue.get_nowait())
            except queue.Empty:
                return out

    def wait_for(
        self,
        address_prefix: str,
        timeout_s: float = 2.0,
    ) -> Optional[OSCReply]:
        """Block until a reply whose address starts with ``address_prefix`` arrives.

        Non-matching replies are put back at the head of the queue so they
        are still observable by later ``drain`` calls. Returns ``None`` on
        timeout.
        """
        deadline = time.time() + timeout_s
        stashed: list[OSCReply] = []
        try:
            while time.time() < deadline:
                remaining = max(0.001, deadline - time.time())
                try:
                    reply = self._queue.get(timeout=remaining)
                except queue.Empty:
                    return None
                if reply.address.startswith(address_prefix):
                    return reply
                stashed.append(reply)
            return None
        finally:
            for r in stashed:
                self._queue.put(r)

    def wait_any(self, timeout_s: float = 2.0) -> Optional[OSCReply]:
        """Block until the next reply arrives (or timeout)."""
        try:
            return self._queue.get(timeout=timeout_s)
        except queue.Empty:
            return None
