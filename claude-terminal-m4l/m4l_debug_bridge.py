"""
Max for Live Debug Bridge
Always-on connection to M4L with hot reload and screenshot reference.

Ports:
  11002 - Claude Terminal (display messages)
  11003 - Debug commands (reload, evaluate, inspect)
  11000 - AbletonOSC (Ableton control)
  11001 - AbletonOSC responses

Usage:
    from m4l_debug_bridge import debug, terminal, ableton, screenshot

    debug.reload('claude-terminal.js')     # Hot reload JS in Max
    debug.eval('post("hello");')           # Evaluate JS in Max context
    debug.inspect('live_set')              # Inspect LOM object
    debug.console('test message')          # Print to Max console

    terminal.cmd('transport play')         # Log to in-DAW terminal
    ableton.play()                         # Control Ableton via OSC

    screenshot()                           # Capture Ableton state
    screenshot(region='mixer')             # Capture specific region
"""

import socket
import time
import os
import json
import threading
from pathlib import Path

try:
    from pythonosc import udp_client, osc_server, dispatcher
except ImportError:
    udp_client = None

try:
    import pyautogui
    from PIL import Image
except ImportError:
    pyautogui = None


# =============================================================
# SCREENSHOT UTILITY
# =============================================================

SCREENSHOT_DIR = Path(__file__).parent / 'screenshots'
SCREENSHOT_DIR.mkdir(exist_ok=True)

# Pre-defined regions of Ableton (1920x1080)
REGIONS = {
    'full':        (0, 0, 1920, 1080),
    'transport':   (0, 0, 1920, 35),
    'browser':     (0, 35, 230, 650),
    'arrangement': (230, 35, 1920, 650),
    'tracks':      (230, 35, 350, 650),
    'clips':       (350, 35, 1920, 650),
    'mixer':       (0, 650, 1920, 850),
    'detail':      (0, 650, 1920, 1050),
    'devices':     (230, 650, 1920, 850),
    'statusbar':   (0, 1050, 1920, 1080),
    'terminal':    (0, 750, 960, 1050),
}

def screenshot(region=None, save=True, filename=None):
    """Take a screenshot of Ableton, optionally cropped to a region.

    Args:
        region: Name from REGIONS dict, or (x,y,w,h) tuple, or None for full
        save: Whether to save to disk
        filename: Custom filename (auto-generated if None)

    Returns:
        Path to saved screenshot, or PIL Image if save=False
    """
    if not pyautogui:
        print('[DEBUG] pyautogui not installed')
        return None

    img = pyautogui.screenshot()

    if region:
        if isinstance(region, str) and region in REGIONS:
            box = REGIONS[region]
        elif isinstance(region, (tuple, list)) and len(region) == 4:
            box = region
        else:
            print(f'[DEBUG] Unknown region: {region}')
            box = None

        if box:
            img = img.crop(box)

    if not save:
        return img

    if not filename:
        ts = time.strftime('%H%M%S')
        label = region if isinstance(region, str) else 'capture'
        filename = f'ss_{label}_{ts}.png'

    path = SCREENSHOT_DIR / filename
    img.save(str(path))
    return str(path)


def screenshot_diff(region='full', threshold=0.05):
    """Take two screenshots and highlight what changed."""
    if not pyautogui:
        return None

    img1 = pyautogui.screenshot()
    time.sleep(0.5)
    img2 = pyautogui.screenshot()

    if isinstance(region, str) and region in REGIONS:
        box = REGIONS[region]
        img1 = img1.crop(box)
        img2 = img2.crop(box)

    # Simple pixel diff
    import numpy as np
    a1 = np.array(img1).astype(float)
    a2 = np.array(img2).astype(float)
    diff = np.abs(a1 - a2).mean(axis=2)
    changed_pixels = (diff > threshold * 255).sum()
    total_pixels = diff.shape[0] * diff.shape[1]

    return {
        'changed_ratio': changed_pixels / total_pixels,
        'changed_pixels': int(changed_pixels),
        'total_pixels': total_pixels
    }


# =============================================================
# DEBUG BRIDGE (Port 11003)
# =============================================================

class M4LDebug:
    """Send debug commands to Max for Live."""

    def __init__(self, host='127.0.0.1', port=11003):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._watch_thread = None
        self._watching = False

    def _send(self, msg):
        try:
            self.sock.sendto(msg.encode('utf-8'), (self.host, self.port))
        except Exception as e:
            print(f'[DEBUG] Send failed: {e}')

    def reload(self, filename='claude-terminal.js'):
        """Hot reload a JS file in Max for Live.
        Sends 'compile' to the [js] object."""
        self._send(f'reload {filename}')
        print(f'[DEBUG] Reload sent: {filename}')

    def eval(self, code):
        """Evaluate JavaScript code in Max's JS context."""
        self._send(f'eval {code}')

    def inspect(self, lom_path):
        """Inspect a Live Object Model path."""
        self._send(f'inspect {lom_path}')

    def console(self, msg):
        """Print to Max console."""
        self._send(f'console {msg}')

    def bang(self):
        """Send a bang to trigger watchers."""
        self._send('bang')

    def watch_files(self, directory=None, interval=1.0):
        """Watch JS files for changes and auto-reload.

        Args:
            directory: Directory to watch (default: same as this script)
            interval: Check interval in seconds
        """
        if directory is None:
            directory = Path(__file__).parent

        self._watching = True
        mtimes = {}

        def _watch():
            while self._watching:
                for f in Path(directory).glob('*.js'):
                    mtime = f.stat().st_mtime
                    if f.name in mtimes and mtimes[f.name] < mtime:
                        print(f'[HOT RELOAD] {f.name} changed')
                        self.reload(f.name)
                    mtimes[f.name] = mtime
                time.sleep(interval)

        self._watch_thread = threading.Thread(target=_watch, daemon=True)
        self._watch_thread.start()
        print(f'[DEBUG] Watching {directory} for JS changes (hot reload)')

    def stop_watch(self):
        self._watching = False


