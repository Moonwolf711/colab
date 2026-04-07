"""High-level control commands that drive a running Max control patch.

Every function here opens a short-lived ``OSCBridge``, sends one request,
and waits for the matching reply with a timeout. Failure modes:

- ``MaxNotRespondingError`` — no reply within the timeout
- ``MaxControlError`` — Max sent back an ``/error`` or ``/.../error`` reply

The dispatcher protocol is documented in ``MAX.md``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from cli_anything.max.utils.osc_client import OSCBridge, OSCReply


class MaxControlError(RuntimeError):
    """The control patch replied with an error."""


class MaxNotRespondingError(RuntimeError):
    """The control patch did not reply in time (is it loaded?)."""


@dataclass
class PingResult:
    ok: bool
    round_trip_ms: float
    patch_time_ms: Optional[float]


def ping(timeout_s: float = 2.0) -> PingResult:
    """Send ``/ping`` and wait for ``/pong``. Measures round-trip latency."""
    import time

    t0 = time.time()
    with OSCBridge() as bridge:
        bridge.send("/ping")
        reply = bridge.wait_for("/pong", timeout_s=timeout_s)
    t1 = time.time()
    if reply is None:
        raise MaxNotRespondingError(
            f"no /pong within {timeout_s:.1f}s. "
            "Is the control patch loaded and listening on UDP 8002?"
        )
    patch_time = None
    if reply.args:
        try:
            patch_time = float(reply.args[0])
        except (TypeError, ValueError):
            patch_time = None
    return PingResult(
        ok=True,
        round_trip_ms=(t1 - t0) * 1000.0,
        patch_time_ms=patch_time,
    )


def query(key: str, timeout_s: float = 2.0) -> dict[str, Any]:
    """Ask the dispatcher for a state value. Supported keys: ``dsp``, ``sr``, ``patch``."""
    with OSCBridge() as bridge:
        bridge.send("/query", key)
        reply = bridge.wait_for("/query", timeout_s=timeout_s)
    if reply is None:
        raise MaxNotRespondingError(f"no /query reply for {key!r} within {timeout_s:.1f}s")
    if reply.address.endswith("/error"):
        raise MaxControlError(f"query {key!r} failed: {reply.args}")
    return {"key": key, "address": reply.address, "value": reply.args[0] if reply.args else None}


def eval_js(code: str, timeout_s: float = 3.0) -> dict[str, Any]:
    """Run a snippet of JS inside the dispatcher and return the stringified result."""
    with OSCBridge() as bridge:
        bridge.send("/eval/js", code)
        reply = bridge.wait_for("/eval/js", timeout_s=timeout_s)
    if reply is None:
        raise MaxNotRespondingError(f"no /eval/js reply within {timeout_s:.1f}s")
    if reply.address.endswith("/error"):
        raise MaxControlError(f"js eval failed: {reply.args}")
    return {"result": reply.args[0] if reply.args else None}


def shutdown(timeout_s: float = 1.0) -> bool:
    """Ask the control patch to close itself. Returns True if /bye was received."""
    with OSCBridge() as bridge:
        bridge.send("/shutdown")
        reply = bridge.wait_for("/bye", timeout_s=timeout_s)
    return reply is not None


def raw_send(address: str, *args: Any) -> None:
    """Fire-and-forget OSC send for ``max control osc ...``."""
    with OSCBridge() as bridge:
        bridge.send(address, *args)
