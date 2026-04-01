/**
 * coLaB ALS Differ — Semantic diff engine for Ableton Live Set (.als) files
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 * This software is the original intellectual property of the coLaB project.
 * No part of this software may be reproduced, distributed, or transmitted
 * in any form without the prior written permission of the copyright holder.
 *
 * This module was designed and implemented from scratch without derivation
 * from any existing tool. No existing ".als differ" existed prior to this
 * implementation — this is the first semantic diff engine for Ableton Live
 * Set files that strips non-musical noise (LomId, view state, scroll
 * positions) and produces structured, human-readable diffs keyed on
 * musical intent (tracks, clips, notes, devices, transport).
 *
 * IP Lineage: Original work. Not a fork, derivative, or port.
 * Dependencies: Node.js zlib (built-in), sax (MIT, XML parsing only)
 *
 * @module als-differ
 * @version 1.0.0
 * @license PROPRIETARY
 */

var zlib = require('zlib');
var sax = require('sax');

// --- Junk fields: change on every save, carry zero musical meaning ---
// Source: manual analysis of 125K-line .als XML (42 tracks, Live 11/12)

var JUNK_ELEMENTS = {
  // Internal IDs (5,600+ per file)
  LomId: true, LomIdView: true, NextPointeeId: true,
  OverwriteProtectionNumber: true,

  // View/UI state (changes when you scroll, select, resize)
  ViewData: true, ViewMode: true, ViewStates: true,
  ViewStateSessionMixerHeight: true, ViewStateSesstionTrackWidth: true,
  ViewStateArrangerHasDetail: true, ViewStateSessionHasDetail: true,
  ViewStateDetailIsSample: true, ViewStateFxSlotCount: true,
  ViewsToRestoreWhenUnfolding: true,
  IsContentSelectedInDocument: true, PreferredContentViewMode: true,
  HighlightedTrackIndex: true, IsHighlightedInSessionView: true,

  // Scroll/zoom positions
  ScrollerTimePreserver: true, ScrollerPos: true,
  ScrollPosition: true, SessionScrollerPos: true,
  SequencerNavigator: true,
  NoteEditorFoldInScroll: true, NoteEditorFoldInZoom: true,
  NoteEditorFoldOutScroll: true, NoteEditorFoldOutZoom: true,
  NoteEditorFoldScaleScroll: true, NoteEditorFoldScaleZoom: true,
  PitchViewScrollPosition: true,
  SampleOffsetModulationScrollPosition: true,
  TempoAutomationViewBottom: true, TempoAutomationViewTop: true,
  PadScrollPosition: true, VerticalSampleZoom: true,

  // Splitter/lane UI state
  IsContentSplitterOpen: true, IsExpressionSplitterOpen: true,
  BranchesSplitterProportion: true, LaneHeight: true,
  ClipEnvelopeChooserViewState: true,
  AutomationTransformViewState: true,

  // Header/track width
  TrackHeaderWidth: true, SessionViewBranchWidth: true,

  // Detail view junk
  DetailClipKeyMidis: true, MultiClipFocusMode: true,
  MultiClipLoopBarHeight: true,
  ArrangerShowOverView: true, SessionShowOverView: true,

  // Plugin window positions
  WinPosX: true, WinPosY: true,
  VideoWindowRect: true, ShowVideoWindow: true,

  // Playback/freeze ephemeral state
  SavedPlayingSlot: true, SavedPlayingOffset: true,
  NeedArrangerRefreeze: true, PostProcessFreezeClips: true,
  SoloActivatedInSessionMixer: true, VelocityDetail: true,

  // List wrappers (container noise, no content)
  DevicesListWrapper: true, ClipSlotsListWrapper: true,
  SendsListWrapper: true, TracksListWrapper: true,
  VisibleTracksListWrapper: true, ReturnTracksListWrapper: true,
  ScenesListWrapper: true, CuePointsListWrapper: true,
  DrumPadsListWrapper: true, VisibleDrumPadsListWrapper: true,
  ChainsListWrapper: true, ReturnChainsListWrapper: true,
  ParametersListWrapper: true, ChooserBar: true,

  // Takes (comping noise)
  TakeLanes: true, TakeCounter: true, TakeId: true,

  // Expression/content lanes UI
  ExpressionLanes: true, ContentLanes: true,

  // MIDI fold UI
  MidiFoldIn: true, MidiFoldMode: true,

  // Auto color picker (UI preference)
  AutoColorPickerForPlayerAndGroupTracks: true,
  AutoColorPickerForReturnAndMasterTracks: true,
  AutoColorScheme: true, ColorSequenceIndex: true,

  // Clip editor selection state
  TimeSelection: true,

  // Freeze sequencer (computed data)
  FreezeSequencer: true, FreezeStart: true, FreezeEnd: true,

  // Simpler/sampler UI
  SimplerBreakoutVisible: true, ZoneEditorVisible: true
};

// --- Track types we care about ---
var TRACK_TYPES = {
  MidiTrack: true, AudioTrack: true,
  GroupTrack: true, ReturnTrack: true
};

// --- Main API ---

function AlsDiffer() {}