# =============================================================
# TERMINAL BRIDGE (Port 11002) - reuse from claude_terminal_bridge
# =============================================================

class TerminalBridge:
    def __init__(self, host='127.0.0.1', port=11002):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _send(self, prefix, msg):
        try:
            self.sock.sendto(f'[{prefix}] {msg}'.encode('utf-8'), (self.host, self.port))
        except Exception:
            pass

    def cmd(self, msg):    self._send('CMD', msg)
    def osc(self, msg):    self._send('OSC', msg)
    def info(self, msg):   self._send('INFO', msg)
    def warn(self, msg):   self._send('WARN', msg)
    def error(self, msg):  self._send('ERR', msg)
    def sys(self, msg):    self._send('SYS', msg)
    def param(self, msg):  self._send('PARAM', msg)
    def note(self, msg):   self._send('NOTE', msg)
    def divider(self, label=''):
        self._send('SYS', f'--- {label} ---' if label else '─' * 40)


# =============================================================
# ABLETON OSC BRIDGE (Port 11000)
# =============================================================

class AbletonBridge:
    """Control Ableton Live via AbletonOSC."""

    def __init__(self, host='127.0.0.1', port=11000, terminal=None):
        self.host = host
        self.port = port
        self.terminal = terminal
        self._client = None

        if udp_client:
            self._client = udp_client.SimpleUDPClient(host, port)

    def _osc(self, address, *args):
        if self.terminal:
            arg_str = ' '.join(str(a) for a in args)
            self.terminal.osc(f'{address} {arg_str}')
        if self._client:
            self._client.send_message(address, list(args) if args else None)
        else:
            # Fallback: raw UDP
            msg = address
            if args:
                msg += ' ' + ' '.join(str(a) for a in args)
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(msg.encode('utf-8'), (self.host, self.port))
            sock.close()

    # Transport
    def play(self):           self._osc('/live/song/start_playing')
    def stop(self):           self._osc('/live/song/stop_playing')
    def record(self, on=True):self._osc('/live/song/set/record_mode', int(on))
    def tempo(self, bpm):     self._osc('/live/song/set/tempo', float(bpm))
    def metronome(self, on):  self._osc('/live/song/set/metronome', int(on))
    def loop(self, on):       self._osc('/live/song/set/loop', int(on))
    def undo(self):           self._osc('/live/song/undo')
    def redo(self):           self._osc('/live/song/redo')

    # Tracks
    def volume(self, track, val):  self._osc('/live/track/set/volume', track, float(val))
    def pan(self, track, val):     self._osc('/live/track/set/panning', track, float(val))
    def mute(self, track, on):     self._osc('/live/track/set/mute', track, int(on))
    def solo(self, track, on):     self._osc('/live/track/set/solo', track, int(on))
    def arm(self, track, on):      self._osc('/live/track/set/arm', track, int(on))

    # Clips
    def fire_clip(self, track, slot):  self._osc('/live/clip/fire', track, slot)
    def stop_clip(self, track, slot):  self._osc('/live/clip/stop', track, slot)
    def fire_scene(self, scene):       self._osc('/live/scene/fire', scene)

    # Devices
    def set_param(self, track, device, param, value):
        self._osc('/live/device/set/parameter/value', track, device, param, float(value))


# =============================================================
# SINGLETON INSTANCES
# =============================================================

debug = M4LDebug()
terminal = TerminalBridge()
ableton = AbletonBridge(terminal=terminal)


# =============================================================
# AUTO-START
# =============================================================

def start_dev_mode():
    """Start hot reload watcher + connect everything."""
    debug.watch_files()
    terminal.sys('Debug bridge connected')
    terminal.sys('Hot reload active')
    print('[M4L DEBUG] Dev mode started:')
    print('  - Terminal:  UDP 11002')
    print('  - Debug:     UDP 11003')
    print('  - Ableton:   UDP 11000')
    print('  - Hot reload: watching *.js')
    print('  - Screenshots: screenshot(region="mixer")')


if __name__ == '__main__':
    start_dev_mode()

    # Keep alive for hot reload
    print('\nPress Ctrl+C to stop.\n')
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        debug.stop_watch()
        print('\n[M4L DEBUG] Stopped.')
