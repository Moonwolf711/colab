'use strict';
/**
 * osc-link.js - UDP link to AbletonOSC. Sends to host:outPort (Live listens on 11000); replies and listener
 * notifications arrive on inPort (AbletonOSC always answers to 11001), which this process must own exclusively.
 */
const dgram = require('dgram');
const { encode, decode } = require('./osc-codec');

class OscLink {
  constructor({ host, outPort, inPort }) {
    this.host = host; this.outPort = outPort; this.inPort = inPort;
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    this.pending = [];
    this.handlers = [];
    this.lastRx = 0;
    this.sock.on('message', (buf) => this._rx(buf));
    this.sock.on('error', () => { /* send errors on a closed socket are ignored */ });
  }

  /** Resolves when bound to inPort; rejects (e.g. EADDRINUSE) if another process owns it. */
  bind() {
    return new Promise((resolve, reject) => {
      const onErr = (e) => reject(e);
      this.sock.once('error', onErr);
      this.sock.bind(this.inPort, '127.0.0.1', () => { this.sock.removeListener('error', onErr); resolve(); });
    });
  }

  _rx(buf) {
    let msgs;
    try { msgs = decode(buf); } catch (e) { return; }
    this.lastRx = Date.now();
    for (const m of msgs) {
      for (const h of this.handlers) h(m.address, m.args);
      const i = this.pending.findIndex((p) => p.address === m.address && p.prefix.every((v, k) => m.args[k] === v));
      if (i >= 0) {
        const p = this.pending.splice(i, 1)[0];
        clearTimeout(p.timer);
        p.resolve(m.args);
      }
    }
  }

  onMessage(fn) { this.handlers.push(fn); }

  send(address, args) {
    const b = encode(address, args);
    this.sock.send(b, 0, b.length, this.outPort, this.host);
  }

  /** Send a read request; resolves with the reply args when a reply for the same address starts with `prefix`. */
  query(address, args, prefix, timeoutMs) {
    return new Promise((resolve, reject) => {
      const p = { address, prefix: prefix || [], resolve };
      p.timer = setTimeout(() => {
        const i = this.pending.indexOf(p);
        if (i >= 0) this.pending.splice(i, 1);
        reject(new Error('OSC timeout ' + address));
      }, timeoutMs || 1500);
      this.pending.push(p);
      this.send(address, args);
    });
  }

  close() { try { this.sock.close(); } catch (e) { /* already closed */ } }
}

module.exports = { OscLink };