// Diff two .als files. Accepts file paths or Buffers.
// Returns structured JSON diff.
AlsDiffer.prototype.diff = function(fileA, fileB, callback) {
  var self = this;

  this._loadAndParse(fileA, function(errA, treeA) {
    if (errA) return callback(errA);

    self._loadAndParse(fileB, function(errB, treeB) {
      if (errB) return callback(errB);

      var result = self._diffTrees(treeA, treeB);
      callback(null, result);
    });
  });
};

// Synchronous version for small files / Node context
AlsDiffer.prototype.diffSync = function(bufferA, bufferB) {
  var treeA = this._parseSync(this._decompress(bufferA));
  var treeB = this._parseSync(this._decompress(bufferB));
  return this._diffTrees(treeA, treeB);
};

// Parse a single .als file into a normalized tree (for caching/comparison)
AlsDiffer.prototype.parseSync = function(buffer) {
  return this._parseSync(this._decompress(buffer));
};

// --- Decompression ---

AlsDiffer.prototype._decompress = function(input) {
  // Handle Buffer, string path, or already-decompressed XML string
  if (typeof input === 'string') {
    if (input.trimStart().startsWith('<?') || input.trimStart().startsWith('<Ableton')) {
      return input; // already XML
    }
    // Assume file path
    var fs = require('fs');
    input = fs.readFileSync(input);
  }

  // Check gzip magic bytes
  if (input[0] === 0x1f && input[1] === 0x8b) {
    return zlib.gunzipSync(input).toString('utf8');
  }

  return input.toString('utf8');
};

AlsDiffer.prototype._loadAndParse = function(input, callback) {
  try {
    var xml = this._decompress(input);
    var tree = this._parseSync(xml);
    callback(null, tree);
  } catch (e) {
    callback(e);
  }
};

// --- SAX Parser → Normalized Tree ---
// Strips junk during parse, captures attributes + text values

AlsDiffer.prototype._parseSync = function(xml) {
  var parser = sax.parser(true, { trim: true }); // strict mode
  var root = null;
  var stack = [];
  var current = null;
  var skipDepth = 0; // when > 0, we're inside a junk subtree

  parser.onopentag = function(node) {
    if (skipDepth > 0) {
      skipDepth++;
      return;
    }

    if (JUNK_ELEMENTS[node.name]) {
      skipDepth = 1;
      return;
    }

    var elem = {
      tag: node.name,
      attrs: {},
      children: [],
      text: '',
      _childMap: {} // tag → [elements] for fast lookup
    };

    // Copy meaningful attributes
    for (var key in node.attributes) {
      elem.attrs[key] = node.attributes[key];
    }

    if (current) {
      current.children.push(elem);
      if (!current._childMap[node.name]) {
        current._childMap[node.name] = [];
      }
      current._childMap[node.name].push(elem);
    }

    stack.push(elem);
    current = elem;

    if (!root) root = elem;
  };

  parser.onclosetag = function(tagName) {
    if (skipDepth > 0) {
      skipDepth--;
      return;
    }
    stack.pop();
    current = stack[stack.length - 1] || null;
  };

  parser.ontext = function(text) {
    if (skipDepth > 0) return;
    if (current && text.trim()) {
      current.text += text.trim();
    }
  };

  parser.oncdata = function(cdata) {
    if (skipDepth > 0) return;
    if (current) {
      current.text += cdata;
    }
  };

  parser.onerror = function(err) {
    // SAX recovers automatically, but log it
    parser.resume();
  };

  parser.write(xml).close();

  // Extract metadata
  var meta = {};
  if (root) {
    meta.creator = root.attrs.Creator || '';
    meta.majorVersion = root.attrs.MajorVersion || '';
    meta.minorVersion = root.attrs.MinorVersion || '';
    meta.revision = root.attrs.Revision || '';
  }

  return { root: root, meta: meta };
};

// --- Tree Diffing ---

AlsDiffer.prototype._diffTrees = function(treeA, treeB) {
  var changes = [];
  var summary = {
    tracksAdded: 0, tracksRemoved: 0, tracksModified: 0,
    devicesAdded: 0, devicesRemoved: 0,
    clipsAdded: 0, clipsRemoved: 0, clipsModified: 0,
    notesAdded: 0, notesRemoved: 0, notesModified: 0,
    automationChanged: 0,
    transportChanged: false,
    scenesChanged: false
  };

  if (!treeA.root || !treeB.root) {
    return { meta: { a: treeA.meta, b: treeB.meta }, changes: changes, summary: summary };
  }

  var liveSetA = this._findChild(treeA.root, 'LiveSet');
  var liveSetB = this._findChild(treeB.root, 'LiveSet');

  if (!liveSetA || !liveSetB) {
    return { meta: { a: treeA.meta, b: treeB.meta }, changes: changes, summary: summary };
  }

  // Diff tracks
  this._diffTracks(liveSetA, liveSetB, changes, summary);

  // Diff transport
  this._diffTransport(liveSetA, liveSetB, changes, summary);

  // Diff scenes
  this._diffScenes(liveSetA, liveSetB, changes, summary);

  // Diff master track
  this._diffMasterTrack(liveSetA, liveSetB, changes, summary);

  // Diff locators
  this._diffLocators(liveSetA, liveSetB, changes, summary);

  return {
    meta: { a: treeA.meta, b: treeB.meta },
    changes: changes,
    summary: summary
  };
};

