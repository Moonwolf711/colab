// coLaB Control Panel — v8ui for Max for Live
// Embedded in CoLanew.amxd device chain — no browser needed
// Buttons: Show/Follow Cursor, Sound On/Off, Quick Notify, System

autowatch = 1;
inlets = 1;
outlets = 1; // outlet 0 → connect to hub js inlet

// === ABLETON DARK THEME ===
var BG       = [0.114, 0.114, 0.122, 1.0];   // #1d1d1f
var SURFACE  = [0.157, 0.161, 0.176, 1.0];   // #28292d
var BORDER   = [0.216, 0.220, 0.243, 1.0];   // #37383e
var HOVER    = [0.196, 0.200, 0.224, 1.0];   // #323339
var TEXT_DIM = [0.42, 0.44, 0.48, 1.0];
var TEXT     = [0.68, 0.70, 0.73, 1.0];
var TEXT_HI  = [0.90, 0.91, 0.93, 1.0];

var CYAN     = [0.02, 0.71, 0.83, 1.0];
var PURPLE   = [0.65, 0.55, 0.98, 1.0];
var GREEN    = [0.20, 0.72, 0.36, 1.0];
var RED      = [0.85, 0.25, 0.25, 1.0];
var AMBER    = [0.90, 0.62, 0.08, 1.0];

var CYAN_DIM   = [0.02, 0.71, 0.83, 0.15];
var PURPLE_DIM = [0.65, 0.55, 0.98, 0.15];
var GREEN_DIM  = [0.20, 0.72, 0.36, 0.15];
var RED_DIM    = [0.85, 0.25, 0.25, 0.15];
var AMBER_DIM  = [0.90, 0.62, 0.08, 0.12];

var FONT = "Arial";
var FONT_MONO = "Consolas";

// === STATE ===
var localTrack = -1, localScene = -1;
var partnerTrack = -1, partnerScene = -1;
var isConnected = false;
var isFollowing = false;
var isCursorVisible = true;
var isSoundOn = true;
var trackCount = 0;
var trackNames = [];
var partnerName = "Partner";
var notification = "";
var notifTime = 0;

// IP editor state — 4 octets
var ipOctets = [192, 168, 0, 83];
var ipEditIdx = -1; // which octet is selected (-1=none)
var ipEditBuf = "";

var width = 460;
var height = 260;
var hoverIdx = -1;
var pressIdx = -1;
var updateTask = null;

// === BUTTON DEFINITIONS ===
var btns = []; // populated in defineButtons()

