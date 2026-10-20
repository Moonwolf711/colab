"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { createManager, validateEvent } = require("../device/colab-mousemux-manager.js");

function fixture(overrides = {}) {
    const events = [];
    const launches = [];
    const timers = [];
    const children = [];
    const spawn = (executable, args, options) => {
        launches.push({ executable, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdout.setEncoding = child.stderr.setEncoding = () => {};
        child.stdin = new EventEmitter();
        child.commands = [];
        child.stdin.write = line => child.commands.push(JSON.parse(line));
        child.stdin.end = () => { child.ended = true; };
        child.kill = () => { child.killed = true; };
        child.unref = () => { child.unreferenced = true; };
        child.event = event => child.stdout.emit("data", JSON.stringify(event) + "\n");
        children.push(child);
        return child;
    };
    const manager = createManager({
        spawn, existsSync: () => true, platform: "win32", directory: "C:/Device",
        env: { "ProgramFiles(x86)": "D:\\Program Files (x86)" },
        emit: event => events.push(event),
        setTimeout: callback => { const timer = { callback, unref() {} }; timers.push(timer); return timer; },
        clearTimeout: timer => { timer.cancelled = true; },
        ...overrides
    });
    return { manager, events, launches, children, timers };
}

test("loading manager does not start a process or change mode", () => {
    const context = fixture();
    assert.deepEqual(context.launches, []);
    assert.deepEqual(context.events, []);
});

test("Connect spawns one hidden bridge and repeated connections do not spawn duplicates", () => {
    const context = fixture();
    context.manager.connect();
    context.manager.connect();
    assert.equal(context.launches.length, 1);
    assert.equal(context.launches[0].executable, path.join("C:/Device", "bin", "mousemux-live-bridge.exe"));
    assert.equal(context.launches[0].options.windowsHide, true);
    assert.equal(context.launches[0].options.shell, false);
    assert.deepEqual(context.children[0].commands, [{ command: "connect" }, { command: "connect" }]);
    context.children[0].event({ event: "status", state: "connected", detail: "Ready" });
    context.manager.connect();
    assert.deepEqual(context.children[0].commands.at(-1), { command: "refresh" });
});

test("mode action requires connection and never fabricates confirmed mode", () => {
    const context = fixture();
    context.manager.mode("multiplex");
    assert.equal(context.launches.length, 0);
    context.manager.connect();
    const child = context.children[0];
    child.event({ event: "status", state: "connected", detail: "Ready" });
    context.manager.mode("multiplex");
    assert.match(context.events.at(-1).detail, /Wait for the mode/);
    assert.equal(child.commands.some(command => command.command === "mode"), false);
    child.event({ event: "mode", mode: ["native"], confirmed: true });
    const observedCount = context.events.filter(event => event.event === "mode").length;
    context.manager.mode("multiplex");
    assert.deepEqual(child.commands.at(-1), { command: "mode", mode: "multiplex" });
    assert.deepEqual(context.events.at(-1), { event: "request", mode: "multiplex" });
    assert.equal(context.events.filter(event => event.event === "mode").length, observedCount);
    child.event({ event: "result", command: "mode", ok: true, detail: "Awaiting observed mode" });
    child.event({ event: "mode", mode: ["multiplex"], confirmed: true });
    assert.deepEqual(context.events.at(-1), { event: "mode", mode: ["multiplex"], confirmed: true });
    child.event({ event: "mode", mode: ["multiplex", "multi-keyboard"], confirmed: true });
    assert.deepEqual(context.events.at(-1).mode, ["multiplex", "multi-keyboard"]);
});

test("mode confirmation needs acknowledgement and observed state; no overlapping requests", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    child.event({ event: "status", state: "connected", detail: "Ready" });
    child.event({ event: "mode", mode: ["merged"], confirmed: true });
    context.manager.mode("switched");
    child.event({ event: "mode", mode: [], confirmed: false });
    child.event({ event: "mode", mode: ["switched"], confirmed: true });
    context.manager.mode("multiplex");
    assert.match(context.events.at(-1).detail, /pending MouseMux/);
    assert.equal(child.commands.filter(command => command.command === "mode").length, 1);
    child.event({ event: "result", command: "mode", ok: true, detail: "Setter acknowledged" });
    context.manager.mode("native");
    assert.match(context.events.at(-1).detail, /pending MouseMux/);
    child.event({ event: "mode", mode: ["switched"], confirmed: true });
    context.manager.mode("native");
    assert.equal(child.commands.filter(command => command.command === "mode").length, 2);
    child.event({ event: "result", command: "mode", ok: false, detail: "Rejected" });
    context.manager.mode("multiplex");
    assert.equal(child.commands.filter(command => command.command === "mode").length, 3);
});

test("valid JSON lines may span chunks; invalid events are rejected", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    child.stdout.emit("data", '{"event":"status","state":"con');
    child.stdout.emit("data", 'nected","detail":"Ready"}\nnot json\n{"event":"unknown"}\n');
    assert.equal(context.events.filter(event => event.event === "error").length, 2);
    context.manager.refresh();
    assert.deepEqual(child.commands.at(-1), { command: "refresh" });
    assert.equal(validateEvent({ event: "mode", mode: ["multiplex"], confirmed: false }), null);
    assert.equal(validateEvent({ event: "status", state: "invented" }), null);
    assert.deepEqual(validateEvent({ event: "mode", mode: [], confirmed: false }),
        { event: "mode", mode: [], confirmed: false });
    assert.equal(validateEvent({ event: "mode", mode: ["multi-keyboard"], confirmed: true }), null);
    assert.equal(validateEvent({ event: "mode", mode: ["native", "multiplex"], confirmed: true }), null);
    assert.equal(validateEvent({ event: "mode", mode: ["native", "multi-keyboard"], confirmed: true }), null);
});

