// coLaB Cursor Overlay — JSUI Renderer
// Displays a Session View minimap with both cursors highlighted
// Place in same folder as the .amxd device

autowatch = 1;
inlets = 1;
outlets = 0;

// === DRAWING CONFIG ===
var BG        = [0.06, 0.07, 0.10, 1.0];
var GRID_BG   = [0.09, 0.10, 0.14, 1.0];
var GRID_LINE = [0.18, 0.20, 0.25, 1.0];
var HEADER_BG = [0.08, 0.10, 0.16, 1.0];
var TEXT_DIM   = [0.40, 0.45, 0.50, 1.0];
var TEXT_LIGHT = [0.80, 0.82, 0.85, 1.0];

// Cursor colors
var LOCAL_COLOR   = [0.65, 0.55, 0.98, 1.0]; // purple (#a78bfa)
var PARTNER_COLOR = [0.02, 0.71, 0.83, 1.0]; // cyan (#06b6d4)
var LOCAL_BG      = [0.65, 0.55, 0.98, 0.12];
var PARTNER_BG    = [0.02, 0.71, 0.83, 0.12];

var FONT      = 'Consolas';
var FONT_SIZE = 10;
var CELL_W    = 28;
var CELL_H    = 20;
var LABEL_W   = 70;
var HEADER_H  = 24;
var TITLE_H   = 20;
var PADDING   = 4;

// === STATE ===
var trackNames = [];
var trackCount = 0;
var sceneCount = 5;

var localCursor  = { track: -1, scene: -1 };
var partnerCursor = { track: -1, scene: -1 };

// Lerp animation state
var partnerLerp = { track: -1, scene: -1, targetTrack: -1, targetScene: -1, t: 1.0 };
var animTask = null;

var width = 300;
var height = 200;
var partnerName = "Partner";
var partnerOnline = false;
var visible = true;
var notificationText = "";
var notificationTime = 0;
var NOTIFICATION_DURATION = 4000; // show for 4 seconds

function loadbang() {
    mgraphics.init();
    mgraphics.relative_coords = 0;
    mgraphics.autofill = 0;

    // Start animation task at 30Hz
    animTask = new Task(animTick, this);
    animTask.interval = 33;
    animTask.repeat();
}

// === MESSAGE HANDLERS ===

function anything() {
    var args = arrayfromargs(messagename, arguments);
    var cmd = args[0];
    post("cursor-overlay GOT: " + cmd + " " + args.slice(1).join(" ") + "\n");

    if (cmd === 'local') {
        // local <track> <scene>
        localCursor.track = parseInt(args[1]) || 0;
        localCursor.scene = parseInt(args[2]) || 0;
        mgraphics.redraw();
    }
    else if (cmd === 'partner') {
        // partner <track> <scene>
        var newTrack = parseInt(args[1]) || 0;
        var newScene = parseInt(args[2]) || 0;
        // Start lerp animation
        partnerLerp.track = partnerCursor.track >= 0 ? partnerCursor.track : newTrack;
        partnerLerp.scene = partnerCursor.scene >= 0 ? partnerCursor.scene : newScene;
        partnerLerp.targetTrack = newTrack;
        partnerLerp.targetScene = newScene;
        partnerLerp.t = 0.0;
        partnerCursor.track = newTrack;
        partnerCursor.scene = newScene;
        partnerOnline = true;
        mgraphics.redraw();
    }
    else if (cmd === 'tracks') {
        // tracks <count> <name1> <name2> ...
        trackCount = parseInt(args[1]) || 0;
        trackNames = [];
        for (var i = 0; i < trackCount; i++) {
            trackNames.push(args[i + 2] || ("T" + (i + 1)));
        }
        mgraphics.redraw();
    }
    else if (cmd === 'scenes') {
        sceneCount = parseInt(args[1]) || 5;
        mgraphics.redraw();
    }
    else if (cmd === 'partner_name') {
        partnerName = args.slice(1).join(' ') || 'Partner';
        mgraphics.redraw();
    }
    else if (cmd === 'partner_offline') {
        partnerOnline = false;
        partnerCursor.track = -1;
        partnerCursor.scene = -1;
        mgraphics.redraw();
    }
    else if (cmd === 'visibility') {
        visible = parseInt(args[1]) ? true : false;
        post("cursor-overlay visibility: " + visible + "\n");
        mgraphics.redraw();
    }
    else if (cmd === 'notification') {
        notificationText = args.slice(1).join(' ');
        notificationTime = Date.now();
        post("cursor-overlay notification: " + notificationText + "\n");
        mgraphics.redraw();
    }
}

