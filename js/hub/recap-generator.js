// coLaB Recap Generator
// Summarizes activity log entries into human-readable session recap

function RecapGenerator() {}

RecapGenerator.prototype.generate = function(entries, partnerName) {
  if (!entries || entries.length === 0) {
    return { text: 'No changes while you were away.', sections: [], summary: null };
  }

  partnerName = partnerName || 'Partner';

  // Filter to partner actions only (skip local and system session events)
  var changes = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.actor === 'partner' || (e.actor === 'system' && e.type === 'session')) {
      changes.push(e);
    }
  }

  if (changes.length === 0) {
    return { text: 'No partner changes while you were away.', sections: [], summary: null };
  }

  // Compute time range
  var firstTs = changes[0].ts;
  var lastTs = changes[changes.length - 1].ts;
  var durationMs = lastTs - firstTs;
  var durationMin = Math.max(1, Math.round(durationMs / 60000));
  var timeRange = this._formatTime(firstTs) + ' - ' + this._formatTime(lastTs);

  // Group by category
  var trackAdds = [];
  var trackRemoves = [];
  var paramChanges = {};  // trackId → { param: { old, new } }
  var clipAdds = [];
  var clipRemoves = [];
  var noteChanges = [];
  var transportChanges = {};

  for (var j = 0; j < changes.length; j++) {
    var c = changes[j];
    var d = c.data;

    switch (c.type) {
      case 'track_add':
        trackAdds.push(d.name);
        break;
      case 'track_remove':
        trackRemoves.push(d.name);
        break;
      case 'track_param':
        if (!paramChanges[d.trackId]) paramChanges[d.trackId] = {};
        paramChanges[d.trackId][d.param] = { old: d.oldValue, new: d.newValue, trackId: d.trackId };
        break;
      case 'clip_add':
        clipAdds.push({ trackId: d.trackId, slot: d.slot, name: d.name });
        break;
      case 'clip_remove':
        clipRemoves.push({ trackId: d.trackId, clipId: d.clipId });
        break;
      case 'notes_change':
        noteChanges.push({ trackId: d.trackId, clipId: d.clipId, count: d.noteCount });
        break;
      case 'transport':
        transportChanges[d.param] = { old: d.oldValue, new: d.newValue };
        break;
    }
  }

  // Build sections
  var sections = [];
  var lines = [];

  // Header
  lines.push('SESSION RECAP');
  lines.push('While you were away (' + durationMin + ' min, ' + timeRange + '):');
  lines.push('');

  // Tracks section
  if (trackAdds.length > 0 || trackRemoves.length > 0) {
    var trackSection = { title: 'Tracks', items: [] };
    if (trackAdds.length > 0) {
      var addLine = '+ Added ' + trackAdds.length + ' track' + (trackAdds.length > 1 ? 's' : '') +
        ': "' + trackAdds.join('", "') + '"';
      trackSection.items.push(addLine);
      lines.push(addLine);
    }
    if (trackRemoves.length > 0) {
      var rmLine = '- Removed ' + trackRemoves.length + ' track' + (trackRemoves.length > 1 ? 's' : '') +
        ': "' + trackRemoves.join('", "') + '"';
      trackSection.items.push(rmLine);
      lines.push(rmLine);
    }
    sections.push(trackSection);
    lines.push('');
  }

  // Mix changes section
  var mixItems = [];
  for (var tid in paramChanges) {
    var params = paramChanges[tid];
    for (var param in params) {
      var pc = params[param];
      var formatted = this._formatParamChange(tid, param, pc.old, pc.new);
      mixItems.push(formatted);
      lines.push(formatted);
    }
  }
  if (mixItems.length > 0) {
    sections.push({ title: 'Mix Changes', items: mixItems });
    lines.push('');
  }

  // Clips section
  if (clipAdds.length > 0 || clipRemoves.length > 0 || noteChanges.length > 0) {
    var clipSection = { title: 'Clips', items: [] };
    if (clipAdds.length > 0) {
      // Group by track
      var byTrack = {};
      for (var ca = 0; ca < clipAdds.length; ca++) {
        var key = clipAdds[ca].trackId;
        if (!byTrack[key]) byTrack[key] = 0;
        byTrack[key]++;
      }
      for (var tk in byTrack) {
        var clipLine = '+ Created ' + byTrack[tk] + ' clip' + (byTrack[tk] > 1 ? 's' : '') +
          ' in ' + this._shortTrackId(tk);
        clipSection.items.push(clipLine);
        lines.push(clipLine);
      }
    }
    if (noteChanges.length > 0) {
      var noteLine = 'Modified notes in ' + noteChanges.length + ' clip' + (noteChanges.length > 1 ? 's' : '');
      clipSection.items.push(noteLine);
      lines.push(noteLine);
    }
    sections.push(clipSection);
    lines.push('');
  }

  // Transport section
  var transportItems = [];
  for (var tp in transportChanges) {
    var tc = transportChanges[tp];
    var tpLine = this._formatTransportChange(tp, tc.old, tc.new);
    transportItems.push(tpLine);
    lines.push(tpLine);
  }
  if (transportItems.length > 0) {
    sections.push({ title: 'Transport', items: transportItems });
    lines.push('');
  }

  // Summary line
  var totalChanges = changes.length;
  var tracksAffected = Object.keys(paramChanges).length + trackAdds.length;
  var summaryLine = totalChanges + ' changes across ' + tracksAffected + ' tracks in ' + durationMin + ' min';
  lines.push('Summary: ' + summaryLine);

  var summary = {
    totalChanges: totalChanges,
    tracksAffected: tracksAffected,
    durationMin: durationMin,
    tracksAdded: trackAdds.length,
    tracksRemoved: trackRemoves.length,
    clipsAdded: clipAdds.length,
    paramChanges: mixItems.length,
    timeRange: timeRange
  };

  return {
    text: lines.join('\n'),
    sections: sections,
    summary: summary
  };
};