// --- Track Diffing ---

AlsDiffer.prototype._diffTracks = function(liveSetA, liveSetB, changes, summary) {
  var tracksA = this._findChild(liveSetA, 'Tracks');
  var tracksB = this._findChild(liveSetB, 'Tracks');
  if (!tracksA || !tracksB) return;

  // Build ID maps for each track type
  var mapA = this._buildIdMap(tracksA, TRACK_TYPES);
  var mapB = this._buildIdMap(tracksB, TRACK_TYPES);

  // Find added tracks
  for (var id in mapB) {
    if (!mapA[id]) {
      var track = mapB[id];
      var name = this._getTrackName(track);
      changes.push({
        type: 'added',
        category: 'track',
        path: 'Tracks/' + track.tag + '[@Id=' + id + ']',
        summary: 'New ' + track.tag + " '" + name + "'",
        detail: this._summarizeTrack(track)
      });
      summary.tracksAdded++;
    }
  }

  // Find removed tracks
  for (var id in mapA) {
    if (!mapB[id]) {
      var track = mapA[id];
      var name = this._getTrackName(track);
      changes.push({
        type: 'deleted',
        category: 'track',
        path: 'Tracks/' + track.tag + '[@Id=' + id + ']',
        summary: 'Removed ' + track.tag + " '" + name + "'"
      });
      summary.tracksRemoved++;
    }
  }

  // Diff modified tracks
  for (var id in mapA) {
    if (mapB[id]) {
      var trackChanges = this._diffTrack(mapA[id], mapB[id], id);
      if (trackChanges.length > 0) {
        summary.tracksModified++;
        for (var i = 0; i < trackChanges.length; i++) {
          changes.push(trackChanges[i]);

          // Update summary counters
          var cat = trackChanges[i].category;
          if (cat === 'device_added') summary.devicesAdded++;
          else if (cat === 'device_removed') summary.devicesRemoved++;
          else if (cat === 'clip_added') summary.clipsAdded++;
          else if (cat === 'clip_removed') summary.clipsRemoved++;
          else if (cat === 'clip') summary.clipsModified++;
          else if (cat === 'note_added') summary.notesAdded++;
          else if (cat === 'note_removed') summary.notesRemoved++;
          else if (cat === 'note') summary.notesModified++;
          else if (cat === 'automation') summary.automationChanged++;
        }
      }
    }
  }
};

AlsDiffer.prototype._diffTrack = function(trackA, trackB, trackId) {
  var changes = [];
  var basePath = 'Tracks/' + trackA.tag + '[@Id=' + trackId + ']';

  // Track name
  var nameA = this._getTrackName(trackA);
  var nameB = this._getTrackName(trackB);
  if (nameA !== nameB) {
    changes.push({
      type: 'modified', category: 'track',
      path: basePath + '/Name',
      from: nameA, to: nameB
    });
  }

  // Color
  var colorA = this._getChildValue(trackA, 'Color');
  var colorB = this._getChildValue(trackB, 'Color');
  if (colorA !== colorB) {
    changes.push({
      type: 'modified', category: 'track',
      path: basePath + '/Color',
      from: colorA, to: colorB
    });
  }

  // Track delay
  this._diffChildValue(trackA, trackB, 'TrackDelay', basePath, 'track', changes);

  // Device chain
  var chainA = this._findChild(trackA, 'DeviceChain');
  var chainB = this._findChild(trackB, 'DeviceChain');
  if (chainA && chainB) {
    // Mixer
    this._diffMixer(chainA, chainB, basePath, changes);

    // Routing
    this._diffRouting(chainA, chainB, basePath, changes);

    // Devices
    this._diffDevices(chainA, chainB, basePath, changes);

    // Clips (in MainSequencer)
    this._diffClips(chainA, chainB, basePath, changes);
  }

  return changes;
};

// --- Mixer Diffing ---

AlsDiffer.prototype._diffMixer = function(chainA, chainB, basePath, changes) {
  var mixerA = this._findChild(chainA, 'Mixer');
  var mixerB = this._findChild(chainB, 'Mixer');
  if (!mixerA || !mixerB) return;

  var mixPath = basePath + '/Mixer';
  var params = ['Volume', 'Pan', 'Speaker', 'CrossFadeState', 'PanMode'];

  for (var i = 0; i < params.length; i++) {
    var paramName = params[i];
    var valA = this._getManualValue(mixerA, paramName);
    var valB = this._getManualValue(mixerB, paramName);
    if (valA !== valB) {
      changes.push({
        type: 'modified', category: 'mixer',
        path: mixPath + '/' + paramName,
        from: valA, to: valB
      });
    }
  }

  // Sends
  this._diffSends(mixerA, mixerB, mixPath, changes);
};