function defineButtons() {
    btns = [];
    var LM = 8;
    var bh = 22;

    // --- Row 0: Connect (y=38) ---
    var y0 = 38;
    btns.push({ id: "connect", x: 200, y: y0, w: 74, h: bh,
        label: function() { return "Connect"; },
        color: GREEN, dimColor: GREEN_DIM,
        active: function() { return isConnected; },
        action: function() {
            var ip = ipOctets[0] + "." + ipOctets[1] + "." + ipOctets[2] + "." + ipOctets[3];
            hubCmd("connect", ip);
            isConnected = true;
            partnerName = ip;
        }
    });
    btns.push({ id: "disconnect", x: 278, y: y0, w: 80, h: bh,
        label: function() { return "Disconnect"; },
        color: RED, dimColor: RED_DIM,
        active: function() { return false; },
        action: function() { hubCmd("disconnect"); isConnected = false; partnerName = "Partner"; }
    });
    // IP octet buttons (click to select for typing, keyboard to enter digits)
    var ipX = LM;
    for (var o = 0; o < 4; o++) {
        (function(idx, bx) {
            btns.push({ id: "ip_" + idx, x: bx, y: y0, w: 38, h: bh,
                label: function() { return "" + ipOctets[idx]; },
                color: CYAN, dimColor: CYAN_DIM,
                active: function() { return ipEditIdx === idx; },
                action: function() { ipOctets[idx] = (ipOctets[idx] + 1) % 256; },
                isOctet: true
            });
        })(o, ipX);
        ipX += 42;
    }

    // --- Row 1: Cursor (y=68) ---
    var y1 = 68;
    btns.push({ id: "cursor_vis", x: LM, y: y1, w: 88, h: bh,
        label: function() { return isCursorVisible ? "Cursor ON" : "Cursor OFF"; },
        color: CYAN, dimColor: CYAN_DIM,
        active: function() { return isCursorVisible; },
        action: function() { isCursorVisible = !isCursorVisible; hubCmd(isCursorVisible ? "show_cursor" : "hide_cursor"); }
    });
    btns.push({ id: "follow", x: LM + 92, y: y1, w: 80, h: bh,
        label: function() { return isFollowing ? "Following" : "Follow"; },
        color: PURPLE, dimColor: PURPLE_DIM,
        active: function() { return isFollowing; },
        action: function() { isFollowing = !isFollowing; hubCmd("follow_cursor", isFollowing ? 1 : 0); }
    });

    // --- Row 2: Sound (y=122) ---
    var y2 = 122;
    btns.push({ id: "snd_on", x: LM, y: y2, w: 68, h: bh,
        label: function() { return "Sound ON"; },
        color: GREEN, dimColor: GREEN_DIM,
        active: function() { return isSoundOn; },
        action: function() { isSoundOn = true; hubCmd("sound_on"); }
    });
    btns.push({ id: "snd_off", x: LM + 72, y: y2, w: 68, h: bh,
        label: function() { return "Sound OFF"; },
        color: RED, dimColor: RED_DIM,
        active: function() { return !isSoundOn; },
        action: function() { isSoundOn = false; hubCmd("sound_off"); }
    });
    btns.push({ id: "snd_toggle", x: LM + 144, y: y2, w: 60, h: bh,
        label: function() { return "Toggle"; },
        color: AMBER, dimColor: AMBER_DIM,
        active: function() { return false; },
        action: function() { isSoundOn = !isSoundOn; hubCmd("sound_toggle"); }
    });

    // --- Row 3: Notify (y=176) ---
    var y3 = 176;
    var msgs = ["Ready", "Muting", "BRB", "Check this", "Your turn"];
    var nx = LM;
    for (var i = 0; i < msgs.length; i++) {
        var nw = msgs[i].length * 6.5 + 14;
        (function(msg, bx, bw) {
            btns.push({ id: "notif_" + i, x: bx, y: y3, w: bw, h: 20,
                label: function() { return msg; },
                color: AMBER, dimColor: AMBER_DIM,
                active: function() { return false; },
                action: function() { hubCmd("notify", msg); notification = "You: " + msg; notifTime = Date.now(); },
                small: true
            });
        })(msgs[i], nx, nw);
        nx += nw + 3;
    }

    // --- Row 4: System (y=226) ---
    var y4 = 226;
    var sysCmds = [
        { label: "Compile", cmd: "compile" },
        { label: "Init", cmd: "init" },
        { label: "Refresh", cmd: "refresh" }
    ];
    var sx = LM;
    for (var j = 0; j < sysCmds.length; j++) {
        var sw = sysCmds[j].label.length * 6 + 14;
        (function(sc, bx, bw) {
            btns.push({ id: "sys_" + j, x: bx, y: y4, w: bw, h: 18,
                label: function() { return sc.label; },
                color: TEXT_DIM, dimColor: [0.2, 0.2, 0.22, 0.3],
                active: function() { return false; },
                action: function() { hubCmd(sc.cmd); },
                small: true, sys: true
            });
        })(sysCmds[j], sx, sw);
        sx += sw + 3;
    }
}

// === HUB COMMUNICATION (via outlet → patch cord to hub inlet) ===

function hubCmd() {
    var args = [];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    outlet(0, args);
}

// === INCOMING MESSAGES FROM HUB ===

function anything() {
    var args = arrayfromargs(messagename, arguments);
    var cmd = args[0];

    if (cmd === "state") {
        // state <localTrack> <localScene> <partnerTrack> <partnerScene> <connected> <following> <visible> <soundOn> <trackCount>
        localTrack = parseInt(args[1]) || 0;
        localScene = parseInt(args[2]) || 0;
        partnerTrack = parseInt(args[3]) || 0;
        partnerScene = parseInt(args[4]) || 0;
        isConnected = parseInt(args[5]) ? true : false;
        isFollowing = parseInt(args[6]) ? true : false;
        isCursorVisible = parseInt(args[7]) ? true : false;
        isSoundOn = parseInt(args[8]) ? true : false;
        trackCount = parseInt(args[9]) || 0;
        mgraphics.redraw();
    }
    else if (cmd === "tracks") {
        trackCount = parseInt(args[1]) || 0;
        trackNames = [];
        for (var i = 0; i < trackCount; i++) {
            trackNames.push((args[i + 2] || ("T" + (i+1))).replace(/_/g, " "));
        }
        mgraphics.redraw();
    }
    else if (cmd === "partner_name") {
        partnerName = args.slice(1).join(" ") || "Partner";
        mgraphics.redraw();
    }
    else if (cmd === "notification") {
        notification = "Partner: " + args.slice(1).join(" ");
        notifTime = Date.now();
        mgraphics.redraw();
    }
    else if (cmd === "cursor_local") {
        localTrack = parseInt(args[1]) || 0;
        localScene = parseInt(args[2]) || 0;
        mgraphics.redraw();
    }
    else if (cmd === "cursor_partner") {
        partnerTrack = parseInt(args[1]) || 0;
        partnerScene = parseInt(args[2]) || 0;
        isConnected = true;
        mgraphics.redraw();
    }
}

