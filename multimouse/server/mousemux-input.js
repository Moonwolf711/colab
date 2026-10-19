'use strict';
// Original wire adapter for MouseMux's flat WebSocket protocol; no vendor SDK code.
// Protocol reference: https://www.mousemux.com/pages/sdk-web/
const WebSocket = require('ws');

const MAX_USERS = 256;
const MAX_DEVICES = 1024;
const MAX_PAYLOAD = 65536;
const USER_BASE = 0x100000000;
const DEVICE_BASE = 0x200000000;
const BUTTONS = [['L', 1, 2], ['R', 4, 8], ['M', 16, 32], ['X1', 64, 128], ['X2', 256, 512]];
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const label = (s, fallback) => typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) : fallback;

function localUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid MouseMux WebSocket URL'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('MouseMux URL must use ws/wss on localhost, 127.0.0.1 or [::1], without credentials or query');
  }
  return url.href;
}

class MouseMuxInput {
  constructor(options = {}) {
    const r = options.rect;
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isSafeInteger) || r.w < 1 || r.h < 1 ||
        !Number.isSafeInteger(r.x + r.w) || !Number.isSafeInteger(r.y + r.h)) {
      throw new Error('MouseMux requires a physical-pixel rect {x,y,w,h} with positive integer dimensions');
    }
    if (typeof options.onDatagram !== 'function') throw new Error('MouseMux requires onDatagram(text)');
    this.url = localUrl(options.url || 'ws://127.0.0.1:41001');
    this.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    this.onDatagram = options.onDatagram;
    this.reconnectMs = options.reconnectMs === undefined ? 1500 : options.reconnectMs;
    if (!Number.isInteger(this.reconnectMs) || this.reconnectMs < 20 || this.reconnectMs > 60000) {
      throw new Error('reconnectMs must be an integer from 20 to 60000');
    }
    this.connected = false;
    this.enabled = false;
    this.error = '';
    this.version = '';
    this.users = new Map();
    this.devices = new Map();
    this.active = new Map();
    this.retired = new Set();
    this.socket = null;
    this.running = false;
    this.blocked = false;
    this.retry = null;
    this.heartbeat = null;
    this.loginTimer = null;
    this.pingTimer = null;
    this.pongTimer = null;
  }

  start() {
    if (this.running || this.blocked) return;
    this.running = true;
    this._connect();
  }

  stop() {
    this.running = false;
    this.enabled = false;
    clearTimeout(this.retry); this.retry = null;
    clearInterval(this.heartbeat); this.heartbeat = null;
    clearTimeout(this.loginTimer); this.loginTimer = null;
    this._clearProbe();
    this._cancelAll();
    this.connected = false;
    this.users.clear(); this.devices.clear(); this.retired.clear();
    this._emit(['J 0']);
    const ws = this.socket; this.socket = null;
    if (ws) ws.terminate();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled && !this.blocked;
    if (!this.enabled) this._cancelAll();
    this._emit(['J ' + (this.enabled && this.connected ? 1 : 0)]);
  }

  getStatus() {
    return { connected: this.connected, enabled: this.enabled, error: this.error, version: this.version,
      users: [...this.users.values()].map((u) => ({ id: u.id, idx: u.idx, name: u.name,
        devices: u.devices.map((d) => ({ hwid: d.hwid, type: d.type })) })) };
  }

  _emit(lines) { if (lines.length) this.onDatagram(lines.join('\n') + '\n'); }

  _cancel(idx) {
    if (!this.active.delete(idx)) return;
    // Removing a device cancels the gesture. A synthetic button-up would commit a click.
    this._emit(['D ' + idx + ' remove']);
  }

  _cancelAll() { for (const idx of [...this.active.keys()]) this._cancel(idx); }

  _send(type, fields) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, ...fields }));
  }

  _connect() {
    if (!this.running || this.socket) return;
    const ws = new WebSocket(this.url, { maxPayload: MAX_PAYLOAD, handshakeTimeout: 5000, perMessageDeflate: false });
    this.socket = ws;
    ws.on('open', () => {
      if (ws !== this.socket) return;
      this._send('client.login.request.A2M', { appName: 'CoLaB MultiMouse', appVersion: '0.1.0',
        appBuildDate: '2026-10-19', sdkVersion: 'colab-wire-1', sdkBuildDate: '2026-10-19' });
      this._send('user.list.request.A2M');
      this.loginTimer = setTimeout(() => {
        if (ws === this.socket && !this.connected) { this.error = 'MouseMux login timed out'; ws.terminate(); }
      }, 5000);
    });
    ws.on('message', (data, binary) => {
      if (ws !== this.socket || binary || data.length > MAX_PAYLOAD) return;
      let message;
      try { message = JSON.parse(data.toString('utf8')); } catch { return; }
      this._message(message);
    });
    ws.on('error', (e) => {
      if (ws === this.socket) this.error = 'MouseMux connection failed' + (e.code ? ': ' + label(e.code, '') : '');
    });
    ws.on('pong', () => {
      if (ws !== this.socket) return;
      clearTimeout(this.pongTimer); this.pongTimer = null;
    });
    ws.on('close', () => {
      if (ws !== this.socket) return;
      this.socket = null;
      this.connected = false;
      this.enabled = false;
      this._cancelAll();
      this.users.clear(); this.devices.clear(); this.retired.clear();
      clearInterval(this.heartbeat); this.heartbeat = null;
      clearTimeout(this.loginTimer); this.loginTimer = null;
      this._clearProbe();
      this._emit(['J 0']);
      if (!this.error) this.error = 'MouseMux disconnected';
      if (this.running) this.retry = setTimeout(() => { this.retry = null; this._connect(); }, this.reconnectMs);
    });
  }

  _ready() {
    if (this.connected) return;
    this.connected = true; this.error = '';
    clearTimeout(this.loginTimer); this.loginTimer = null;
    const beat = () => this._emit(['HELLO ' + process.pid + ' MouseMux-' + (this.version || 'SDK'), 'J ' + (this.enabled ? 1 : 0)]);
    beat();
    this.heartbeat = setInterval(beat, 2000);
    this.heartbeat.unref();
    this.pingTimer = setInterval(() => this._probe(), 10000);
    this.pingTimer.unref();
  }

  _probe() {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.pongTimer) return;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      if (ws === this.socket) { this.error = 'MouseMux keepalive timed out'; ws.terminate(); }
    }, 5000);
    ws.ping();
  }

  _clearProbe() {
    clearInterval(this.pingTimer); this.pingTimer = null;
    clearTimeout(this.pongTimer); this.pongTimer = null;
  }

  _halt(reason) {
    this.error = reason;
    this.blocked = true;
    this.enabled = false;
    this.stop();
  }

  _message(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return;
    if (m.type === 'client.login.request.A2M' && m.ok === false) {
      this._halt('MouseMux login rejected: ' + label(m.error, 'unspecified error')); return;
    }
    if (m.type === 'client.login.request.A2M' && m.ok === true) { this._ready(); return; }
    switch (m.type) {
      case 'server.info.notify.M2A': this.version = label(m.version, ''); return;
      case 'server.ping.notify.M2A': this._send('client.pong.request.A2M'); return;
      case 'server.timeout.stopped.notify.M2A':
        this._halt('MouseMux session stopped: ' + label(m.reason, 'session timeout')); return;
      case 'server.shutdown.notify.M2A':
        this.error = 'MouseMux shutdown: ' + label(m.reason, 'server stopped');
        if (this.socket) this.socket.terminate(); return;
      case 'user.list.notify.M2A':
        if (Array.isArray(m.users)) this._roster(m.users); return;
      case 'user.create.notify.M2A':
      case 'user.dispose.notify.M2A':
      case 'user.changed.notify.M2A': this._changed(m); return;
      case 'pointer.motion.notify.M2A':
      case 'pointer.button.notify.M2A':
      case 'pointer.wheel.notify.M2A': this._pointer(m); return;
      default: return;
    }
  }

  _roster(list) {
    if (list.length > MAX_USERS) { this.error = 'MouseMux user limit exceeded'; return false; }
    const users = new Map(), devices = new Map();
    for (const u of list) {
      if (!u || !uint(u.id) || !Array.isArray(u.devices) || u.devices.length > 32 || users.has(u.id)) return false;
      const user = { id: u.id, idx: USER_BASE + u.id, name: label(u.name, 'User ' + u.id), devices: [] };
      for (const d of u.devices) {
        if (!d || !uint(d.hwid) || devices.has(d.hwid) || devices.size >= MAX_DEVICES) return false;
        const device = { hwid: d.hwid, type: label(d.type, '') };
        user.devices.push(device); devices.set(d.hwid, { user, type: device.type });
      }
      users.set(user.id, user);
    }
    for (const [idx, p] of this.active) {
      const next = devices.get(p.hwid);
      if (!next || next.user.idx !== idx || next.type === 'keyboard') this._cancel(idx);
      else if (p.name !== next.user.name) {
        p.name = next.user.name; this._emit(['D ' + idx + ' add MouseMux ' + p.name]);
      }
    }
    for (const hwid of this.devices.keys()) if (!devices.has(hwid)) this._retire(hwid);
    for (const hwid of devices.keys()) this.retired.delete(hwid);
    this.users = users; this.devices = devices;
    return true;
  }

  _changed(m) {
    const disposed = m.type === 'user.dispose.notify.M2A' || m.action === 'dispose';
    if (disposed) {
      const ids = new Set();
      if (uint(m.userId)) ids.add(m.userId);
      for (const hwid of [m.hwid_ms, m.hwid_kb]) {
        const d = this.devices.get(hwid);
        if (d) ids.add(d.user.id);
        if (uint(hwid)) { this._cancel(DEVICE_BASE + hwid); this._retire(hwid); }
      }
      for (const id of ids) {
        const u = this.users.get(id);
        this._cancel(USER_BASE + id);
        if (u) for (const d of u.devices) { this.devices.delete(d.hwid); this._retire(d.hwid); }
        this.users.delete(id);
      }
    } else {
      // Until the refreshed list arrives, ownership may have moved to another person.
      for (const hwid of [m.hwid_ms, m.hwid_kb]) if (uint(hwid)) {
        const d = this.devices.get(hwid);
        this._cancel(d ? d.user.idx : DEVICE_BASE + hwid);
        this._retire(hwid);
      }
    }
    // Lifecycle packets can omit IDs or full device sets. Only the full roster can assign ownership.
    this._send('user.list.request.A2M');
  }

  _retire(hwid) {
    if (this.retired.size >= MAX_DEVICES) this.retired.delete(this.retired.values().next().value);
    this.retired.add(hwid);
  }

  _pointer(m) {
    if (!this.connected || !this.enabled || !uint(m.hwid) || this.retired.has(m.hwid) || !Number.isFinite(m.x) || !Number.isFinite(m.y) ||
        (m.inputSource !== undefined && m.inputSource !== 'server') || m.deviceType === 'keyboard') return;
    const device = this.devices.get(m.hwid);
    if (device && device.type === 'keyboard') return;
    const idx = device ? device.user.idx : DEVICE_BASE + m.hwid;
    const r = this.rect;
    if (m.x < r.x || m.y < r.y || m.x >= r.x + r.w || m.y >= r.y + r.h) { this._cancel(idx); return; }
    const button = m.type === 'pointer.button.notify.M2A';
    const wheel = m.type === 'pointer.wheel.notify.M2A';
    if (button && (!Number.isInteger(m.button) || m.button < 1 || m.button > 0x3ff)) return;
    if (wheel && (!Number.isInteger(m.delta) || Math.abs(m.delta) > 0x7fffffff ||
        (m.horizontal !== undefined && typeof m.horizontal !== 'boolean'))) return;
    let p = this.active.get(idx);
    const lines = [];
    if (!p) {
      if (this.active.size >= MAX_USERS) return;
      p = { hwid: m.hwid, name: device ? device.user.name : 'device ' + m.hwid, held: 0 };
      this.active.set(idx, p);
      lines.push('D ' + idx + ' add MouseMux ' + p.name);
    }
    const norm = (v, origin, length) => Math.round(Math.min(1, (v - origin) / Math.max(1, length - 1)) * 65535);
    lines.push('A ' + idx + ' ' + norm(m.x, r.x, r.w) + ' ' + norm(m.y, r.y, r.h));
    if (button) for (const [name, down, up] of BUTTONS) {
      if ((m.button & down) && !(p.held & down)) { p.held |= down; lines.push('B ' + idx + ' ' + name + ' 1'); }
      if ((m.button & up) && (p.held & down)) { p.held &= ~down; lines.push('B ' + idx + ' ' + name + ' 0'); }
    }
    if (wheel && m.delta) lines.push((m.horizontal ? 'H ' : 'W ') + idx + ' ' + m.delta);
    this._emit(lines);
  }
}

module.exports = { MouseMuxInput };
