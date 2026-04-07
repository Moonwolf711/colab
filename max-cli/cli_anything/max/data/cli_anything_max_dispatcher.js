// cli_anything_max_dispatcher.js
// Dispatcher for the cli-anything-max control patch.
//
// Inlet 0: messages from [udpreceive 8002]. Max routes them by OSC address
//          so the first token is available as `messagename`.
// Outlets:
//   0 = reply (→ udpsend 127.0.0.1 8003)
//   1 = render gain (→ *~ right inlet)
//   2 = sfrecord~ control (→ sfrecord~ first inlet — open / 1 / 0 messages)
//   3 = debug (→ optional print/comment)
//   4 = seq control (→ seq object — record / stop / write / raw MIDI ints)

inlets = 1;
outlets = 5;
autowatch = 1;

var PATCH_NAME = "cli_anything_max_control";
var DEFAULT_SR = 44100;          // conservative default; Max may not expose samplerate() here
var DEFAULT_GAIN = 0.5;

function bang() {
    _reply("/pong", [Date.now()]);
}

// `anything` fires for ANY message whose first token is not one of the
// named handlers below — including OSC messages which arrive as
// messagename="/ping" (or similar).
function anything() {
    var addr = messagename;
    var args = arrayfromargs(arguments);
    _dispatch(addr, args);
}

// Some OSC paths (e.g. `/ping`) may also arrive as a literal symbol
// followed by no args. Declare handlers for common ones so Max routes
// them directly even when a route object is between udpreceive and js.
function _slash_ping() { _dispatch("/ping", []); }

function loadbang() {
    outlet(3, "dispatcher-loaded");
}

// ── Dispatch ────────────────────────────────────────────────────────