AlsDiffer.prototype._diffSends = function(mixerA, mixerB, mixPath, changes) {
  var sendsA = this._findChild(mixerA, 'Sends');
  var sendsB = this._findChild(mixerB, 'Sends');
  if (!sendsA || !sendsB) return;

  var holdersA = this._getChildrenByTag(sendsA, 'TrackSendHolder');
  var holdersB = this._getChildrenByTag(sendsB, 'TrackSendHolder');

  var mapA = {};
  for (var i = 0; i < holdersA.length; i++) {
    mapA[holdersA[i].attrs.Id || i] = holdersA[i];
  }

  for (var j = 0; j < holdersB.length; j++) {
    var id = holdersB[j].attrs.Id || j;
    var holderA = mapA[id];
    if (!holderA) continue;

    var sendValA = this._getManualValue(holderA, 'Send');
    var sendValB = this._getManualValue(holdersB[j], 'Send');
    if (sendValA !== sendValB) {
      changes.push({
        type: 'modified', category: 'send',
        path: mixPath + '/Sends/TrackSendHolder[@Id=' + id + ']',
        from: sendValA, to: sendValB
      });
    }

    var activeA = this._getChildAttrValue(holderA, 'Active', 'Value');
    var activeB = this._getChildAttrValue(holdersB[j], 'Active', 'Value');
    if (activeA !== activeB) {
      changes.push({
        type: 'modified', category: 'send',
        path: mixPath + '/Sends/TrackSendHolder[@Id=' + id + ']/Active',
        from: activeA, to: activeB
      });
    }
  }
};

// --- Routing Diffing ---

AlsDiffer.prototype._diffRouting = function(chainA, chainB, basePath, changes) {
  var routings = ['AudioInputRouting', 'MidiInputRouting', 'AudioOutputRouting', 'MidiOutputRouting'];
  for (var i = 0; i < routings.length; i++) {
    var routeA = this._findChild(chainA, routings[i]);
    var routeB = this._findChild(chainB, routings[i]);
    if (!routeA || !routeB) continue;

    var targetA = this._getChildValue(routeA, 'Target');
    var targetB = this._getChildValue(routeB, 'Target');
    if (targetA !== targetB) {
      changes.push({
        type: 'modified', category: 'routing',
        path: basePath + '/' + routings[i],
        from: targetA, to: targetB
      });
    }
  }
};

// --- Device Diffing ---

AlsDiffer.prototype._diffDevices = function(chainA, chainB, basePath, changes) {
  // Devices can be nested: DeviceChain > Devices or DeviceChain > DeviceChain > Devices
  var devicesA = this._findDevices(chainA);
  var devicesB = this._findDevices(chainB);

  var mapA = {};
  for (var i = 0; i < devicesA.length; i++) {
    var id = devicesA[i].attrs.Id || ('idx-' + i);
    mapA[id] = devicesA[i];
  }

  var mapB = {};
  for (var j = 0; j < devicesB.length; j++) {
    var id = devicesB[j].attrs.Id || ('idx-' + j);
    mapB[id] = devicesB[j];
  }

  // Added devices
  for (var id in mapB) {
    if (!mapA[id]) {
      var dev = mapB[id];
      var devName = this._getDeviceName(dev);
      changes.push({
        type: 'added', category: 'device_added',
        path: basePath + '/Devices/' + dev.tag + '[@Id=' + id + ']',
        summary: 'Added device ' + dev.tag + " '" + devName + "'"
      });
    }
  }

  // Removed devices
  for (var id in mapA) {
    if (!mapB[id]) {
      var dev = mapA[id];
      var devName = this._getDeviceName(dev);
      changes.push({
        type: 'deleted', category: 'device_removed',
        path: basePath + '/Devices/' + dev.tag + '[@Id=' + id + ']',
        summary: 'Removed device ' + dev.tag + " '" + devName + "'"
      });
    }
  }

  // Modified devices — compare bypass state and name
  for (var id in mapA) {
    if (!mapB[id]) continue;
    var devA = mapA[id];
    var devB = mapB[id];

    var onA = this._getManualValue(devA, 'On');
    var onB = this._getManualValue(devB, 'On');
    if (onA !== onB) {
      changes.push({
        type: 'modified', category: 'device',
        path: basePath + '/Devices/' + devA.tag + '[@Id=' + id + ']/On',
        from: onA, to: onB,
        summary: (onB === 'true' || onB === '1') ? 'Enabled' : 'Bypassed'
      });
    }
  }
};

// --- Clip Diffing ---

AlsDiffer.prototype._diffClips = function(chainA, chainB, basePath, changes) {
  var seqA = this._findChild(chainA, 'MainSequencer');
  var seqB = this._findChild(chainB, 'MainSequencer');
  if (!seqA || !seqB) return;

  // Arrangement clips (in ClipTimeable > ArrangerAutomation > Events)
  var arrClipsA = this._findArrangementClips(seqA);
  var arrClipsB = this._findArrangementClips(seqB);
  this._diffClipSets(arrClipsA, arrClipsB, basePath + '/Arrangement', changes);

  // Session clips (in ClipSlotList > ClipSlot)
  var sessClipsA = this._findSessionClips(seqA);
  var sessClipsB = this._findSessionClips(seqB);
  this._diffClipSets(sessClipsA, sessClipsB, basePath + '/Session', changes);
};