// === LIFECYCLE ===

function loadbang() {
    mgraphics.init();
    mgraphics.relative_coords = 0;
    mgraphics.autofill = 0;
    defineButtons();
    // Redraw at 5Hz for notification timeout
    updateTask = new Task(function() { mgraphics.redraw(); }, this);
    updateTask.interval = 200;
    updateTask.repeat();
    post("coLaB Control Panel loaded\n");
}

// === MOUSE HANDLING ===

function onclick(x, y, but, mod) {
    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            pressIdx = i;
            b.action.call(this);
            mgraphics.redraw();
            // Flash effect — reset after 150ms
            var self = this;
            var task = new Task(function() { pressIdx = -1; self.mgraphics.redraw(); }, this);
            task.schedule(150);
            return;
        }
    }
}

function onidle(x, y) {
    var newHover = -1;
    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            newHover = i;
            break;
        }
    }
    if (newHover !== hoverIdx) {
        hoverIdx = newHover;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (hoverIdx >= 0) {
        hoverIdx = -1;
        mgraphics.redraw();
    }
}

// === PAINT ===

function paint() {
    var g = mgraphics;
    width = this.box.rect[2] - this.box.rect[0];
    height = this.box.rect[3] - this.box.rect[1];

    // Background
    g.set_source_rgba(BG[0], BG[1], BG[2], BG[3]);
    g.rectangle(0, 0, width, height);
    g.fill();

    // ─── TITLE BAR ───
    g.set_source_rgba(SURFACE[0], SURFACE[1], SURFACE[2], 1);
    g.rectangle(0, 0, width, 22);
    g.fill();

    g.select_font_face(FONT);
    g.set_font_size(11);
    g.set_source_rgba(TEXT_HI[0], TEXT_HI[1], TEXT_HI[2], 1);
    g.move_to(8, 15);
    g.show_text("co");
    g.set_source_rgba(CYAN[0], CYAN[1], CYAN[2], 1);
    g.show_text("LaB");

    // Status dot + text
    var statusX = width - 90;
    if (isConnected) {
        g.set_source_rgba(GREEN[0], GREEN[1], GREEN[2], 1);
        g.arc(statusX, 11, 4, 0, Math.PI * 2);
        g.fill();
        g.set_source_rgba(TEXT[0], TEXT[1], TEXT[2], 1);
        g.move_to(statusX + 8, 15);
        g.set_font_size(9);
        g.show_text(partnerName);
    } else {
        g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.5);
        g.arc(statusX, 11, 4, 0, Math.PI * 2);
        g.fill();
        g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.5);
        g.move_to(statusX + 8, 15);
        g.set_font_size(9);
        g.show_text("Offline");
    }

    // Separator
    g.set_source_rgba(BORDER[0], BORDER[1], BORDER[2], 0.6);
    g.move_to(0, 22);
    g.line_to(width, 22);
    g.set_line_width(1);
    g.stroke();

    // ─── SECTION LABELS ───
    g.set_font_size(8);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.7);

    g.move_to(8, 33);
    g.show_text("CONNECT");

    g.move_to(8, 63);
    g.show_text("CURSOR");

    g.move_to(8, 117);
    g.show_text("SOUND");

    g.move_to(8, 170);
    g.show_text("NOTIFY");

    // IP octet dots (between the 4 octet buttons)
    g.set_font_size(12);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.6);
    g.move_to(46, 54);
    g.show_text(".");
    g.move_to(88, 54);
    g.show_text(".");
    g.move_to(130, 54);
    g.show_text(".");

    // ─── CURSOR INFO (right side of cursor row) ───
    var infoX = 200;
    g.set_font_size(9);
    g.select_font_face(FONT_MONO);

    // You
    g.set_source_rgba(PURPLE[0], PURPLE[1], PURPLE[2], 0.8);
    g.move_to(infoX, 78);
    g.show_text("YOU");
    g.set_source_rgba(TEXT[0], TEXT[1], TEXT[2], 1);
    g.move_to(infoX + 30, 78);
    var localName = (localTrack >= 0 && trackNames[localTrack]) ? trackNames[localTrack] : (localTrack >= 0 ? "Track " + (localTrack+1) : "--");
    g.show_text(localName);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.7);
    g.move_to(infoX + 30, 88);
    g.set_font_size(8);
    g.show_text(localTrack >= 0 ? "Scene " + (localScene+1) : "");

    // Partner
    g.set_font_size(9);
    g.set_source_rgba(CYAN[0], CYAN[1], CYAN[2], 0.8);
    g.move_to(infoX, 100);
    g.show_text("PTR");
    g.set_source_rgba(TEXT[0], TEXT[1], TEXT[2], 1);
    g.move_to(infoX + 30, 100);
    var partnerNameDisp = (partnerTrack >= 0 && trackNames[partnerTrack]) ? trackNames[partnerTrack] : (partnerTrack >= 0 ? "Track " + (partnerTrack+1) : "--");
    g.show_text(partnerNameDisp);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.7);
    g.move_to(infoX + 30, 110);
    g.set_font_size(8);
    g.show_text(partnerTrack >= 0 ? "Scene " + (partnerScene+1) : "");

    g.select_font_face(FONT);

    // ─── BUTTONS ───
    for (var i = 0; i < btns.length; i++) {
        drawButton(g, btns[i], i);
    }

    // ─── SECTION SEPARATORS ───
    g.set_source_rgba(BORDER[0], BORDER[1], BORDER[2], 0.3);
    g.set_line_width(1);
    var seps = [62, 96, 150, 202, 222];
    for (var s = 0; s < seps.length; s++) {
        g.move_to(4, seps[s]);
        g.line_to(width - 4, seps[s]);
        g.stroke();
    }

    // ─── NOTIFICATION BANNER ───
    if (notification && (Date.now() - notifTime) < 3500) {
        var bannerY = height - 38;
        g.set_source_rgba(0.05, 0.08, 0.14, 0.94);
        roundRect(g, 6, bannerY, width - 12, 22, 4);
        g.fill();
        g.set_source_rgba(CYAN[0], CYAN[1], CYAN[2], 0.6);
        g.set_line_width(1);
        roundRect(g, 6, bannerY, width - 12, 22, 4);
        g.stroke();
        g.set_font_size(9);
        g.set_source_rgba(TEXT_HI[0], TEXT_HI[1], TEXT_HI[2], 0.95);
        g.move_to(12, bannerY + 15);
        g.show_text(notification);
    } else if (notification && (Date.now() - notifTime) >= 3500) {
        notification = "";
    }

    // ─── FOOTER ───
    g.set_font_size(7);
    g.set_source_rgba(TEXT_DIM[0], TEXT_DIM[1], TEXT_DIM[2], 0.35);
    g.move_to(width - 68, height - 4);
    g.show_text("coLaB v0.6");
}