// === ANIMATION ===

function animTick() {
    if (partnerLerp.t < 1.0) {
        partnerLerp.t = Math.min(1.0, partnerLerp.t + 0.15); // ~200ms to complete at 30Hz
        mgraphics.redraw();
    }
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// === PAINT ===

function paint() {
    var g = mgraphics;
    // Hidden mode - just draw minimal background
    if (!visible) {
        g.set_source_rgba(BG[0], BG[1], BG[2], 0.3);
        g.rectangle(0, 0, width, height);
        g.fill();
        g.set_font_size(9);
        g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.4);
        g.move_to(PADDING, 14);
        g.show_text("CURSOR MAP (hidden)");
        return;
    }
    width = this.box.rect[2] - this.box.rect[0];
    height = this.box.rect[3] - this.box.rect[1];

    var maxTracks = Math.min(trackCount || 8, 16);
    var maxScenes = Math.min(sceneCount, 8);

    // Background
    g.set_source_rgba(BG[0], BG[1], BG[2], BG[3]);
    g.rectangle(0, 0, width, height);
    g.fill();

    // Title bar
    g.set_source_rgba(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2], HEADER_BG[3]);
    g.rectangle(0, 0, width, TITLE_H);
    g.fill();

    g.select_font_face(FONT);
    g.set_font_size(9);

    g.set_source_rgba(TEXT_LIGHT[0], TEXT_LIGHT[1], TEXT_LIGHT[2], 1.0);
    g.move_to(PADDING, 14);
    g.show_text("CURSOR MAP");

    // Legend: You dot + Partner dot
    var legendX = width - 140;
    // You
    g.set_source_rgba(LOCAL_COLOR[0], LOCAL_COLOR[1], LOCAL_COLOR[2], 1.0);
    roundRect(g, legendX, 5, 8, 8, 2);
    g.fill();
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 1.0);
    g.move_to(legendX + 12, 13);
    g.show_text("You");

    // Partner
    legendX += 45;
    if (partnerOnline) {
        g.set_source_rgba(PARTNER_COLOR[0], PARTNER_COLOR[1], PARTNER_COLOR[2], 1.0);
    } else {
        g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.4);
    }
    roundRect(g, legendX, 5, 8, 8, 2);
    g.fill();
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], partnerOnline ? 1.0 : 0.4);
    g.move_to(legendX + 12, 13);
    g.show_text(partnerName);

    // Separator under title
    g.set_source_rgba(GRID_LINE[0], GRID_LINE[1], GRID_LINE[2], 1.0);
    g.move_to(0, TITLE_H);
    g.line_to(width, TITLE_H);
    g.set_line_width(1);
    g.stroke();

    // Grid area
    var gridTop = TITLE_H + HEADER_H;
    var gridLeft = LABEL_W;

    // Compute cell size to fit
    var availW = width - gridLeft - PADDING;
    var availH = height - gridTop - PADDING;
    var cellW = Math.max(16, Math.floor(availW / maxScenes));
    var cellH = Math.max(14, Math.floor(availH / maxTracks));

    // Scene headers
    g.set_font_size(8);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 1.0);
    for (var s = 0; s < maxScenes; s++) {
        var sx = gridLeft + s * cellW + cellW / 2 - 4;
        g.move_to(sx, gridTop - 6);
        g.show_text("S" + (s + 1));
    }

    // Draw grid rows
    g.set_font_size(FONT_SIZE);
    for (var row = 0; row < maxTracks; row++) {
        var rowY = gridTop + row * cellH;

        // Highlight row if cursor is here
        var isLocalRow = (localCursor.track === row);
        var isPartnerRow = (partnerCursor.track === row);

        if (isPartnerRow && partnerOnline) {
            g.set_source_rgba(PARTNER_BG[0], PARTNER_BG[1], PARTNER_BG[2], PARTNER_BG[3]);
            g.rectangle(0, rowY, width, cellH);
            g.fill();
        }
        if (isLocalRow) {
            g.set_source_rgba(LOCAL_BG[0], LOCAL_BG[1], LOCAL_BG[2], LOCAL_BG[3]);
            g.rectangle(0, rowY, width, cellH);
            g.fill();
        }

        // Left edge indicator bars
        if (isPartnerRow && partnerOnline) {
            g.set_source_rgba(PARTNER_COLOR[0], PARTNER_COLOR[1], PARTNER_COLOR[2], 0.8);
            g.rectangle(0, rowY, 3, cellH);
            g.fill();
        }
        if (isLocalRow) {
            g.set_source_rgba(LOCAL_COLOR[0], LOCAL_COLOR[1], LOCAL_COLOR[2], 0.8);
            g.rectangle(3, rowY, 3, cellH);
            g.fill();
        }

        // Track label
        var tname = trackNames[row] || ("Track " + (row + 1));
        if (tname.length > 9) tname = tname.substring(0, 8) + ".";
        var labelColor = isLocalRow || isPartnerRow ? TEXT_LIGHT : TEXT_DIM;
        g.set_source_rgba(labelColor[0], labelColor[1], labelColor[2], 1.0);
        g.move_to(8, rowY + cellH - 5);
        g.show_text(tname);

        // Grid cells
        for (var col = 0; col < maxScenes; col++) {
            var cellX = gridLeft + col * cellW;

            // Cell border
            g.set_source_rgba(GRID_LINE[0], GRID_LINE[1], GRID_LINE[2], 0.5);
            g.rectangle(cellX, rowY, cellW, cellH);
            g.stroke();

            // Draw cursor dots
            var dotX = cellX + cellW / 2;
            var dotY = rowY + cellH / 2;
            var dotR = Math.min(cellW, cellH) * 0.25;

            // Partner cursor dot (with lerp animation)
            if (partnerOnline && partnerCursor.track === row && partnerCursor.scene === col) {
                var alpha = partnerLerp.t < 1.0 ? 0.5 + 0.5 * partnerLerp.t : 1.0;
                g.set_source_rgba(PARTNER_COLOR[0], PARTNER_COLOR[1], PARTNER_COLOR[2], alpha);
                g.arc(dotX, dotY, dotR + 1, 0, Math.PI * 2);
                g.fill();
            }

            // Local cursor dot
            if (localCursor.track === row && localCursor.scene === col) {
                g.set_source_rgba(LOCAL_COLOR[0], LOCAL_COLOR[1], LOCAL_COLOR[2], 1.0);
                g.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                g.fill();
            }
        }

        // Row separator
        g.set_source_rgba(GRID_LINE[0], GRID_LINE[1], GRID_LINE[2], 0.3);
        g.move_to(0, rowY + cellH);
        g.line_to(width, rowY + cellH);
        g.stroke();
    }

    // Bottom status bar
    g.set_source_rgba(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2], 1.0);
    g.rectangle(0, height - 14, width, 14);
    g.fill();

    g.set_font_size(8);
    if (partnerOnline) {
        g.set_source_rgba(0.0, 0.7, 0.35, 1.0);
        g.move_to(PADDING, height - 4);
        g.show_text("● " + partnerName + " on Track " + (partnerCursor.track + 1));
    } else {
        g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.6);
        g.move_to(PADDING, height - 4);
        g.show_text("○ Waiting for partner...");
    }

    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.6);
    g.move_to(width - 90, height - 4);
    g.show_text(trackCount + " tracks  " + sceneCount + " scenes");

    // Notification banner
    if (notificationText && (Date.now() - notificationTime) < NOTIFICATION_DURATION) {
        var bannerH = 28;
        var bannerY = TITLE_H + 2;
        // Semi-transparent dark background
        g.set_source_rgba(0.05, 0.08, 0.15, 0.92);
        g.rectangle(4, bannerY, width - 8, bannerH);
        g.fill();
        // Cyan border
        g.set_source_rgba(PARTNER_COLOR[0], PARTNER_COLOR[1], PARTNER_COLOR[2], 0.8);
        g.set_line_width(1.5);
        g.rectangle(4, bannerY, width - 8, bannerH);
        g.stroke();
        // Text
        g.set_font_size(10);
        g.set_source_rgba(1.0, 1.0, 1.0, 0.95);
        g.move_to(12, bannerY + 18);
        g.show_text("Partner: " + notificationText);
    } else if (notificationText && (Date.now() - notificationTime) >= NOTIFICATION_DURATION) {
        notificationText = "";
    }
}

// === HELPERS ===

function roundRect(g, x, y, w, h, r) {
    g.move_to(x + r, y);
    g.line_to(x + w - r, y);
    g.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    g.line_to(x + w, y + h - r);
    g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    g.line_to(x + r, y + h);
    g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    g.line_to(x, y + r);
    g.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    g.close_path();
}

function onresize(w, h) {
    width = w;
    height = h;
    mgraphics.redraw();
}
