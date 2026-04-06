// Claude Terminal v3 — fresh file to bypass cache
autowatch = 1;
inlets = 1;
outlets = 2;

var displayLines = [];
var MAX_LINES = 50;

function loadbang() {
  post("=== CT3 LOADED ===\n");
  addDisplay("sys", "=== Claude Terminal v3 ===");
  addDisplay("info", "Type below and press Enter");
}

function addDisplay(type, txt) {
  displayLines.push({ type: type, text: txt, ts: Date.now() });
  if (displayLines.length > MAX_LINES) displayLines.shift();
  outlet(0, "lines", JSON.stringify(displayLines));
}

// textedit sends "text <words>" — capture it
function text() {
  var a = arrayfromargs(arguments);
  var msg = a.join(" ");
  post("[USER] " + msg + "\n");
  addDisplay("note", "YOU: " + msg);
  // Write to file for Claude to read
  var f = new File("C:/Users/Owner/colab/claude-inbox.txt", "write");
  if (f.isopen) { f.writeline(Date.now() + "|" + msg); f.close(); }
}

// Catch everything else
function anything() {
  var addr = messagename;
  var args = arrayfromargs(arguments);
  var all = addr + " " + args.join(" ");
  post("[IN] " + all + "\n");

  if (addr === "/msg" || addr === "msg") { addDisplay("info", args.join(" ")); }
  else if (addr === "/ping" || addr === "ping") { addDisplay("sys", "pong"); outlet(1, "pong"); }
  else if (addr === "/eval" || addr === "eval") {
    try { var r = eval(args.join(" ")); addDisplay("cmd", "=> " + r); post("[EVAL] " + r + "\n"); }
    catch(e) { addDisplay("error", "ERR: " + e); post("[EVAL ERR] " + e + "\n"); }
  }
  else if (addr === "/tracks" || addr === "tracks") {
    var ls = new LiveAPI(null, "live_set");
    var tc = ls.getcount("tracks");
    for (var i = 0; i < tc; i++) {
      var t = new LiveAPI(null, "live_set tracks " + i);
      addDisplay("param", "T" + i + ": " + t.get("name"));
    }
  }
  else if (addr === "/trackinfo" || addr === "trackinfo") {
    var idx = parseInt(args[0] || 0);
    var t2 = new LiveAPI(null, "live_set tracks " + idx);
    var v = parseFloat(new LiveAPI(null, "live_set tracks " + idx + " mixer_device volume").get("value"));
    addDisplay("param", "T" + idx + " " + t2.get("name") + " vol=" + v.toFixed(2) + " mute=" + t2.get("mute"));
  }
  else { addDisplay("cmd", all); }
}

post("ct3.js loaded\n");