AlsDiffer.prototype._diffClipSets = function(clipsA, clipsB, basePath, changes) {
  var mapA = {};
  for (var i = 0; i < clipsA.length; i++) {
    var id = clipsA[i].attrs.Id || ('idx-' + i);
    mapA[id] = clipsA[i];
  }

  var mapB = {};
  for (var j = 0; j < clipsB.length; j++) {
    var id = clipsB[j].attrs.Id || ('idx-' + j);
    mapB[id] = clipsB[j];
  }

  // Added clips
  for (var id in mapB) {
    if (!mapA[id]) {
      var clip = mapB[id];
      var clipName = this._getClipName(clip);
      changes.push({
        type: 'added', category: 'clip_added',
        path: basePath + '/' + clip.tag + '[@Id=' + id + ']',
        summary: 'Added clip ' + "'" + clipName + "'"
      });
    }
  }

  // Removed clips
  for (var id in mapA) {
    if (!mapB[id]) {
      var clip = mapA[id];
      var clipName = this._getClipName(clip);
      changes.push({
        type: 'deleted', category: 'clip_removed',
        path: basePath + '/' + clip.tag + '[@Id=' + id + ']',
        summary: 'Removed clip ' + "'" + clipName + "'"
      });
    }
  }

  // Modified clips
  for (var id in mapA) {
    if (!mapB[id]) continue;
    this._diffClip(mapA[id], mapB[id], basePath + '/' + mapA[id].tag + '[@Id=' + id + ']', changes);
  }
};

AlsDiffer.prototype._diffClip = function(clipA, clipB, clipPath, changes) {
  // Name
  var nameA = this._getClipName(clipA);
  var nameB = this._getClipName(clipB);
  if (nameA !== nameB) {
    changes.push({
      type: 'modified', category: 'clip',
      path: clipPath + '/Name', from: nameA, to: nameB
    });
  }

  // Loop settings
  var loopFields = ['LoopStart', 'LoopEnd', 'LoopOn', 'OutMarker', 'CurrentStart', 'CurrentEnd'];
  for (var i = 0; i < loopFields.length; i++) {
    this._diffChildValue(clipA, clipB, loopFields[i], clipPath, 'clip', changes);
  }

  // For MIDI clips: diff notes
  if (clipA.tag === 'MidiClip') {
    this._diffMidiNotes(clipA, clipB, clipPath, changes);
  }

  // For audio clips: diff sample reference and warp markers
  if (clipA.tag === 'AudioClip') {
    this._diffSampleRef(clipA, clipB, clipPath, changes);
    this._diffWarpMarkers(clipA, clipB, clipPath, changes);
  }
};

// --- MIDI Note Diffing ---

AlsDiffer.prototype._diffMidiNotes = function(clipA, clipB, clipPath, changes) {
  var notesA = this._extractNotes(clipA);
  var notesB = this._extractNotes(clipB);

  // Build maps by NoteId (stable) or by composite key (pitch+time)
  var mapA = {};
  for (var i = 0; i < notesA.length; i++) {
    var key = notesA[i].noteId || (notesA[i].pitch + '@' + notesA[i].time);
    mapA[key] = notesA[i];
  }

  var mapB = {};
  for (var j = 0; j < notesB.length; j++) {
    var key = notesB[j].noteId || (notesB[j].pitch + '@' + notesB[j].time);
    mapB[key] = notesB[j];
  }

  // Added notes
  for (var key in mapB) {
    if (!mapA[key]) {
      var n = mapB[key];
      changes.push({
        type: 'added', category: 'note_added',
        path: clipPath + '/Note',
        summary: 'Note ' + this._midiToName(n.pitch) + ' at beat ' + n.time + ' vel=' + n.velocity
      });
    }
  }

  // Removed notes
  for (var key in mapA) {
    if (!mapB[key]) {
      var n = mapA[key];
      changes.push({
        type: 'deleted', category: 'note_removed',
        path: clipPath + '/Note',
        summary: 'Note ' + this._midiToName(n.pitch) + ' at beat ' + n.time
      });
    }
  }

  // Modified notes (velocity, duration, probability changes)
  for (var key in mapA) {
    if (!mapB[key]) continue;
    var nA = mapA[key];
    var nB = mapB[key];

    if (nA.velocity !== nB.velocity || nA.duration !== nB.duration || nA.probability !== nB.probability) {
      var mods = [];
      if (nA.velocity !== nB.velocity) mods.push('vel ' + nA.velocity + '→' + nB.velocity);
      if (nA.duration !== nB.duration) mods.push('dur ' + nA.duration + '→' + nB.duration);
      if (nA.probability !== nB.probability) mods.push('prob ' + nA.probability + '→' + nB.probability);

      changes.push({
        type: 'modified', category: 'note',
        path: clipPath + '/Note/' + this._midiToName(nA.pitch) + '@' + nA.time,
        summary: mods.join(', ')
      });
    }
  }
};

