autowatch = 0;
inlets = 1;
outlets = 0;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var state = {
    connection: "disconnected",
    detail: "Start MouseMux, then Connect.",
    actual: "",
    requested: "",
    acknowledged: false,
    users: [],
    usersKnown: false,
    host: "Waiting for Live",
    ready: false
};

function event() {
    try {
        var value = JSON.parse(arrayfromargs(arguments).join(" "));
        if (value.event === "status") {
            state.connection = value.state;
            state.detail = value.detail;
            if (value.state !== "connected") {
                state.users = [];
                state.usersKnown = false;
                state.actual = "";
                state.requested = "";
                state.acknowledged = false;
            }
        } else if (value.event === "mode") {
            state.actual = value.confirmed ? value.mode.join(" + ") : "";
            if (value.confirmed && state.acknowledged && value.mode.indexOf(state.requested) !== -1) {
                state.requested = "";
                state.acknowledged = false;
                state.detail = "Engine confirmed " + state.actual + ".";
            }
        } else if (value.event === "request") {
            state.requested = value.mode;
            state.acknowledged = false;
            state.detail = "Waiting for the engine to confirm the requested mode.";
        } else if (value.event === "users") {
            state.users = value.users;
            state.usersKnown = true;
        } else if (value.event === "error" || value.event === "notice" || value.event === "result") {
            state.detail = value.detail;
            if (value.event === "result" && value.command === "mode" && state.requested) {
                state.acknowledged = value.ok === true;
                if (!value.ok) state.requested = "";
            }
        } else if (value.event === "activity") {
            return;
        }
        mgraphics.redraw();
    } catch (_) {}
}

function host() {
    try {
        var value = JSON.parse(arrayfromargs(arguments).join(" "));
        state.ready = value.ready;
        state.host = value.track;
        mgraphics.redraw();
    } catch (_) {}
}

function color(r, g, b, a) { mgraphics.set_source_rgba(r, g, b, a === undefined ? 1 : a); }
function textAt(value, x, y, size, rgb) {
    color(rgb[0], rgb[1], rgb[2]);
    mgraphics.select_font_face("Arial", "normal", "normal");
    mgraphics.set_font_size(size);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(value));
}
function fitText(value, width, size) {
    var result = String(value || "");
    mgraphics.select_font_face("Arial", "normal", "normal");
    mgraphics.set_font_size(size);
    while (result.length > 1 && mgraphics.text_measure(result)[0] > width) result = result.slice(0, -2) + "\u2026";
    return result;
}
function card(user, x, index) {
    color(0.18, 0.19, 0.21);
    mgraphics.rectangle(x, 49, 290, 48);
    mgraphics.fill();
    var rgb = user ? [user.color.r / 255, user.color.g / 255, user.color.b / 255] : [0.36, 0.38, 0.42];
    color(rgb[0], rgb[1], rgb[2]);
    mgraphics.rectangle(x, 49, 3, 48);
    mgraphics.fill();
    textAt(user ? fitText(user.name, 258, 12) : "Mouse user " + (index + 1), x + 13, 69, 12, [0.94, 0.94, 0.95]);
    textAt(user ? "User " + user.id + "  /  " + (user.active ? "Active" : "Available") +
        "  /  " + user.pointers + (user.pointers === 1 ? " pointer" : " pointers") :
        state.connection !== "connected" ? "Connect to read physical mouse users" :
        !state.usersKnown ? "Waiting for the MouseMux roster" : "Assign a physical mouse in MouseMux",
        x + 13, 87, 10, [0.68, 0.71, 0.76]);
}
function paint() {
    color(0.115, 0.12, 0.135);
    mgraphics.rectangle(0, 0, 620, 169);
    mgraphics.fill();
    textAt("CoLaB / MouseMux", 12, 21, 15, [0.94, 0.95, 0.97]);
    var good = state.connection === "connected";
    color(good ? 0.30 : 0.61, good ? 0.79 : 0.63, good ? 0.55 : 0.68);
    mgraphics.ellipse(431, 12, 6, 6);
    mgraphics.fill();
    textAt(state.connection.toUpperCase(), 444, 20, 10, [0.78, 0.81, 0.85]);
    textAt(fitText((state.ready ? "LIVE  /  " : "") + state.host, 300, 10), 12, 39, 10, [0.58, 0.62, 0.69]);
    textAt(fitText("ACTUAL  " + (state.actual.toUpperCase() || "UNKNOWN"), 276, 10),
        332, 39, 10, good ? [0.50, 0.87, 0.66] : [0.58, 0.62, 0.69]);
    card(state.users[0], 12, 0);
    card(state.users[1], 312, 1);
    var detail = (state.requested ? "PENDING " + state.requested.toUpperCase() + "  /  " : "") + state.detail;
    textAt(fitText(detail, 592, 10), 12, 113, 10, state.requested ? [0.97, 0.77, 0.40] : [0.76, 0.79, 0.84]);
    var roster = !state.usersKnown ? "Roster not yet reported" :
        state.users.length > 2 ? "Showing 2 of " + state.users.length + " mouse users" :
        state.users.length + (state.users.length === 1 ? " mouse user" : " mouse users");
    textAt("Desktop-wide cursors  \u00b7  " + roster + "  \u00b7  MIDI passes through",
        12, 161, 9, [0.62, 0.66, 0.72]);
}
