/**
 * param-sync-mock-test.js — Phase 2 dispatch + apply paths covered with
 * a MockAbletonClient. No AbletonBridge, no Live restart, nothing
 * touched on the user's actual machine state.
 *
 * What this test exercises (REAL code paths from this session):
 *   - ParamSync._applyRemoteWarpMarkers (commit da8cfbd)
 *   - ParamSync._applyRemoteClipNotes — basic + extended branch (commit da8cfbd)
 *   - ParamSync._pollClipWarpMarkers — change detect → sendSyncDelta (commit da8cfbd)
 *   - ParamSync._pollAutomationAllTracksTick — focused-skip + per-track throttle (commit 6e7db45)
 *   - ParamSync._pollClipNotes — extended preference (commit da8cfbd)
 *   - ParamSync echo lock after apply (existing pattern, reused by warp markers)
 *
 * Strategy: construct ParamSync with a MockAbletonClient and a
 * FakeEngine that records every sendSyncDelta call. Call the apply
 * and poll methods DIRECTLY (no timers, no real I/O). Assert on
 * recorded mock state.
 *
 * Run: node test/param-sync-mock-test.js
 * Exit: 0 on success, 1 on any failure.
 */

var ParamSync = require('../js/hub/param-sync');

var pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); pass++; }
  else    { console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ---------------------------------------------------------------------------
// MockAbletonClient — records every call, returns canned data
// ---------------------------------------------------------------------------

function MockAbletonClient(initialState) {
  this.calls = [];
  this.state = initialState || {};
  this.warpMarkers = {};       // 'T:C' -> [{beat_time, sample_time}]
  this.notesExtended = {};     // 'T:C' -> { notes: [...], extended: true }
  this._connected = true;
}

MockAbletonClient.prototype._record = function(name, args) {
  this.calls.push({ name: name, args: args, t: Date.now() });
};

MockAbletonClient.prototype.isConnected = function() { return this._connected; };

// --- Warp markers ---
MockAbletonClient.prototype.getClipWarpMarkers = function(track, clip) {
  this._record('getClipWarpMarkers', { track: track, clip: clip });
  var key = track + ':' + clip;
  return Promise.resolve({
    warp_markers: this.warpMarkers[key] || [],
    warp_mode: 'beats'
  });
};
MockAbletonClient.prototype.addClipWarpMarker = function(track, clip, beat, sample) {
  this._record('addClipWarpMarker', { track: track, clip: clip, beat: beat, sample: sample });
  var key = track + ':' + clip;
  if (!this.warpMarkers[key]) this.warpMarkers[key] = [];
  this.warpMarkers[key].push({ beat_time: beat, sample_time: sample });
  return Promise.resolve({});
};
MockAbletonClient.prototype.removeClipWarpMarker = function(track, clip, beat) {
  this._record('removeClipWarpMarker', { track: track, clip: clip, beat: beat });
  var key = track + ':' + clip;
  if (this.warpMarkers[key]) {
    this.warpMarkers[key] = this.warpMarkers[key].filter(function(m) { return m.beat_time !== beat; });
  }
  return Promise.resolve({});
};
MockAbletonClient.prototype.moveClipWarpMarker = function() { return Promise.resolve({}); };
// Mirror the convenience replace-all from real AbletonClient (but
// simpler — directly replaces the in-memory list).
MockAbletonClient.prototype.setClipWarpMarkers = function(track, clip, markers) {
  this._record('setClipWarpMarkers', { track: track, clip: clip, markers: markers });
  var key = track + ':' + clip;
  this.warpMarkers[key] = markers.map(function(m) {
    return { beat_time: m.beat_time, sample_time: m.sample_time };
  });
  return Promise.resolve({});
};

// --- Extended notes ---
MockAbletonClient.prototype.getClipNotesExtended = function(track, clip) {
  this._record('getClipNotesExtended', { track: track, clip: clip });
  var key = track + ':' + clip;
  return Promise.resolve(this.notesExtended[key] || { notes: [], extended: false });
};
MockAbletonClient.prototype.addNotesExtendedToClip = function(track, clip, notes) {
  this._record('addNotesExtendedToClip', { track: track, clip: clip, notes: notes });
  var key = track + ':' + clip;
  this.notesExtended[key] = { notes: notes, extended: true };
  return Promise.resolve({ note_count: notes.length, extended: true });
};
MockAbletonClient.prototype.addNotesToClip = function(track, clip, notes) {
  this._record('addNotesToClip', { track: track, clip: clip, notes: notes });
  var key = track + ':' + clip;
  this.notesExtended[key] = { notes: notes, extended: false };
  return Promise.resolve({ note_count: notes.length, extended: false });
};
MockAbletonClient.prototype.clearClipNotes = function(track, clip) {
  this._record('clearClipNotes', { track: track, clip: clip });
  return Promise.resolve({});
};

// --- Generic .send fallback for anything we didn't enumerate ---
MockAbletonClient.prototype.send = function(type, params) {
  this._record('send:' + type, params);
  // The poll path calls send('get_notes_extended', ...) directly.
  if (type === 'get_notes_extended') {
    var key = params.track_index + ':' + params.clip_index;
    return Promise.resolve(this.notesExtended[key] || { notes: [], extended: false });
  }
  if (type === 'get_clip_notes') {
    var k2 = params.track_index + ':' + params.clip_index;
    return Promise.resolve(this.notesExtended[k2] || { notes: [] });
  }
  return Promise.resolve({});
};

// Stubs that ParamSync may invoke during apply paths
MockAbletonClient.prototype.setTrackVolume = function() { this._record('setTrackVolume', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.setTrackPan = function() { this._record('setTrackPan', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.setTrackMute = function() { this._record('setTrackMute', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.setTrackSolo = function() { this._record('setTrackSolo', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.setTrackArm = function() { this._record('setTrackArm', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.setTempo = function() { this._record('setTempo', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.startPlayback = function() { this._record('startPlayback', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.stopPlayback = function() { this._record('stopPlayback', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.createClipAutomation = function() { this._record('createClipAutomation', arguments); return Promise.resolve({}); };
MockAbletonClient.prototype.getClipAutomation = function(t, c, p) {
  this._record('getClipAutomation', { track: t, clip: c, param: p });
  return Promise.resolve({ has_automation: false, points: [] });
};

// ---------------------------------------------------------------------------
// FakeEngine — captures dispatched deltas, supports on/off/state events
// ---------------------------------------------------------------------------

function FakeEngine() {
  this._handlers = {};
  this.dispatched = [];
  this.peerIp = '127.0.0.1';
}
FakeEngine.prototype.on = function(ev, h) {
  if (!this._handlers[ev]) this._handlers[ev] = [];
  this._handlers[ev].push(h);
};
FakeEngine.prototype.off = function(ev, h) {
  if (!this._handlers[ev]) return;
  this._handlers[ev] = this._handlers[ev].filter(function(x) { return x !== h; });
};
FakeEngine.prototype.sendSyncDelta = function(type, payload) {
  this.dispatched.push({ kind: 'sync_delta', type: type, payload: payload });
};
FakeEngine.prototype.sendTransport = function(playing, tempo) {
  this.dispatched.push({ kind: 'transport', playing: playing, tempo: tempo });
};
FakeEngine.prototype.sendParam = function(track, param, value) {
  this.dispatched.push({ kind: 'param', track: track, param: param, value: value });
};
FakeEngine.prototype.deltasOfType = function(type) {
  return this.dispatched.filter(function(d) { return d.kind === 'sync_delta' && d.type === type; });
};

// ---------------------------------------------------------------------------
// Construct ParamSync without starting timers
// ---------------------------------------------------------------------------

function makeParamSync() {
  var mock = new MockAbletonClient();
  var engine = new FakeEngine();
  // Pass mock as both client and writeClient so all paths route to it.
  var ps = new ParamSync(mock, engine, {
    writeClient: mock,
    clipClient: mock,
    userId: 'test'
  });
  return { ps: ps, mock: mock, engine: engine };
}

// ---------------------------------------------------------------------------
// Test 1: apply remote warp markers
// ---------------------------------------------------------------------------

async function testApplyWarpMarkers() {
  console.log('\n══ Test 1: apply remote warp markers ══');
  var ctx = makeParamSync();
  var now = Date.now();

  var payload = {
    track: 1,
    clip: 0,
    markers: [
      { beat_time: 0.0, sample_time: 0.0 },
      { beat_time: 1.0, sample_time: 22050.0 },
      { beat_time: 2.0, sample_time: 44100.0 }
    ],
    warp_mode: 'beats',
    hash: 'test-hash-1'
  };

  ctx.ps._applyRemoteWarpMarkers(payload, now);
  await sleep(50); // setClipWarpMarkers is async

  var setCall = ctx.mock.calls.find(function(c) { return c.name === 'setClipWarpMarkers'; });
  t('setClipWarpMarkers was called', !!setCall);
  if (setCall) {
    t('  with track=1', setCall.args.track === 1);
    t('  with clip=0', setCall.args.clip === 0);
    t('  with 3 markers', setCall.args.markers.length === 3);
  }

  // Verify the markers landed in the mock state
  var stored = ctx.mock.warpMarkers['1:0'];
  t('mock now has 3 markers stored', stored && stored.length === 3);
  if (stored && stored.length === 3) {
    t('  marker[1].beat_time === 1.0', stored[1].beat_time === 1.0);
    t('  marker[2].sample_time === 44100', stored[2].sample_time === 44100.0);
  }

  // Verify echo lock is held on the slot to prevent immediate re-emit
  var locked = ctx.ps._isLocked(ctx.ps._clipSlotKey(1, 0));
  t('clip slot is locked after apply (echo guard)', locked === true);

  // Verify _warpSnapshot was updated
  t('_warpSnapshot[1:0] is set to payload.hash', ctx.ps._warpSnapshot && ctx.ps._warpSnapshot['1:0'] === 'test-hash-1');
}

// ---------------------------------------------------------------------------
// Test 2: apply remote clip notes — extended detection
// ---------------------------------------------------------------------------

async function testApplyExtendedNotes() {
  console.log('\n══ Test 2: apply remote clip notes — extended detection ══');
  var ctx = makeParamSync();
  var now = Date.now();

  // Payload WITH extended fields → should route through addNotesExtendedToClip
  var extendedPayload = {
    track: 0,
    clip: 1,
    hash: 'h-ext',
    notes: [
      { pitch: 60, start_time: 0.0, duration: 0.25, velocity: 100, mute: false, probability: 0.75 },
      { pitch: 62, start_time: 0.25, duration: 0.25, velocity: 90, mute: true, release_velocity: 64 }
    ]
  };

  ctx.ps._applyRemoteClipNotes(extendedPayload, now);
  await sleep(50);

  var clearCall = ctx.mock.calls.find(function(c) { return c.name === 'clearClipNotes'; });
  t('clearClipNotes was called first', !!clearCall);

  var addExtended = ctx.mock.calls.find(function(c) { return c.name === 'addNotesExtendedToClip'; });
  var addBasic = ctx.mock.calls.find(function(c) { return c.name === 'addNotesToClip'; });
  t('addNotesExtendedToClip was called (extended branch)', !!addExtended);
  t('addNotesToClip was NOT called (basic branch skipped)', !addBasic);
  if (addExtended) {
    t('  notes[0].probability === 0.75', addExtended.args.notes[0].probability === 0.75);
    t('  notes[1].mute === true', addExtended.args.notes[1].mute === true);
    t('  notes[1].release_velocity === 64', addExtended.args.notes[1].release_velocity === 64);
  }
}

// ---------------------------------------------------------------------------
// Test 3: apply remote clip notes — basic (no extended fields)
// ---------------------------------------------------------------------------

async function testApplyBasicNotes() {
  console.log('\n══ Test 3: apply remote clip notes — basic branch ══');
  var ctx = makeParamSync();
  var now = Date.now();

  var basicPayload = {
    track: 2,
    clip: 0,
    hash: 'h-basic',
    notes: [
      { pitch: 60, start_time: 0.0, duration: 0.25, velocity: 100, mute: false },
      { pitch: 64, start_time: 0.5, duration: 0.25, velocity: 100, mute: false }
    ]
  };

  ctx.ps._applyRemoteClipNotes(basicPayload, now);
  await sleep(50);

  var addExtended = ctx.mock.calls.find(function(c) { return c.name === 'addNotesExtendedToClip'; });
  var addBasic = ctx.mock.calls.find(function(c) { return c.name === 'addNotesToClip'; });
  t('addNotesToClip was called (basic branch)', !!addBasic);
  t('addNotesExtendedToClip was NOT called', !addExtended);
  if (addBasic) {
    t('  notes[0].probability is undefined (basic shape)', addBasic.args.notes[0].probability === undefined);
  }
}

// ---------------------------------------------------------------------------
// Test 4: poll-side dispatch of warp markers when state changes
// ---------------------------------------------------------------------------

async function testPollWarpMarkersDispatch() {
  console.log('\n══ Test 4: poll-side warp markers dispatch on change ══');
  var ctx = makeParamSync();

  // Seed the mock with markers and prime the snapshot.
  ctx.mock.warpMarkers['3:0'] = [{ beat_time: 0.0, sample_time: 0.0 }];
  if (!ctx.ps._warpSnapshot) ctx.ps._warpSnapshot = {};
  ctx.ps._warpSnapshot['3:0'] = ctx.ps._hashWarpMarkers(ctx.mock.warpMarkers['3:0']);

  // Now mutate the markers in the mock — the next poll should detect.
  ctx.mock.warpMarkers['3:0'] = [
    { beat_time: 0.0, sample_time: 0.0 },
    { beat_time: 4.0, sample_time: 88200.0 }
  ];

  ctx.ps._pollClipWarpMarkers(3, 0);
  await sleep(50);

  var dispatched = ctx.engine.deltasOfType('warp_markers');
  t('engine received 1 warp_markers delta', dispatched.length === 1, 'got ' + dispatched.length);
  if (dispatched.length >= 1) {
    var d = dispatched[0].payload;
    t('  payload.track === 3', d.track === 3);
    t('  payload.clip === 0', d.clip === 0);
    t('  payload.markers.length === 2', d.markers.length === 2);
    t('  payload has hash', typeof d.hash === 'string' && d.hash.length > 0);
    t('  payload.warp_mode === "beats"', d.warp_mode === 'beats');
  }

  // Verify hash is stored for next change-detect cycle
  t('_warpSnapshot updated with new hash', ctx.ps._warpSnapshot['3:0'] === ctx.ps._hashWarpMarkers(ctx.mock.warpMarkers['3:0']));
}

// ---------------------------------------------------------------------------
// Test 5: all-tracks automation rotation skips focused track
// ---------------------------------------------------------------------------

async function testAutomationAllTracksRotation() {
  console.log('\n══ Test 5: automation_all_tracks rotation behavior ══');
  var ctx = makeParamSync();

  // Set up some tracks with clips and devices
  ctx.ps._trackCount = 4;
  ctx.ps._focusedTrack = 1; // rotation should SKIP this
  ctx.ps._clipListSnapshot = {
    0: [{ has_clip: true }],
    1: [{ has_clip: true }],
    2: [{ has_clip: true }],
    3: [{ has_clip: true }]
  };
  ctx.ps._deviceListSnapshot = {
    0: [{ name: 'Test Device' }],
    1: [{ name: 'Test Device' }],
    2: [{ name: 'Test Device' }],
    3: [{ name: 'Test Device' }]
  };
  ctx.ps._deviceSnapshot = {
    '0:0': { 'Volume': 0.7 },
    '1:0': { 'Volume': 0.7 },
    '2:0': { 'Volume': 0.7 },
    '3:0': { 'Volume': 0.7 }
  };

  // Tick the rotation 6 times — should visit tracks 0, 2, 3 (skipping focused 1)
  // and the rotation index should advance through all four positions.
  var visited = [];
  var origPoll = ctx.ps._pollClipAutomationBroad.bind(ctx.ps);
  ctx.ps._pollClipAutomationBroad = function(track, clip) {
    visited.push(track);
    return origPoll(track, clip);
  };

  for (var i = 0; i < 4; i++) ctx.ps._pollAutomationAllTracksTick();
  await sleep(50);

  t('rotation skipped focused track 1', visited.indexOf(1) === -1,
    'visited: ' + JSON.stringify(visited));
  t('rotation visited at least track 0', visited.indexOf(0) !== -1);
  t('rotation visited at least track 2', visited.indexOf(2) !== -1);
  t('rotation visited at least track 3', visited.indexOf(3) !== -1);
}

// ---------------------------------------------------------------------------
// Test 6: _pollClipNotes uses get_notes_extended (Phase 2C upgrade)
// ---------------------------------------------------------------------------

async function testPollClipNotesUsesExtended() {
  console.log('\n══ Test 6: _pollClipNotes calls get_notes_extended ══');
  var ctx = makeParamSync();

  // Seed mock notes — note that the extended branch attaches probability/mute
  ctx.mock.notesExtended['0:0'] = {
    notes: [
      { pitch: 60, start_time: 0, duration: 0.25, velocity: 100, mute: false, probability: 0.5 }
    ],
    extended: true
  };
  ctx.ps._noteSnapshot['0:0'] = 'old-hash';

  ctx.ps._pollClipNotes(0, 0);
  await sleep(50);

  var sendCall = ctx.mock.calls.find(function(c) { return c.name === 'send:get_notes_extended'; });
  t('mock.send("get_notes_extended", ...) was called', !!sendCall);

  var dispatched = ctx.engine.deltasOfType('clip_notes');
  t('engine received clip_notes delta', dispatched.length === 1, 'got ' + dispatched.length);
  if (dispatched.length >= 1) {
    var d = dispatched[0].payload;
    t('  payload.notes[0].probability === 0.5', d.notes[0] && d.notes[0].probability === 0.5);
    t('  payload.extended === true', d.extended === true);
  }
}

// ---------------------------------------------------------------------------
// Test 7: warp markers hash function stability
// ---------------------------------------------------------------------------

function testHashWarpMarkersStability() {
  console.log('\n══ Test 7: _hashWarpMarkers stability + change detection ══');
  var ctx = makeParamSync();

  var a = [{ beat_time: 0, sample_time: 0 }, { beat_time: 1, sample_time: 22050 }];
  var b = [{ beat_time: 0, sample_time: 0 }, { beat_time: 1, sample_time: 22050 }];
  var c = [{ beat_time: 0, sample_time: 0 }, { beat_time: 2, sample_time: 44100 }];

  t('identical marker lists hash to identical strings',
    ctx.ps._hashWarpMarkers(a) === ctx.ps._hashWarpMarkers(b));
  t('different marker lists hash differently',
    ctx.ps._hashWarpMarkers(a) !== ctx.ps._hashWarpMarkers(c));
  t('empty list hashes to empty string',
    ctx.ps._hashWarpMarkers([]) === '');
}

// ---------------------------------------------------------------------------
// Test 8: hash determinism under randomized inputs (proptest-style)
// ---------------------------------------------------------------------------
//
// Property: for any sequence of N randomized marker lists, the hash
// function MUST be:
//   1. Deterministic — same input → same hash, every time, across N
//      independent invocations
//   2. Distinguishing — different inputs → different hashes (collision
//      should be vanishingly rare for our use case)
//   3. Order-sensitive — currently the hash takes list order into
//      account; this is a known limitation that two peers receiving
//      the same markers in different order will hash differently.
//      Documented here so a future Loro-backed version can promote
//      to order-insensitive without surprise.
//
// Why this matters for the Rust workspace: when colab-core::als_differ
// hashes VST blobs and warp marker lists, the same property MUST hold
// in Rust — same bytes/structure → same BLAKE3 hash, regardless of
// invocation count or invocation order. This JS test validates the
// property at the existing JS surface so the muscle memory is in place
// when the Rust port lands.

function _seededRng(seed) {
  // Tiny LCG so this test is reproducible across runs.
  var s = seed >>> 0;
  return function() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function _randomMarkers(rng, count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push({
      beat_time: Math.floor(rng() * 1000) / 100,    // 0.00..9.99 beats
      sample_time: Math.floor(rng() * 1000000)       // 0..999999 samples
    });
  }
  return out;
}

function testHashDeterminismProperty() {
  console.log('\n══ Test 8: hash determinism property under randomized inputs ══');
  var ctx = makeParamSync();
  var rng = _seededRng(0xdeadbeef);

  var SAMPLES = 50;
  var fingerprints = [];
  var allHashes = [];

  // Generate 50 different marker lists, each with 1-12 markers
  for (var i = 0; i < SAMPLES; i++) {
    var n = 1 + Math.floor(rng() * 12);
    var markers = _randomMarkers(rng, n);
    fingerprints.push(JSON.stringify(markers));
    allHashes.push(ctx.ps._hashWarpMarkers(markers));
  }

  // Property 1: deterministic — re-hash each list and compare
  var deterministic = true;
  for (var j = 0; j < SAMPLES; j++) {
    var markers2 = JSON.parse(fingerprints[j]);
    var rehash = ctx.ps._hashWarpMarkers(markers2);
    if (rehash !== allHashes[j]) {
      deterministic = false;
      console.log('    FAIL: sample ' + j + ' hashed differently on re-run: ' +
        allHashes[j].slice(0, 16) + ' vs ' + rehash.slice(0, 16));
      break;
    }
  }
  t('Property 1: deterministic over ' + SAMPLES + ' samples (same input → same hash)', deterministic);

  // Property 2: distinguishing — count unique hashes vs unique inputs
  var uniqueInputs = new Set(fingerprints).size;
  var uniqueHashes = new Set(allHashes).size;
  t('Property 2: distinguishing — every unique input has a unique hash',
    uniqueHashes === uniqueInputs,
    'inputs=' + uniqueInputs + ' hashes=' + uniqueHashes);

  // Property 3: order-sensitive (documented current behavior). Pick a
  // marker list with 2+ entries, reverse it, hash both, assert different.
  var ordered = _randomMarkers(_seededRng(0xc0ffee), 4);
  var reversed = ordered.slice().reverse();
  var orderedHash = ctx.ps._hashWarpMarkers(ordered);
  var reversedHash = ctx.ps._hashWarpMarkers(reversed);
  t('Property 3: order-sensitive (current behavior — Loro port may promote to order-insensitive)',
    orderedHash !== reversedHash);

  console.log('    [info] sample size=' + SAMPLES + ', unique inputs=' + uniqueInputs +
    ', unique hashes=' + uniqueHashes);
}

// ---------------------------------------------------------------------------
// Test 9: warp markers apply round-trip preservation
// ---------------------------------------------------------------------------
//
// Property: for any marker list M, _applyRemoteWarpMarkers(M) → the
// mock client's stored markers contain exactly M (same data, same
// length). The Loro-backed version of this in the Rust workspace will
// have the same property because Loro container assignment is
// idempotent and content-preserving.

async function testApplyWarpMarkersRoundTrip() {
  console.log('\n══ Test 9: apply warp markers round-trip property ══');
  var rng = _seededRng(0xfeedface);
  var ROUNDS = 8;

  for (var round = 0; round < ROUNDS; round++) {
    var ctx = makeParamSync();
    var markerCount = 1 + Math.floor(rng() * 8);
    var markers = _randomMarkers(rng, markerCount);
    var payload = {
      track: round,
      clip: 0,
      markers: markers,
      warp_mode: 'beats',
      hash: 'p' + round
    };
    ctx.ps._applyRemoteWarpMarkers(payload, Date.now());
    await sleep(20);

    var stored = ctx.mock.warpMarkers[round + ':0'] || [];
    if (stored.length !== markers.length) {
      t('Round ' + round + ': mock has ' + markers.length + ' markers stored',
        false, 'got ' + stored.length);
      continue;
    }
    var allMatch = true;
    for (var k = 0; k < markers.length; k++) {
      if (stored[k].beat_time !== markers[k].beat_time ||
          stored[k].sample_time !== markers[k].sample_time) {
        allMatch = false;
        break;
      }
    }
    t('Round ' + round + ' (' + markerCount + ' markers): apply → stored data matches input', allMatch);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== ParamSync Mock-Backed Phase 2 Test ===');
  try {
    await testApplyWarpMarkers();
    await testApplyExtendedNotes();
    await testApplyBasicNotes();
    await testPollWarpMarkersDispatch();
    await testAutomationAllTracksRotation();
    await testPollClipNotesUsesExtended();
    testHashWarpMarkersStability();
    testHashDeterminismProperty();
    await testApplyWarpMarkersRoundTrip();
  } catch (e) {
    console.log('\n!! HARNESS ERROR: ' + e.message);
    console.log(e.stack);
    fail++;
  }

  setTimeout(function() {
    console.log('\n=== ' + pass + ' pass, ' + fail + ' fail ===');
    process.exit(fail === 0 ? 0 : 1);
  }, 200);
}

run();