function _dispatch(addr, args) {
    try {
        if (addr === "/ping") {
            _reply("/pong", [Date.now()]);
        } else if (addr === "/query") {
            _do_query(args);
        } else if (addr === "/render/audio") {
            _do_render_audio(args);
        } else if (addr === "/render/midi") {
            _do_render_midi(args);
        } else if (addr === "/eval/js") {
            _do_eval_js(args);
        } else if (addr === "/shutdown") {
            _reply("/bye", []);
            // Do not actually call thispatcher quit — let the CLI
            // terminate the Max process. This keeps the JS side simple.
        } else {
            _reply("/error", ["unknown-address", addr]);
        }
    } catch (e) {
        _reply("/error", ["dispatcher-exception", String(e)]);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

function _reply(addr, args_array) {
    // Max's outlet() signature: outlet(outnum, ...messageAndArgs).
    // Build [0, addr, ...args] and call outlet via apply.
    var call_args = [0, addr];
    if (args_array && args_array.length) {
        for (var i = 0; i < args_array.length; i++) {
            call_args.push(args_array[i]);
        }
    }
    outlet.apply(this, call_args);
}

function _do_query(args) {
    if (!args || args.length === 0) {
        _reply("/query/error", ["missing-key"]);
        return;
    }
    var key = String(args[0]);
    if (key === "dsp") {
        // We force-enabled DSP on loadbang via `; dsp set 1`, so reply 1
        // unconditionally. A future version can query [adstatus dsp].
        _reply("/query/dsp", [1]);
    } else if (key === "sr") {
        _reply("/query/sr", [DEFAULT_SR]);
    } else if (key === "patch") {
        _reply("/query/patch", [PATCH_NAME]);
    } else {
        _reply("/query/error", ["unknown-key", key]);
    }
}

// Keep a persistent reference so the Task is not garbage-collected mid-schedule.
var g_render_task = null;
var g_render_path = "";

function _do_render_audio(args) {
    _reply("/debug", ["render-entered"]);
    if (!args || args.length < 2) {
        _reply("/render/error", ["missing-args"]);
        return;
    }
    var path = String(args[0]);
    var dur_ms = parseInt(args[1], 10);
    _reply("/debug", ["render-parsed", path, dur_ms]);
    if (!dur_ms || dur_ms <= 0) {
        _reply("/render/error", ["bad-duration", String(args[1])]);
        return;
    }
    g_render_path = path;

    // Tell the CLI we're starting BEFORE touching sfrecord~ so the reply
    // goes out regardless of what sfrecord~ does.
    _reply("/render/start", [path, dur_ms]);

    // Open the output file on sfrecord~. sfrecord~ infers WAV from the
    // .wav extension. We use the simpler 2-arg form because some Max
    // versions crash on multi-string outlet() calls with Windows paths.
    outlet(2, "open", path);
    _reply("/debug", ["render-opened"]);

    // Begin recording.
    outlet(2, 1);
    // Unmute the gain so the sine actually lands in the file.
    outlet(1, DEFAULT_GAIN);
    _reply("/debug", ["render-started"]);

    // Schedule the stop after dur_ms. Keep the Task in a global so GC
    // doesn't collect it before it fires.
    g_render_task = new Task(_render_stop, this);
    g_render_task.schedule(dur_ms);
}

function _render_stop() {
    outlet(2, 0);        // sfrecord~ stop
    outlet(1, 0.0);      // mute again
    _reply("/render/complete", [g_render_path]);
    g_render_task = null;
}

// ── MIDI render via [seq] ───────────────────────────────────────────

// seq accepts raw MIDI bytes as 3-int triples (status, data1, data2)
// once it has received the `record` message. After stopping, `write
// <path>` saves a Standard MIDI File to disk when the path ends in .mid.

var g_midi_write_task = null;
var g_midi_path = "";
var g_midi_note_tasks = [];

function _do_render_midi(args) {
    _reply("/debug", ["midi-entered"]);
    if (!args || args.length < 1) {
        _reply("/render/midi/error", ["missing-args"]);
        return;
    }
    var path = String(args[0]);
    g_midi_path = path;

    _reply("/render/midi/start", [path]);

    // Start recording. Any MIDI bytes that arrive at seq between now
    // and the `stop` message will be captured with live timestamps.
    outlet(4, "record");
    _reply("/debug", ["midi-recording"]);

    // Schedule a C major ascending riff — note_on/note_off pairs for
    // four pitches spread over ~700 ms so seq captures real deltas.
    // Status byte 144 = note_on, channel 1. Note_off is sent as a
    // note_on with velocity 0, which every SMF parser understands.
    var self = this;
    var notes = [
        [ 0,    60],
        [ 150,  62],
        [ 300,  64],
        [ 450,  65]
    ];
    g_midi_note_tasks = [];
    for (var i = 0; i < notes.length; i++) {
        (function (t_ms, pitch) {
            var t_on = new Task(function () {
                outlet(4, 144, pitch, 100);
            }, self);
            t_on.schedule(t_ms);
            g_midi_note_tasks.push(t_on);
            var t_off = new Task(function () {
                outlet(4, 144, pitch, 0);
            }, self);
            t_off.schedule(t_ms + 100);
            g_midi_note_tasks.push(t_off);
        })(notes[i][0], notes[i][1]);
    }

    // After 700 ms, stop recording and write the .mid file.
    g_midi_write_task = new Task(_midi_finish, this);
    g_midi_write_task.schedule(700);
}

function _midi_finish() {
    outlet(4, "stop");
    // seq's write message accepts an explicit filename in Max 9.
    outlet(4, "write", g_midi_path);
    _reply("/render/midi/complete", [g_midi_path]);
    g_midi_write_task = null;
    g_midi_note_tasks = [];
}

function _do_eval_js(args) {
    if (!args || args.length === 0) {
        _reply("/eval/js/error", ["missing-code"]);
        return;
    }
    var code = [];
    for (var i = 0; i < args.length; i++) code.push(String(args[i]));
    var src = code.join(" ");
    try {
        var result = eval(src);
        _reply("/eval/js/result", [String(result)]);
    } catch (e) {
        _reply("/eval/js/error", [String(e)]);
    }
}
