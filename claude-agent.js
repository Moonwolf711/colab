// Claude Agent — persistent background process
// Watches claude-inbox.txt, executes commands, sends results to Ableton terminal

var fs = require('fs');
var dgram = require('dgram');
var s = dgram.createSocket('udp4');

function osc(addr, str) {
  var a = Buffer.from(addr + '\0');
  var p = 4 - (a.length % 4); if (p === 4) p = 0;
  a = Buffer.concat([a, Buffer.alloc(p)]);
  var t = Buffer.from(',s\0\0');
  var b = Buffer.from((str || '') + '\0');
  var p2 = 4 - (b.length % 4); if (p2 === 4) p2 = 0;
  b = Buffer.concat([b, Buffer.alloc(p2)]);
  s.send(Buffer.concat([a, t, b]), 11002, '127.0.0.1');
}

var lastMsg = '';
var INBOX = 'C:/Users/Owner/colab/claude-inbox.txt';

osc('/msg', 'Claude Agent ONLINE');
osc('/msg', 'Commands: tracks, fold N, mute N, vol N val, tempo BPM');
osc('/msg', 'play, stop, clip T C create/fire/delete, help');
console.log('Agent running...');

setInterval(function() {
  try {
    var content = fs.readFileSync(INBOX, 'utf8').trim();
    if (content && content !== lastMsg) {
      lastMsg = content;
      var msg = content.split('|').slice(1).join('|').trim();
      if (!msg) return;
      console.log('[CMD] ' + msg);
      var words = msg.split(' ');
      var cmd = words[0].toLowerCase();

      if (cmd === 'hello' || cmd === 'hi') osc('/msg', 'Hey! Type help for commands.');
      else if (cmd === 'tracks') osc('/tracks', '');
      else if (cmd === 'trackinfo') osc('/trackinfo', words[1] || '0');
      else if (cmd === 'fold') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("fold_state",1);"Folded"'); osc('/msg', 'Folded T' + (words[1]||0)); }
      else if (cmd === 'unfold') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("fold_state",0);"Unfolded"'); osc('/msg', 'Unfolded T' + (words[1]||0)); }
      else if (cmd === 'mute') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("mute",1);"Muted"'); osc('/msg', 'Muted T' + (words[1]||0)); }
      else if (cmd === 'unmute') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("mute",0);"Unmuted"'); osc('/msg', 'Unmuted T' + (words[1]||0)); }
      else if (cmd === 'solo') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("solo",1);"Soloed"'); osc('/msg', 'Soloed T' + (words[1]||0)); }
      else if (cmd === 'unsolo') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("solo",0);"Unsoloed"'); osc('/msg', 'Unsoloed T' + (words[1]||0)); }
      else if (cmd === 'vol') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + ' mixer_device volume").set("value",' + (words[2]||0.85) + ');"done"'); osc('/msg', 'T' + (words[1]||0) + ' vol=' + (words[2]||0.85)); }
      else if (cmd === 'pan') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + ' mixer_device panning").set("value",' + (words[2]||0) + ');"done"'); osc('/msg', 'T' + (words[1]||0) + ' pan=' + (words[2]||0)); }
      else if (cmd === 'color') { osc('/eval', 'new LiveAPI(null,"live_set tracks ' + (words[1]||0) + '").set("color_index",' + (words[2]||0) + ');"done"'); osc('/msg', 'T' + (words[1]||0) + ' color=' + (words[2]||0)); }
      else if (cmd === 'tempo') { osc('/eval', 'new LiveAPI(null,"live_set").set("tempo",' + (words[1]||130) + ');"done"'); osc('/msg', 'Tempo=' + (words[1]||130)); }
      else if (cmd === 'play') { osc('/eval', 'new LiveAPI(null,"live_set").call("start_playing");"playing"'); osc('/msg', 'Playing'); }
      else if (cmd === 'stop') { osc('/eval', 'new LiveAPI(null,"live_set").call("stop_playing");"stopped"'); osc('/msg', 'Stopped'); }
      else if (cmd === 'clip') {
        var ct = words[1]||0, cc = words[2]||0, ca = words[3]||'fire';
        if (ca === 'create') osc('/eval', 'new LiveAPI(null,"live_set tracks ' + ct + ' clip_slots ' + cc + '").call("create_clip",' + (words[4]||4) + ');"created"');
        else if (ca === 'delete') osc('/eval', 'new LiveAPI(null,"live_set tracks ' + ct + ' clip_slots ' + cc + '").call("delete_clip");"deleted"');
        else if (ca === 'fire') osc('/eval', 'new LiveAPI(null,"live_set tracks ' + ct + ' clip_slots ' + cc + '").call("fire");"fired"');
        osc('/msg', 'Clip T' + ct + ':C' + cc + ' ' + ca);
      }
      else if (cmd === 'eval') osc('/eval', words.slice(1).join(' '));
      else if (cmd === 'help') {
        osc('/msg', 'tracks | trackinfo N | fold/unfold N');
        osc('/msg', 'mute/unmute/solo/unsolo N');
        osc('/msg', 'vol N val | pan N val | color N val');
        osc('/msg', 'tempo BPM | play | stop');
        osc('/msg', 'clip T C create/fire/delete | eval <js>');
      }
      else osc('/msg', '? ' + msg + ' (type help)');
    }
  } catch(e) { console.log('ERR: ' + e.message); }
}, 1000);