AlsDiffer.prototype._extractNotes = function(clip) {
  var notes = [];
  var notesElem = this._findChild(clip, 'Notes');
  if (!notesElem) return notes;

  var keyTracks = this._getChildrenByTag(notesElem, 'KeyTrack');
  for (var kt = 0; kt < keyTracks.length; kt++) {
    var midiKey = this._findChild(keyTracks[kt], 'MidiKey');
    var pitch = midiKey ? (midiKey.attrs.Value || midiKey.text) : '?';

    var notesContainer = this._findChild(keyTracks[kt], 'Notes');
    if (!notesContainer) continue;

    var events = this._getChildrenByTag(notesContainer, 'MidiNoteEvent');
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      notes.push({
        pitch: pitch,
        time: ev.attrs.Time || '0',
        duration: ev.attrs.Duration || '0',
        velocity: ev.attrs.Velocity || '100',
        probability: ev.attrs.Probability || '1',
        noteId: ev.attrs.NoteId || null,
        isEnabled: ev.attrs.IsEnabled || 'true'
      });
    }
  }

  return notes;
};

// --- Audio Clip Diffing ---

AlsDiffer.prototype._diffSampleRef = function(clipA, clipB, clipPath, changes) {
  var refA = this._findDeep(clipA, 'SampleRef');
  var refB = this._findDeep(clipB, 'SampleRef');
  if (!refA || !refB) return;

  var fileRefA = this._findChild(refA, 'FileRef');
  var fileRefB = this._findChild(refB, 'FileRef');
  if (!fileRefA || !fileRefB) return;

  var pathA = this._getChildValue(fileRefA, 'RelativePath') || this._getChildValue(fileRefA, 'Path');
  var pathB = this._getChildValue(fileRefB, 'RelativePath') || this._getChildValue(fileRefB, 'Path');

  if (pathA !== pathB) {
    changes.push({
      type: 'modified', category: 'sample',
      path: clipPath + '/SampleRef',
      from: pathA, to: pathB
    });
  }
};

AlsDiffer.prototype._diffWarpMarkers = function(clipA, clipB, clipPath, changes) {
  var markersA = this._findWarpMarkers(clipA);
  var markersB = this._findWarpMarkers(clipB);

  if (markersA.length !== markersB.length) {
    changes.push({
      type: 'modified', category: 'warp',
      path: clipPath + '/WarpMarkers',
      summary: 'Warp markers changed (' + markersA.length + ' → ' + markersB.length + ')'
    });
    return;
  }

  for (var i = 0; i < markersA.length; i++) {
    if (markersA[i].secTime !== markersB[i].secTime || markersA[i].beatTime !== markersB[i].beatTime) {
      changes.push({
        type: 'modified', category: 'warp',
        path: clipPath + '/WarpMarkers[' + i + ']',
        summary: 'Warp marker moved'
      });
      break; // one diff is enough to flag it
    }
  }
};

AlsDiffer.prototype._findWarpMarkers = function(clip) {
  var markers = [];
  var wm = this._findDeep(clip, 'WarpMarkers');
  if (!wm) return markers;

  var children = this._getChildrenByTag(wm, 'WarpMarker');
  for (var i = 0; i < children.length; i++) {
    markers.push({
      secTime: children[i].attrs.SecTime || '0',
      beatTime: children[i].attrs.BeatTime || '0'
    });
  }
  return markers;
};

// --- Transport Diffing ---

AlsDiffer.prototype._diffTransport = function(liveSetA, liveSetB, changes, summary) {
  var transportA = this._findChild(liveSetA, 'Transport');
  var transportB = this._findChild(liveSetB, 'Transport');
  if (!transportA || !transportB) return;

  var fields = ['PhaseNudgeTempo', 'LoopStart', 'LoopLength', 'LoopOn',
                'PunchIn', 'PunchOut', 'MetronomeOn', 'PreCount', 'RecordQuantization'];

  for (var i = 0; i < fields.length; i++) {
    var valA = this._getManualOrChildValue(transportA, fields[i]);
    var valB = this._getManualOrChildValue(transportB, fields[i]);
    if (valA !== valB) {
      var label = fields[i] === 'PhaseNudgeTempo' ? 'BPM' : fields[i];
      changes.push({
        type: 'modified', category: 'transport',
        path: 'Transport/' + fields[i],
        from: valA, to: valB,
        summary: label + ': ' + valA + ' → ' + valB
      });
      summary.transportChanged = true;
    }
  }
};

// --- Scene Diffing ---