test("user event whitelist removes device paths and all keyboard metadata", () => {
    const value = validateEvent({
        event: "users", pointer_users: 1, fingerprint: "secret",
        users: [{ id: 4, name: "Mouse", pointers: 1, color: { r: 1, g: 2, b: 3 },
            path: "private path", keyboard: "private input" }]
    });
    assert.deepEqual(value, {
        event: "users", pointer_users: 1,
        users: [{ id: 4, name: "Mouse", pointers: 1, color: { r: 1, g: 2, b: 3 }, active: false }]
    });
    assert.equal(validateEvent({ event: "users", users: [{ id: 1, pointers: 0 }] }), null);
});

test("disconnect forwards logout request and suppresses stale roster and mode", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    child.event({ event: "status", state: "connected", detail: "Ready" });
    context.manager.disconnect();
    assert.deepEqual(child.commands.at(-1), { command: "disconnect" });
    context.manager.mode("native");
    assert.equal(child.commands.at(-1).command, "disconnect");
    child.event({ event: "status", state: "connected", detail: "Late login" });
    assert.equal(context.events.at(-1).event, "error");
    context.manager.connect();
    assert.equal(child.commands.at(-1).command, "disconnect");
    child.event({ event: "status", state: "disconnected", detail: "Closed" });
    const count = context.events.length;
    child.event({ event: "mode", mode: ["multiplex"], confirmed: true });
    assert.equal(context.events.length, count);
    context.manager.mode("native");
    assert.equal(context.events.at(-1).event, "error");
});

test("shutdown suppresses late connected state and mode events from the owned child", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    child.event({ event: "status", state: "connected", detail: "Ready" });
    context.manager.shutdown();
    const count = context.events.length;
    child.event({ event: "status", state: "connected", detail: "Late status" });
    child.event({ event: "mode", mode: ["multiplex"], confirmed: true });
    assert.equal(context.events.length, count);
    context.manager.mode("native");
    assert.equal(child.commands.at(-1).command, "stop");
});

test("a complete event followed by an oversized partial event triggers bounded shutdown", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    child.stdout.emit("data", '{"event":"status","state":"connected","detail":"Ready"}\n' + "x".repeat(65537));
    assert.equal(child.ended, true);
    assert.deepEqual(child.commands.at(-1), { command: "stop" });
    assert.ok(context.events.some(event => event.detail === "Bridge sent an oversized event."));
});

test("stop sends explicit shutdown and EOF, then cancels fallback after bridge exit", () => {
    const context = fixture();
    context.manager.connect();
    const child = context.children[0];
    context.manager.shutdown();
    assert.deepEqual(child.commands.at(-1), { command: "stop" });
    assert.equal(child.ended, true);
    assert.equal(child.killed, undefined);
    child.emit("close", 0);
    assert.equal(context.timers[0].cancelled, true);
    assert.equal(context.events.at(-1).state, "disconnected");
    context.manager.connect();
    assert.equal(context.launches.length, 2);
});

test("forced fallback only kills our unresponsive bridge; parent exit closes stdin", () => {
    const context = fixture();
    context.manager.connect();
    context.manager.shutdown();
    context.timers[0].callback();
    assert.equal(context.children[0].killed, true);
    const other = fixture();
    other.manager.connect();
    other.manager.exit();
    assert.equal(other.children[0].ended, true);
    assert.equal(other.children[0].killed, undefined);
    other.manager.connect();
    assert.equal(other.launches.length, 1);
});

test("missing binary and failed spawn report actionable errors", () => {
    const absent = fixture({ existsSync: () => false });
    absent.manager.connect();
    assert.equal(absent.launches.length, 0);
    assert.match(absent.events.at(-1).detail, /Bridge missing/);
    const failed = fixture({ spawn: () => { throw new Error("access denied"); } });
    failed.manager.connect();
    assert.match(failed.events.at(-1).detail, /access denied/);
});

test("Start MouseMux uses installed loader path and arguments without shell or auto-connect", () => {
    const context = fixture();
    context.manager.startMouseMux();
    context.manager.startMouseMux();
    assert.equal(context.launches.length, 1);
    assert.equal(context.launches[0].executable,
        "D:\\Program Files (x86)\\The MouseMux Company\\MouseMux V3\\store\\mousemux-v3-loader.exe");
    assert.deepEqual(context.launches[0].args, ["--send-test=service", "--exec-safe=any,main"]);
    assert.equal(context.launches[0].options.shell, false);
    assert.equal(context.children[0].unreferenced, true);
    context.manager.dispose();
    assert.equal(context.children[0].killed, undefined);
    assert.equal(context.children[0].ended, undefined);
});
