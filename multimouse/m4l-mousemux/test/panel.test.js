"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
    const labels = [];
    let position = [0, 0];
    const context = vm.createContext({
        arrayfromargs: args => Array.from(args),
        mgraphics: {
            init() {}, redraw() {}, set_source_rgba() {}, select_font_face() {},
            set_font_size() {}, rectangle() {}, ellipse() {}, fill() {},
            move_to: (x, y) => { position = [x, y]; },
            show_text: value => labels.push({ value, position }),
            text_measure: value => [value.length * 6, 12]
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../device/colab-mousemux-panel.js"), "utf8"), context);
    return { context, labels, event: value => context.event(JSON.stringify(value)) };
}

test("pending text survives unknown state and setter acknowledgement until observed confirmation", () => {
    const view = fixture();
    view.event({ event: "status", state: "connected", detail: "Ready" });
    view.event({ event: "mode", mode: ["merged"], confirmed: true });
    assert.equal(view.context.state.actual, "merged");
    view.event({ event: "request", mode: "multiplex" });
    view.event({ event: "mode", mode: [], confirmed: false });
    assert.equal(view.context.state.actual, "");
    assert.equal(view.context.state.requested, "multiplex");
    view.event({ event: "mode", mode: ["multiplex"], confirmed: true });
    assert.equal(view.context.state.requested, "multiplex", "pre-ack observation cannot finish a request");
    view.event({ event: "result", command: "mode", ok: true, detail: "Waiting for actual mode" });
    assert.equal(view.context.state.requested, "multiplex");
    view.context.paint();
    assert.ok(view.labels.some(label => label.value.startsWith("PENDING MULTIPLEX")));
    view.event({ event: "mode", mode: ["multiplex", "multi-keyboard"], confirmed: true });
    assert.equal(view.context.state.requested, "");
    assert.equal(view.context.state.detail, "Engine confirmed multiplex + multi-keyboard.");
});

test("only a mode failure cancels a pending mode and disconnected state clears the roster", () => {
    const view = fixture();
    view.event({ event: "status", state: "connected", detail: "Ready" });
    view.event({ event: "users", users: [{ id: 1 }] });
    view.event({ event: "request", mode: "switched" });
    view.event({ event: "result", command: "refresh", ok: false, detail: "Refresh failed" });
    assert.equal(view.context.state.requested, "switched");
    view.event({ event: "result", command: "mode", ok: false, detail: "Mode rejected" });
    assert.equal(view.context.state.requested, "");
    assert.equal(view.context.state.detail, "Mode rejected");
    view.event({ event: "status", state: "expired", detail: "SDK session expired" });
    assert.equal(view.context.state.users.length, 0);
    assert.equal(view.context.state.usersKnown, false);
    assert.equal(view.context.state.actual, "");
});

test("roster waiting, empty and overflow states remain distinct within the 169px panel", () => {
    const view = fixture();
    view.event({ event: "status", state: "connected", detail: "Ready" });
    view.context.paint();
    assert.ok(view.labels.some(label => label.value === "Waiting for the MouseMux roster"));
    view.labels.length = 0;
    view.event({ event: "users", users: [] });
    view.context.paint();
    assert.ok(view.labels.some(label => label.value === "Assign a physical mouse in MouseMux"));
    view.labels.length = 0;
    view.event({ event: "users", users: [1, 2, 3].map(id => ({
        id, name: `Mouse ${id}`, active: false, pointers: 1, color: { r: 50, g: 100, b: 150 }
    })) });
    view.context.paint();
    assert.ok(view.labels.some(label => label.value.includes("Showing 2 of 3 mouse users")));
    assert.ok(view.labels.every(label => label.position[1] <= 161));
});