function drawButton(g, b, idx) {
    var isActive = b.active();
    var isHover = (idx === hoverIdx);
    var isPress = (idx === pressIdx);
    var fontSize = b.small ? 8.5 : 9.5;
    var col = b.color;
    var dimCol = b.dimColor;

    // Background
    if (isPress) {
        g.set_source_rgba(col[0], col[1], col[2], 0.25);
    } else if (isActive) {
        g.set_source_rgba(dimCol[0], dimCol[1], dimCol[2], dimCol[3]);
    } else if (isHover) {
        g.set_source_rgba(HOVER[0], HOVER[1], HOVER[2], 1);
    } else {
        g.set_source_rgba(SURFACE[0], SURFACE[1], SURFACE[2], b.sys ? 0.5 : 1);
    }
    roundRect(g, b.x, b.y, b.w, b.h, 3);
    g.fill();

    // Border
    if (isActive) {
        g.set_source_rgba(col[0], col[1], col[2], 0.6);
    } else if (isHover) {
        g.set_source_rgba(col[0], col[1], col[2], 0.3);
    } else {
        g.set_source_rgba(BORDER[0], BORDER[1], BORDER[2], b.sys ? 0.4 : 0.7);
    }
    g.set_line_width(1);
    roundRect(g, b.x, b.y, b.w, b.h, 3);
    g.stroke();

    // Label
    g.set_font_size(fontSize);
    if (isActive) {
        g.set_source_rgba(col[0], col[1], col[2], 1);
    } else if (isHover) {
        g.set_source_rgba(TEXT_HI[0], TEXT_HI[1], TEXT_HI[2], 1);
    } else {
        g.set_source_rgba(TEXT[0], TEXT[1], TEXT[2], b.sys ? 0.6 : 1);
    }

    var lbl = b.label();
    // Center text
    var te = g.text_measure(lbl);
    var tx = b.x + (b.w - te[0]) / 2;
    var ty = b.y + b.h - (b.h - fontSize) / 2 - 1;
    if (b.small) ty -= 1;
    g.move_to(tx, ty);
    g.show_text(lbl);
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

// reload 1775478680
