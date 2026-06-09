"""
Claude Terminal Bridge
Sends messages to the Max for Live Claude Terminal device via UDP.
Import this in ProducerMind or any Claude automation script.

Usage:
    from claude_terminal_bridge import terminal

    terminal.cmd("transport play")
    terminal.osc("/live/song/start_playing")
    terminal.info("Setting tempo to 128")
    terminal.param("Tempo: 128 BPM")
    terminal.error("Device not found")
    terminal.note("C4 vel:100 dur:0.5")
"""

import socket
import time

class ClaudeTerminal:
    def __init__(self, host='127.0.0.1', port=11002):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _send(self, prefix, msg):
        text = f"[{prefix}] {msg}"
        try:
            self.sock.sendto(text.encode('utf-8'), (self.host, self.port))
        except Exception:
            pass

    def cmd(self, msg):
        """Blue - CLI commands being executed"""
        self._send('CMD', msg)

    def osc(self, msg):
        """Green - OSC messages sent/received"""
        self._send('OSC', msg)

    def info(self, msg):
        """Gray - General info"""
        self._send('INFO', msg)

    def warn(self, msg):
        """Orange - Warnings"""
        self._send('WARN', msg)

    def error(self, msg):
        """Red - Errors"""
        self._send('ERR', msg)

    def sys(self, msg):
        """Purple - System messages"""
        self._send('SYS', msg)

    def param(self, msg):
        """Cyan - Parameter changes"""
        self._send('PARAM', msg)

    def note(self, msg):
        """Yellow - MIDI note events"""
        self._send('NOTE', msg)

    def raw(self, msg):
        """Send raw text"""
        try:
            self.sock.sendto(msg.encode('utf-8'), (self.host, self.port))
        except Exception:
            pass

    def divider(self, label=''):
        """Visual separator line"""
        if label:
            self._send('SYS', f'--- {label} ---')
        else:
            self._send('SYS', '─' * 40)

    def close(self):
        self.sock.close()


# Singleton instance
terminal = ClaudeTerminal()


if __name__ == '__main__':
    # Demo / test
    t = ClaudeTerminal()
    t.sys('Claude Terminal Bridge connected')
    t.divider('DEMO')
    t.cmd('ableton transport play')
    t.osc('/live/song/start_playing')
    t.param('Tempo: 128.0 BPM')
    t.param('Track 0 Volume: 0.75')
    t.info('Scanning devices on Track 0...')
    t.note('C4 vel:100 dur:0.5 @ beat 1.0')
    t.note('E4 vel:90 dur:0.5 @ beat 1.5')
    t.note('G4 vel:85 dur:0.5 @ beat 2.0')
    t.warn('High CPU usage detected: 62%')
    t.cmd('ableton mixer volume 0 0.85')
    t.osc('/live/track/set/volume 0 0.85')
    t.param('Track 0 Volume: 0.85')
    t.info('Operation complete')
    t.divider()
    t.sys('Demo finished - 12 messages sent')
    t.close()
    print('Demo messages sent to UDP 11002')