AlsDiffer.prototype._diffScenes = function(liveSetA, liveSetB, changes, summary) {
  var scenesA = this._findChild(liveSetA, 'Scenes');
  var scenesB = this._findChild(liveSetB, 'Scenes');
  if (!scenesA || !scenesB) return;

  var listA = this._getChildrenByTag(scenesA, 'Scene');
  var listB = this._getChildrenByTag(scenesB, 'Scene');

  var mapA = {};
  for (var i = 0; i < listA.length; i++) {
    mapA[listA[i].attrs.Id || i] = listA[i];
  }

  for (var j = 0; j < listB.length; j++) {
    var id = listB[j].attrs.Id || j;
    var sceneA = mapA[id];
    if (!sceneA) {
      changes.push({
        type: 'added', category: 'scene',
        path: 'Scenes/Scene[@Id=' + id + ']',
        summary: 'Added scene'
      });
      summary.scenesChanged = true;
      continue;
    }

    var nameA = this._getChildAttrValue(sceneA, 'Name', 'Value');
    var nameB = this._getChildAttrValue(listB[j], 'Name', 'Value');
    if (nameA !== nameB) {
      changes.push({
        type: 'modified', category: 'scene',
        path: 'Scenes/Scene[@Id=' + id + ']/Name',
        from: nameA, to: nameB
      });
      summary.scenesChanged = true;
    }
  }
};

// --- Master Track ---

AlsDiffer.prototype._diffMasterTrack = function(liveSetA, liveSetB, changes, summary) {
  var masterA = this._findChild(liveSetA, 'MasterTrack');
  var masterB = this._findChild(liveSetB, 'MasterTrack');
  if (!masterA || !masterB) return;

  var chainA = this._findChild(masterA, 'DeviceChain');
  var chainB = this._findChild(masterB, 'DeviceChain');
  if (chainA && chainB) {
    this._diffMixer(chainA, chainB, 'MasterTrack', changes);
    this._diffDevices(chainA, chainB, 'MasterTrack', changes);
  }
};

// --- Locators ---

AlsDiffer.prototype._diffLocators = function(liveSetA, liveSetB, changes, summary) {
  var locsA = this._findChild(liveSetA, 'Locators');
  var locsB = this._findChild(liveSetB, 'Locators');
  if (!locsA || !locsB) return;

  var listA = this._getChildrenByTag(locsA, 'Locator');
  var listB = this._getChildrenByTag(locsB, 'Locator');

  if (listA.length !== listB.length) {
    changes.push({
      type: 'modified', category: 'locator',
      path: 'Locators',
      summary: 'Locators changed (' + listA.length + ' → ' + listB.length + ')'
    });
  }
};

// --- Helpers ---

AlsDiffer.prototype._findChild = function(elem, tag) {
  if (!elem || !elem._childMap) return null;
  var arr = elem._childMap[tag];
  return arr ? arr[0] : null;
};

AlsDiffer.prototype._findDeep = function(elem, tag) {
  if (!elem) return null;
  if (elem.tag === tag) return elem;
  for (var i = 0; i < elem.children.length; i++) {
    var found = this._findDeep(elem.children[i], tag);
    if (found) return found;
  }
  return null;
};

AlsDiffer.prototype._getChildrenByTag = function(elem, tag) {
  if (!elem || !elem._childMap) return [];
  return elem._childMap[tag] || [];
};

AlsDiffer.prototype._buildIdMap = function(container, validTags) {
  var map = {};
  for (var i = 0; i < container.children.length; i++) {
    var child = container.children[i];
    if (validTags[child.tag]) {
      var id = child.attrs.Id || ('idx-' + i);
      map[id] = child;
    }
  }
  return map;
};

AlsDiffer.prototype._getChildValue = function(elem, tag) {
  var child = this._findChild(elem, tag);
  if (!child) return null;
  return child.attrs.Value || child.text || null;
};

AlsDiffer.prototype._getChildAttrValue = function(elem, tag, attr) {
  var child = this._findChild(elem, tag);
  if (!child) return null;
  return child.attrs[attr] || child.text || null;
};

AlsDiffer.prototype._getManualValue = function(elem, paramTag) {
  var param = this._findChild(elem, paramTag);
  if (!param) return null;
  var manual = this._findChild(param, 'Manual');
  if (!manual) return param.attrs.Value || param.text || null;
  return manual.attrs.Value || manual.text || null;
};

AlsDiffer.prototype._getManualOrChildValue = function(elem, tag) {
  var child = this._findChild(elem, tag);
  if (!child) return null;
  var manual = this._findChild(child, 'Manual');
  if (manual) return manual.attrs.Value || manual.text || null;
  return child.attrs.Value || child.text || null;
};

AlsDiffer.prototype._diffChildValue = function(elemA, elemB, tag, basePath, category, changes) {
  var valA = this._getChildValue(elemA, tag);
  var valB = this._getChildValue(elemB, tag);
  if (valA !== valB && (valA !== null || valB !== null)) {
    changes.push({
      type: 'modified', category: category,
      path: basePath + '/' + tag,
      from: valA, to: valB
    });
  }
};

AlsDiffer.prototype._getTrackName = function(track) {
  var name = this._findChild(track, 'Name');
  if (!name) return 'Untitled';
  var effective = this._findChild(name, 'EffectiveName');
  if (effective) return effective.attrs.Value || effective.text || 'Untitled';
  var user = this._findChild(name, 'UserName');
  if (user) return user.attrs.Value || user.text || 'Untitled';
  return name.attrs.Value || name.text || 'Untitled';
};

AlsDiffer.prototype._getDeviceName = function(device) {
  var name = this._findChild(device, 'UserName');
  if (name) return name.attrs.Value || name.text || device.tag;
  return device.tag;
};