// --- Formatting Helpers ---

RecapGenerator.prototype._formatTime = function(ts) {
  var d = new Date(ts);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
};

RecapGenerator.prototype._formatParamChange = function(trackId, param, oldVal, newVal) {
  var trackName = this._shortTrackId(trackId);

  if (param === 'volume') {
    return trackName + ' volume: ' + Math.round(oldVal * 100) + '% -> ' + Math.round(newVal * 100) + '%';
  }
  if (param === 'pan') {
    return trackName + ' pan: ' + this._formatPan(oldVal) + ' -> ' + this._formatPan(newVal);
  }
  if (param === 'mute') {
    return trackName + (newVal ? ' muted' : ' unmuted');
  }
  if (param === 'solo') {
    return trackName + (newVal ? ' soloed' : ' un-soloed');
  }
  if (param === 'name') {
    return trackName + ' renamed: "' + oldVal + '" -> "' + newVal + '"';
  }
  return trackName + ' ' + param + ': ' + oldVal + ' -> ' + newVal;
};

RecapGenerator.prototype._formatTransportChange = function(param, oldVal, newVal) {
  if (param === 'tempo') {
    return 'Tempo: ' + Math.round(oldVal) + ' -> ' + Math.round(newVal) + ' BPM';
  }
  if (param === 'playing') {
    return newVal ? 'Started playback' : 'Stopped playback';
  }
  if (param === 'loopEnabled') {
    return newVal ? 'Loop enabled' : 'Loop disabled';
  }
  return param + ': ' + oldVal + ' -> ' + newVal;
};

RecapGenerator.prototype._formatPan = function(val) {
  if (Math.abs(val) < 0.01) return 'C';
  if (val < 0) return 'L' + Math.round(Math.abs(val) * 50);
  return 'R' + Math.round(val * 50);
};

RecapGenerator.prototype._shortTrackId = function(trackId) {
  // Extract readable name from trackId like "track-user-abc123-2"
  var parts = trackId.split('-');
  var idx = parts[parts.length - 1];
  return 'Track ' + (parseInt(idx) + 1);
};

if (typeof module !== 'undefined') {
  module.exports = RecapGenerator;
}
