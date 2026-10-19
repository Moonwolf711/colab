'use strict';
/** osc-codec.js - minimal pure OSC 1.0 encode/decode (message + bundle). Types: i f s b h d T F N t c I. */

const pad4 = (n) => (n + 3) & ~3;

function encStr(s) {
  const b = Buffer.from(s + '\0', 'utf8');
  return Buffer.concat([b, Buffer.alloc(pad4(b.length) - b.length)]);
}

/** Encode one message. JS integers -> i, other numbers -> f, strings -> s, booleans -> T/F, null -> N. */
function encode(address, args) {
  let tags = ',';
  const parts = [];
  for (const a of args || []) {
    if (a === null || a === undefined) tags += 'N';
    else if (a === true) tags += 'T';
    else if (a === false) tags += 'F';
    else if (typeof a === 'string') { tags += 's'; parts.push(encStr(a)); }
    else if (typeof a === 'number') {
      const b = Buffer.alloc(4);
      if (Number.isInteger(a) && Math.abs(a) < 2147483648) { tags += 'i'; b.writeInt32BE(a); } else { tags += 'f'; b.writeFloatBE(a); }
      parts.push(b);
    } else throw new TypeError('unsupported OSC arg ' + typeof a);
  }
  return Buffer.concat([encStr(address), encStr(tags), ...parts]);
}

function readStr(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error('unterminated OSC string');
  return { s: buf.toString('utf8', off, end), next: off + pad4(end - off + 1) };
}

/** Decode a datagram into [{address, args}] (bundles are flattened). Throws on malformed input. */
function decode(buf) {
  if (buf.length >= 8 && buf.toString('latin1', 0, 8) === '#bundle\0') {
    const out = [];
    let off = 16;
    while (off + 4 <= buf.length) {
      const len = buf.readInt32BE(off);
      off += 4;
      if (len < 0 || off + len > buf.length) throw new Error('bad bundle element');
      out.push(...decode(buf.subarray(off, off + len)));
      off += len;
    }
    return out;
  }
  const a = readStr(buf, 0);
  if (!a.s.startsWith('/')) throw new Error('OSC address must start with /');
  let off = a.next;
  const args = [];
  if (off >= buf.length) return [{ address: a.s, args }];
  const t = readStr(buf, off);
  off = t.next;
  if (t.s[0] !== ',') throw new Error('missing type tag');
  for (const c of t.s.slice(1)) {
    switch (c) {
      case 'i': args.push(buf.readInt32BE(off)); off += 4; break;
      case 'f': args.push(buf.readFloatBE(off)); off += 4; break;
      case 'h': args.push(Number(buf.readBigInt64BE(off))); off += 8; break;
      case 'd': args.push(buf.readDoubleBE(off)); off += 8; break;
      case 't': args.push(null); off += 8; break;
      case 'c': args.push(String.fromCharCode(buf.readInt32BE(off))); off += 4; break;
      case 's': { const r = readStr(buf, off); args.push(r.s); off = r.next; break; }
      case 'b': { const n = buf.readInt32BE(off); args.push(buf.subarray(off + 4, off + 4 + n)); off += 4 + pad4(n); break; }
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      default: throw new Error('unsupported OSC type ' + c);
    }
  }
  return [{ address: a.s, args }];
}

/** Map a jam-core action to its AbletonOSC message, or null if OSC has no equivalent. */
function actionToOsc(a) {
  const p = a.params;
  switch (a.cmd) {
    case 'fire_clip': return { address: '/live/clip_slot/fire', args: [p.track_index, p.clip_index] };
    case 'stop_clip': return { address: '/live/clip_slot/stop', args: [p.track_index, p.clip_index] };
    case 'fire_scene': return { address: '/live/scene/fire', args: [p.scene_index] };
    case 'stop_track_clips': return { address: '/live/track/stop_all_clips', args: [p.track_index] };
    case 'set_track_volume': return { address: '/live/track/set/volume', args: [p.track_index, p.volume] };
    case 'select_track': return { address: '/live/view/set/selected_track', args: [p.track_index] };
    case 'duplicate_clip': return { address: '/live/clip_slot/duplicate_clip_to', args: [p.track_index, p.clip_index, p.track_index, p.target_clip_index] };
    case 'delete_clip': return { address: '/live/clip_slot/delete_clip', args: [p.track_index, p.clip_index] };
    case 'set_clip_color': return { address: '/live/clip/set/color_index', args: [p.track_index, p.clip_index, p.color_index] };
    default: return null;
  }
}

module.exports = { encode, decode, actionToOsc };
