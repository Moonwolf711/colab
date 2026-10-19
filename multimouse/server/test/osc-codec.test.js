'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode, actionToOsc } = require('../osc-codec');

test('encode produces 4-byte aligned OSC with i/f/s/T/F/N tags', () => {
  const b = encode('/live/clip_slot/fire', [3, 7]);
  assert.equal(b.length % 4, 0);
  assert.equal(b.toString('latin1', 0, 20), '/live/clip_slot/fire');
  assert.deepEqual(decode(b), [{ address: '/live/clip_slot/fire', args: [3, 7] }]);
  const m = decode(encode('/x', [1, 0.5, 'héllo', true, false, null, -3]))[0];
  assert.equal(m.args[0], 1);
  assert.equal(m.args[1], 0.5);
  assert.equal(m.args[2], 'héllo');
  assert.deepEqual(m.args.slice(3), [true, false, null, -3]);
});

test('floats stay floats (volume) and integers stay integers (indices)', () => {
  const v = encode('/live/track/set/volume', [4, 0.85]);
  const tags = v.toString('latin1').split('\0').find((s) => s.startsWith(','));
  assert.equal(tags, ',if');
  assert.ok(Math.abs(decode(v)[0].args[1] - 0.85) < 1e-6);
  assert.equal(encode('/a', [1.0]).toString('latin1').includes(',i'), true, '1.0 is an integer in JS and goes as i');
});

test('decode handles a Live-style reply with nil (empty slot) and bundles', () => {
  const reply = encode('/live/track/get/clips/name', [5, 'DNB 164', null, 'x', null]);
  assert.deepEqual(decode(reply)[0].args, [5, 'DNB 164', null, 'x', null]);
  const a = encode('/a', [1]), b = encode('/b', [2]);
  const len = (n) => { const x = Buffer.alloc(4); x.writeInt32BE(n); return x; };
  const bundle = Buffer.concat([Buffer.from('#bundle\0', 'latin1'), Buffer.alloc(8), len(a.length), a, len(b.length), b]);
  assert.deepEqual(decode(bundle).map((m) => m.address), ['/a', '/b']);
});

test('decode rejects garbage instead of returning nonsense', () => {
  assert.throws(() => decode(Buffer.from('hello')));
  assert.throws(() => decode(Buffer.from('/a\0\0,q\0\0', 'latin1')));
});

test('actions map to the AbletonOSC addresses verified in the installed source', () => {
  const M = (cmd, params) => actionToOsc({ cmd, params });
  assert.deepEqual(M('fire_clip', { track_index: 2, clip_index: 1 }), { address: '/live/clip_slot/fire', args: [2, 1] });
  assert.deepEqual(M('stop_clip', { track_index: 2, clip_index: 1 }), { address: '/live/clip_slot/stop', args: [2, 1] });
  assert.deepEqual(M('fire_scene', { scene_index: 3 }), { address: '/live/scene/fire', args: [3] });
  assert.deepEqual(M('stop_track_clips', { track_index: 6 }), { address: '/live/track/stop_all_clips', args: [6] });
  assert.deepEqual(M('set_track_volume', { track_index: 1, volume: 0.75 }), { address: '/live/track/set/volume', args: [1, 0.75] });
  assert.deepEqual(M('select_track', { track_index: 3 }), { address: '/live/view/set/selected_track', args: [3] });
  assert.deepEqual(M('duplicate_clip', { track_index: 2, clip_index: 0, target_clip_index: 3 }), { address: '/live/clip_slot/duplicate_clip_to', args: [2, 0, 2, 3] });
  assert.deepEqual(M('delete_clip', { track_index: 2, clip_index: 0 }), { address: '/live/clip_slot/delete_clip', args: [2, 0] });
  assert.deepEqual(M('set_clip_color', { track_index: 2, clip_index: 0, color_index: 14 }), { address: '/live/clip/set/color_index', args: [2, 0, 14] });
  assert.equal(M('nope', {}), null);
});
