"""Ableton CLI - Session management for AbletonOSC connection.

Manages the OSC client/server pair for communicating with Ableton Live
through the AbletonOSC MIDI Remote Script.

Protocol:
  - Send commands to UDP port 11000 (AbletonOSC listens)
  - Receive responses on UDP port 11001 (our listener)

All query commands use a request/response pattern:
  1. Register a handler for the expected reply address
  2. Send the query via the OSC client
  3. Wait (with timeout) for the response to arrive
  4. Return the captured arguments
"""

import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from pythonosc import udp_client, osc_server, dispatcher


# Default AbletonOSC ports
DEFAULT_SEND_PORT = 11000
DEFAULT_RECV_PORT = 11001
DEFAULT_HOST = "127.0.0.1"
DEFAULT_TIMEOUT = 5.0


class AbletonOSCError(Exception):
    """Raised when an OSC operation fails or times out."""
    pass


class Session:
    """Manages the OSC connection to AbletonOSC.

    Provides send_message() for fire-and-forget commands, and
    query() for request/response round-trips with timeout.
    """

    def __init__(self):
        self._client: Optional[udp_client.SimpleUDPClient] = None
        self._server: Optional[osc_server.ThreadingOSCUDPServer] = None
        self._server_thread: Optional[threading.Thread] = None
        self._dispatcher: Optional[dispatcher.Dispatcher] = None
        self._host: str = DEFAULT_HOST
        self._send_port: int = DEFAULT_SEND_PORT
        self._recv_port: int = DEFAULT_RECV_PORT
        self._connected: bool = False
        self._timeout: float = DEFAULT_TIMEOUT

        # Response capture for synchronous queries
        self._response_lock = threading.Lock()
        self._response_event = threading.Event()
        self._response_address: Optional[str] = None
        self._response_args: Optional[Tuple] = None

        # Persistent listeners for async notifications
        self._listeners: Dict[str, List[callable]] = {}

    @property
    def connected(self) -> bool:
        return self._connected

    def connect(
        self,
        host: str = DEFAULT_HOST,
        send_port: int = DEFAULT_SEND_PORT,
        recv_port: int = DEFAULT_RECV_PORT,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> Dict[str, Any]:
        """Establish OSC connection to AbletonOSC.

        Args:
            host: IP address of the machine running Ableton Live.
            send_port: UDP port AbletonOSC listens on (default 11000).
            recv_port: UDP port we listen on for replies (default 11001).
            timeout: Default query timeout in seconds.

        Returns:
            Connection status dict.
        """
        if self._connected:
            self.disconnect()

        self._host = host
        self._send_port = send_port
        self._recv_port = recv_port
        self._timeout = timeout

        # Create the OSC client (sends commands to Ableton)
        self._client = udp_client.SimpleUDPClient(host, send_port)

        # Create the dispatcher and server (receives responses)
        self._dispatcher = dispatcher.Dispatcher()
        self._dispatcher.set_default_handler(self._default_handler)

        try:
            self._server = osc_server.ThreadingOSCUDPServer(
                (host, recv_port), self._dispatcher
            )
        except OSError as e:
            raise AbletonOSCError(
                f"Cannot bind to {host}:{recv_port} - port may be in use. {e}"
            )

        self._server_thread = threading.Thread(
            target=self._server.serve_forever, daemon=True
        )
        self._server_thread.start()
        self._connected = True

        # Verify connection by querying tempo (fast sanity check)
        try:
            result = self.query("/live/song/get/tempo")
            tempo = result[0] if result else None
            return {
                "status": "connected",
                "host": host,
                "send_port": send_port,
                "recv_port": recv_port,
                "tempo": tempo,
            }
        except AbletonOSCError:
            # Connection is open but Ableton may not be running
            return {
                "status": "connected",
                "host": host,
                "send_port": send_port,
                "recv_port": recv_port,
                "tempo": None,
                "warning": "OSC ports open but Ableton may not be responding. "
                           "Ensure AbletonOSC control surface is enabled.",
            }

    def disconnect(self) -> Dict[str, Any]:
        """Close the OSC connection."""
        if self._server:
            self._server.shutdown()
            self._server = None
        if self._server_thread:
            self._server_thread.join(timeout=2.0)
            self._server_thread = None
        self._client = None
        self._dispatcher = None
        self._connected = False
        self._listeners.clear()
        return {"status": "disconnected"}

    def status(self) -> Dict[str, Any]:
        """Return current connection status."""
        info = {
            "connected": self._connected,
            "host": self._host,
            "send_port": self._send_port,
            "recv_port": self._recv_port,
            "timeout": self._timeout,
        }
        if self._connected:
            try:
                result = self.query("/live/song/get/tempo")
                info["tempo"] = result[0] if result else None
                info["ableton_responding"] = True
            except AbletonOSCError:
                info["ableton_responding"] = False
        return info

    def _require_connection(self) -> None:
        """Raise if not connected."""
        if not self._connected or self._client is None:
            raise AbletonOSCError(
                "Not connected to AbletonOSC. Run 'ableton session connect' first."
            )

    def send_message(self, address: str, *args) -> None:
        """Send an OSC message (fire-and-forget, no response expected).

        Args:
            address: OSC address (e.g., "/live/song/start_playing").
            *args: Message arguments.
        """
        self._require_connection()
        # Flatten single-element list/tuple args
        flat_args = []
        for a in args:
            if isinstance(a, (list, tuple)):
                flat_args.extend(a)
            else:
                flat_args.append(a)
        self._client.send_message(address, flat_args if flat_args else None)

    def query(
        self, address: str, *args, timeout: Optional[float] = None
    ) -> Tuple:
        """Send an OSC query and wait for the response.

        AbletonOSC replies to /live/xxx/get/yyy on the same address.
        For set/action commands the reply address may vary, so we
        capture the next message matching the address prefix.

        Args:
            address: OSC address to query.
            *args: Query arguments.
            timeout: Override default timeout.

        Returns:
            Tuple of response arguments.

        Raises:
            AbletonOSCError: On timeout or connection error.
        """
        self._require_connection()
        t = timeout if timeout is not None else self._timeout

        with self._response_lock:
            self._response_event.clear()
            self._response_address = address
            self._response_args = None

        flat_args = []
        for a in args:
            if isinstance(a, (list, tuple)):
                flat_args.extend(a)
            else:
                flat_args.append(a)
        self._client.send_message(address, flat_args if flat_args else None)

        if self._response_event.wait(timeout=t):
            with self._response_lock:
                return self._response_args or ()
        else:
            raise AbletonOSCError(
                f"Timeout ({t}s) waiting for response to {address}. "
                "Is Ableton Live running with AbletonOSC enabled?"
            )

    def _default_handler(self, address: str, *args) -> None:
        """Handle all incoming OSC messages.

        Routes responses to the synchronous query mechanism, and
        dispatches to any registered persistent listeners.
        """
        # Check if this matches a pending synchronous query
        with self._response_lock:
            if (
                self._response_address is not None
                and address == self._response_address
            ):
                self._response_args = args
                self._response_event.set()

        # Dispatch to persistent listeners
        for prefix, callbacks in self._listeners.items():
            if address.startswith(prefix):
                for cb in callbacks:
                    try:
                        cb(address, *args)
                    except Exception:
                        pass

    def add_listener(self, address_prefix: str, callback: callable) -> None:
        """Register a persistent listener for an OSC address prefix."""
        self._listeners.setdefault(address_prefix, []).append(callback)

    def remove_listener(self, address_prefix: str, callback: callable) -> None:
        """Remove a persistent listener."""
        if address_prefix in self._listeners:
            self._listeners[address_prefix] = [
                cb for cb in self._listeners[address_prefix] if cb is not callback
            ]
