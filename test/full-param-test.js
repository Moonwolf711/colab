/**
 * Full Parameter Sync Test — tests ALL syncable param categories
 * Run: node test/full-param-test.js
 */

var net = require('net');
var http = require('http');

function cmd(t, p) {
  return new Promise(function(r) {
    var s = new net.Socket();
    s.connect(9877, '127.0.0.1', function() { s.write(JSON.stringify({type:t,params:p})+'\n'); });
    var b = '';
    s.on('data', function(d) { b+=d.toString(); if(b.includes('\n')){try{r(JSON.parse(b.trim()));}catch(e){r({});}s.destroy();} });
    s.on('error', function() { r({}); });
    setTimeout(function() { s.destroy(); r({}); }, 8000);
  });
}

function hcmd(t, p) {
  return new Promise(function(r) {
    var body = JSON.stringify({type:t,params:p});
    var req = http.request({hostname:'192.168.0.83',port:3030,path:'/api/ableton/command',method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, function(res) {
      var c=[]; res.on('data',function(d){c.push(d);});
      res.on('end',function(){try{r(JSON.parse(Buffer.concat(c).toString()));}catch(e){r({});}});
    });
    req.on('error', function() { r({error:'no conn'}); });
    req.setTimeout(10000);
    req.write(body); req.end();
  });
}

function sl(ms) { return new Promise(function(r){setTimeout(r,ms);}); }

var pass = 0, fail = 0, skip = 0;

async function t(name, fn) {
  process.stdout.write('  ' + name + '... ');
  try { var ok = await fn(); console.log(ok ? 'PASS' : 'FAIL'); ok ? pass++ : fail++; }
  catch(e) { console.log('ERR: ' + e.message); fail++; }
}

async function run() {
  console.log('=== FULL PARAMETER SYNC TEST ===\n');

  // --- MIXER PARAMS (7 per track) ---
  console.log('--- Mixer Params ---');

  await t('T0 Volume', async() => {
    await cmd('set_track_volume', {track_index:0, volume:0.6});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && Math.abs((r.result.tracks||[])[0].volume - 0.6) < 0.01;
  });

  await t('T2 Pan', async() => {
    await cmd('set_track_pan', {track_index:2, pan:0.35});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    var t2 = (r.result.tracks||[])[2];
    return r.ok && Math.abs((t2.panning||t2.pan) - 0.35) < 0.01;
  });

  await t('T3 Mute ON', async() => {
    await cmd('set_track_mute', {track_index:3, mute:true});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[3].mute === true;
  });

  await t('T3 Mute OFF', async() => {
    await cmd('set_track_mute', {track_index:3, mute:false});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[3].mute === false;
  });

  await t('T5 Solo ON', async() => {
    await cmd('set_track_solo', {track_index:5, solo:true});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[5].solo === true;
  });

  await t('T5 Solo OFF', async() => {
    await cmd('set_track_solo', {track_index:5, solo:false});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[5].solo === false;
  });

  await t('T7 Color', async() => {
    await cmd('set_track_color', {track_index:7, color_index:30});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[7].color_index === 30;
  });

  await t('T10 Name', async() => {
    await cmd('set_track_name', {track_index:10, name:'SYNTH_TEST'});
    await sl(3000);
    var r = await hcmd('get_all_tracks_info', {});
    return r.ok && (r.result.tracks||[])[10].name === 'SYNTH_TEST';
  });

  // --- TRANSPORT ---
  console.log('\n--- Transport ---');

  await t('Tempo', async() => {
    await cmd('set_tempo', {tempo:140});
    await sl(3000);
    var r = await hcmd('get_session_info', {});
    return r.ok && Math.abs(r.result.tempo - 140) < 0.1;
  });

  // --- MULTI-TRACK VOLUME SWEEP ---
  console.log('\n--- Multi-track Volume Sweep ---');

  for (var v = 0; v < 5; v++) {
    var trackIdx = v * 3;
    var vol = 0.3 + (v * 0.1);
    await t('T' + trackIdx + ' vol=' + vol.toFixed(1), async() => {
      await cmd('set_track_volume', {track_index:trackIdx, volume:vol});
      await sl(2000);
      var r = await hcmd('get_all_tracks_info', {});
      return r.ok && Math.abs((r.result.tracks||[])[trackIdx].volume - vol) < 0.02;
    });
  }

  // --- CLIP CREATE + NOTES ---
  console.log('\n--- Clip + Notes (direct push) ---');

  await t('Create T12:C0', async() => {
    await cmd('delete_clip', {track_index:12, clip_index:0}).catch(function(){});
    await sl(500);
    var cr = await cmd('create_clip', {track_index:12, clip_index:0, length:4});
    return cr.status === 'success';
  });

  await t('Add 3 notes T12:C0', async() => {
    var r = await cmd('add_notes_to_clip', {track_index:12, clip_index:0, notes:[
      {pitch:48,start_time:0,duration:1,velocity:127},
      {pitch:55,start_time:1,duration:0.5,velocity:100},
      {pitch:60,start_time:2,duration:1.5,velocity:80}
    ]});
    return r.status === 'success' && r.result.note_count === 3;
  });

  await t('Push T12:C0 to HAVEN', async() => {
    var notes = await cmd('get_clip_notes', {track_index:12, clip_index:0, start_time:0, time_span:0, start_pitch:0, pitch_span:128});
    // Direct push
    await hcmd('create_clip', {track_index:12, clip_index:0, length:4});
    await hcmd('clear_clip_notes', {track_index:12, clip_index:0});
    var r = await hcmd('add_notes_to_clip', {track_index:12, clip_index:0, notes: notes.result.notes});
    return r.ok && r.result.note_count === 3;
  });

  await t('Verify HAVEN T12:C0 notes', async() => {
    var r = await hcmd('get_clip_notes', {track_index:12, clip_index:0, start_time:0, time_span:0, start_pitch:0, pitch_span:128});
    return r.ok && r.result.note_count === 3;
  });

  // --- DEVICE PARAMS ---
  console.log('\n--- Device Parameters ---');

  await t('Read T0:D0 params', async() => {
    var r = await cmd('get_device_parameters', {track_index:0, device_index:0});
    var params = r.result.parameters || r.result || [];
    console.log('(' + params.length + ' params)');
    return params.length > 0;
  });

  // --- RESTORE ---
  console.log('\n--- Restore ---');

  await t('Restore all', async() => {
    await cmd('set_track_volume', {track_index:0, volume:0.85});
    await cmd('set_track_pan', {track_index:2, pan:0});
    await cmd('set_track_color', {track_index:7, color_index:14});
    await cmd('set_track_name', {track_index:10, name:'SYNTH 1'});
    await cmd('set_tempo', {tempo:130});
    for (var v = 0; v < 5; v++) await cmd('set_track_volume', {track_index:v*3, volume:0.85});
    await sl(2000);
    return true;
  });

  // --- RESULTS ---
  console.log('\n========================================');
  console.log('  PASSED: ' + pass);
  console.log('  FAILED: ' + fail);
  console.log('  TOTAL:  ' + (pass + fail));
  console.log('========================================');
}

run().catch(function(e) { console.error('FATAL:', e); process.exit(1); });
