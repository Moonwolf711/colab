// Claude Terminal UI — v8ui renderer
// Draws a CLI-style scrollable terminal in the M4L device

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var lines = [];
var scrollOffset = 0;
var LINE_HEIGHT = 14;
var FONT_SIZE = 11;
var PADDING = 6;
var inputText = "";
var inputActive = false;

// Colors per message type
var COLORS = {
  sys:   [0.6, 0.4, 1.0],    // purple
  info:  [0.7, 0.7, 0.7],    // gray
  cmd:   [0.33, 0.66, 1.0],  // blue
  param: [0.0, 0.8, 0.8],    // cyan
  error: [1.0, 0.2, 0.2],    // red
  warn:  [1.0, 0.7, 0.0],    // orange
  note:  [1.0, 1.0, 0.3]     // yellow
};

function anything() {
  var name = messagename;
  var args = arrayfromargs(arguments);

  if (name === "lines") {
    try {
      lines = JSON.parse(args.join(" "));
      mgraphics.redraw();
    } catch(e) {}
  }
}

function paint() {
  var w = mgraphics.size[0];
  var h = mgraphics.size[1];

  // Background — dark terminal
  mgraphics.set_source_rgba(0.08, 0.08, 0.1, 1.0);
  mgraphics.rectangle(0, 0, w, h);
  mgraphics.fill();

  // Header bar
  mgraphics.set_source_rgba(0.15, 0.12, 0.2, 1.0);
  mgraphics.rectangle(0, 0, w, 20);
  mgraphics.fill();

  mgraphics.set_source_rgba(0.6, 0.4, 1.0, 1.0);
  mgraphics.select_font_face("Monaco");
  mgraphics.set_font_size(10);
  mgraphics.move_to(PADDING, 14);
  mgraphics.show_text("CLAUDE TERMINAL — " + lines.length + " lines");

  // Draw lines
  mgraphics.select_font_face("Monaco");
  mgraphics.set_font_size(FONT_SIZE);

  var maxVisible = Math.floor((h - 24) / LINE_HEIGHT);
  var startIdx = Math.max(0, lines.length - maxVisible - scrollOffset);
  var y = 32;

  for (var i = startIdx; i < lines.length && y < h - 4; i++) {
    var line = lines[i];
    var color = COLORS[line.type] || COLORS.info;

    // Timestamp
    var ts = new Date(line.ts);
    var timeStr = ('0' + ts.getHours()).slice(-2) + ':' + ('0' + ts.getMinutes()).slice(-2) + ':' + ('0' + ts.getSeconds()).slice(-2);

    mgraphics.set_source_rgba(0.4, 0.4, 0.4, 1.0);
    mgraphics.move_to(PADDING, y);
    mgraphics.show_text(timeStr);

    // Type badge
    mgraphics.set_source_rgba(color[0], color[1], color[2], 0.7);
    mgraphics.move_to(PADDING + 58, y);
    mgraphics.show_text("[" + (line.type || "?").toUpperCase() + "]");

    // Message text
    mgraphics.set_source_rgba(color[0], color[1], color[2], 1.0);
    mgraphics.move_to(PADDING + 110, y);
    var maxChars = Math.floor((w - 120) / 7);
    var text = line.text || "";
    if (text.length > maxChars) text = text.substring(0, maxChars - 1) + "…";
    mgraphics.show_text(text);

    y += LINE_HEIGHT;
  }

  // Input bar at bottom
  var inputY = h - 22;
  mgraphics.set_source_rgba(0.12, 0.12, 0.18, 1.0);
  mgraphics.rectangle(0, inputY, w, 22);
  mgraphics.fill();

  mgraphics.set_source_rgba(0.33, 0.66, 1.0, 1.0);
  mgraphics.move_to(PADDING, inputY + 15);
  mgraphics.show_text("> " + inputText + (inputActive ? "_" : ""));

  // Scrollbar
  if (lines.length > maxVisible) {
    var barH = Math.max(20, (maxVisible / lines.length) * (h - 24));
    var barY = 22 + ((startIdx / lines.length) * (h - 24 - barH));
    mgraphics.set_source_rgba(0.3, 0.3, 0.4, 0.5);
    mgraphics.rectangle(w - 6, barY, 4, barH);
    mgraphics.fill();
  }
}

function onresize(w, h) {
  mgraphics.redraw();
}

// Scroll with mouse wheel
function onwheel(x, y, dx, dy) {
  scrollOffset = Math.max(0, scrollOffset + (dy > 0 ? 1 : -1));
  mgraphics.redraw();
}

// Click to activate input
function onclick(x, y) {
  inputActive = true;
  mgraphics.redraw();
}

// Keyboard input
function onchar(c) {
  if (!inputActive) return;
  if (c === "\r" || c === "\n") {
    // Enter — send the message
    if (inputText.length > 0) {
      // Add to display as user message
      lines.push({ type: "cmd", text: "> " + inputText, ts: Date.now() });
      // Send to js outlet for processing
      outlet(0, "user_input", inputText);
      inputText = "";
    }
  } else if (c === "\b" || c.charCodeAt(0) === 127) {
    // Backspace
    inputText = inputText.substring(0, inputText.length - 1);
  } else if (c.charCodeAt(0) >= 32) {
    inputText += c;
  }
  mgraphics.redraw();
}

// Also handle special keys
function onkey(key, mod, ascii) {
  if (key === 8) { // backspace
    inputText = inputText.substring(0, inputText.length - 1);
    mgraphics.redraw();
  }
}