AlsDiffer.prototype._getClipName = function(clip) {
  var name = this._findChild(clip, 'Name');
  if (!name) return 'Clip';
  return name.attrs.Value || name.text || 'Clip';
};

AlsDiffer.prototype._findDevices = function(chain) {
  // Walk: DeviceChain > Devices > * or DeviceChain > DeviceChain > Devices > *
  var devices = [];

  var devicesElem = this._findChild(chain, 'Devices');
  if (devicesElem) {
    for (var i = 0; i < devicesElem.children.length; i++) {
      devices.push(devicesElem.children[i]);
    }
    return devices;
  }

  // Nested DeviceChain
  var innerChain = this._findChild(chain, 'DeviceChain');
  if (innerChain) {
    devicesElem = this._findChild(innerChain, 'Devices');
    if (devicesElem) {
      for (var j = 0; j < devicesElem.children.length; j++) {
        devices.push(devicesElem.children[j]);
      }
    }
  }

  return devices;
};

AlsDiffer.prototype._findArrangementClips = function(sequencer) {
  var timeable = this._findChild(sequencer, 'ClipTimeable');
  if (!timeable) return [];
  var arrAuto = this._findChild(timeable, 'ArrangerAutomation');
  if (!arrAuto) return [];
  var events = this._findChild(arrAuto, 'Events');
  if (!events) return [];
  return events.children;
};

AlsDiffer.prototype._findSessionClips = function(sequencer) {
  var clipSlotList = this._findChild(sequencer, 'ClipSlotList');
  if (!clipSlotList) return [];

  var clips = [];
  var slots = this._getChildrenByTag(clipSlotList, 'ClipSlot');
  for (var i = 0; i < slots.length; i++) {
    // Each ClipSlot may contain a MidiClip or AudioClip
    for (var j = 0; j < slots[i].children.length; j++) {
      var child = slots[i].children[j];
      if (child.tag === 'MidiClip' || child.tag === 'AudioClip') {
        clips.push(child);
      }
    }
  }
  return clips;
};

AlsDiffer.prototype._summarizeTrack = function(track) {
  var devices = this._findDevices(this._findChild(track, 'DeviceChain') || track);
  var deviceNames = [];
  for (var i = 0; i < devices.length; i++) {
    deviceNames.push(this._getDeviceName(devices[i]));
  }
  return {
    name: this._getTrackName(track),
    type: track.tag,
    devices: deviceNames
  };
};

var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

AlsDiffer.prototype._midiToName = function(midi) {
  var num = parseInt(midi);
  if (isNaN(num)) return midi;
  var octave = Math.floor(num / 12) - 2;
  return NOTE_NAMES[num % 12] + octave;
};

// --- Format Output ---

AlsDiffer.prototype.formatText = function(diffResult) {
  var lines = [];
  var s = diffResult.summary;

  lines.push('=== ALS Diff ===');
  if (diffResult.meta.a.creator || diffResult.meta.b.creator) {
    lines.push('A: ' + (diffResult.meta.a.creator || 'unknown'));
    lines.push('B: ' + (diffResult.meta.b.creator || 'unknown'));
  }
  lines.push('');

  if (s.tracksAdded) lines.push('+ ' + s.tracksAdded + ' track(s) added');
  if (s.tracksRemoved) lines.push('- ' + s.tracksRemoved + ' track(s) removed');
  if (s.tracksModified) lines.push('~ ' + s.tracksModified + ' track(s) modified');
  if (s.devicesAdded) lines.push('+ ' + s.devicesAdded + ' device(s) added');
  if (s.devicesRemoved) lines.push('- ' + s.devicesRemoved + ' device(s) removed');
  if (s.clipsAdded) lines.push('+ ' + s.clipsAdded + ' clip(s) added');
  if (s.clipsRemoved) lines.push('- ' + s.clipsRemoved + ' clip(s) removed');
  if (s.clipsModified) lines.push('~ ' + s.clipsModified + ' clip(s) modified');
  if (s.notesAdded) lines.push('+ ' + s.notesAdded + ' note(s) added');
  if (s.notesRemoved) lines.push('- ' + s.notesRemoved + ' note(s) removed');
  if (s.notesModified) lines.push('~ ' + s.notesModified + ' note(s) modified');
  if (s.transportChanged) lines.push('~ Transport changed');
  if (s.scenesChanged) lines.push('~ Scenes changed');

  lines.push('');
  lines.push('--- Changes ---');

  for (var i = 0; i < diffResult.changes.length; i++) {
    var c = diffResult.changes[i];
    var prefix = c.type === 'added' ? '+' : c.type === 'deleted' ? '-' : '~';
    var line = prefix + ' ' + c.path;
    if (c.summary) line += ' — ' + c.summary;
    else if (c.from !== undefined && c.to !== undefined) line += ': ' + c.from + ' → ' + c.to;
    lines.push(line);
  }

  if (diffResult.changes.length === 0) {
    lines.push('  (no semantic changes)');
  }

  return lines.join('\n');
};

if (typeof module !== 'undefined') {
  module.exports = AlsDiffer;
}
