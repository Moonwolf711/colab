"use strict";

// Node for Max owns only our bridge. MouseMux owns all physical input and cursors.
const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const MODES = new Set(["native", "switched", "multiplex"]);
const OBSERVED_MODES = new Set(["native", "merged", "switched", "multiplex"]);
const STATES = new Set(["disconnected", "connecting", "connected", "error", "expired"]);
const MAX_LINE = 65536;

function text(value, limit = 240) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, limit) : "";
}

function validateEvent(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    if (input.event === "status" && STATES.has(input.state))
        return { event: "status", state: input.state, detail: text(input.detail) };
    if (input.event === "error" && typeof input.detail === "string")
        return { event: "error", detail: text(input.detail) };
    if (input.event === "mode" && Array.isArray(input.mode)) {
        if (input.confirmed === false && input.mode.length === 0)
            return { event: "mode", mode: [], confirmed: false };
        const base = input.mode.filter(mode => OBSERVED_MODES.has(mode));
        const keyboard = input.mode.includes("multi-keyboard");
        if (input.confirmed === true && base.length === 1 &&
            input.mode.length === 1 + Number(keyboard) &&
            (!keyboard || ["switched", "multiplex"].includes(base[0])))
            return { event: "mode", mode: [...input.mode], confirmed: true };
    }
    if (input.event === "result" && typeof input.command === "string" &&
        typeof input.ok === "boolean")
        return { event: "result", command: text(input.command, 32), ok: input.ok, detail: text(input.detail) };
    if (input.event === "users" && Array.isArray(input.users) && input.users.length <= 128) {
        const users = [];
        for (const user of input.users) {
            if (!user || !Number.isSafeInteger(user.id) || user.id < 0 ||
                !Number.isSafeInteger(user.pointers) || user.pointers < 1) return null;
            const color = user.color;
            if (!color || !["r", "g", "b"].every(k => Number.isInteger(color[k]) &&
                color[k] >= 0 && color[k] <= 255)) return null;
            users.push({
                id: user.id, name: text(user.name, 64) || `Mouse ${user.id}`,
                color: { r: color.r, g: color.g, b: color.b }, pointers: user.pointers,
                active: user.active === true
            });
        }
        return { event: "users", users, pointer_users: users.length };
    }
    if (input.event === "activity" && Number.isSafeInteger(input.id) &&
        Number.isFinite(input.x) && Number.isFinite(input.y))
        return { event: "activity", id: input.id, x: input.x, y: input.y };
    return null;
}

function createManager(options = {}) {
    const spawn = options.spawn || childProcess.spawn;
    const existsSync = options.existsSync || fs.existsSync;
    const emit = options.emit || (() => {});
    const defer = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const directory = options.directory || __dirname;
    let bridge = null;
    let connected = false;
    let disconnecting = false;
    let observedMode = false;
    let requestedMode = "";
    let requestAcknowledged = false;
    let stopping = false;
    let loaderStarting = false;
    let killTimer = null;
    let disposed = false;

    function status(state, detail) {
        connected = state === "connected";
        if (!connected) {
            observedMode = false;
            requestedMode = "";
            requestAcknowledged = false;
        }
        emit({ event: "status", state, detail });
    }
    function fail(detail) {
        emit({ event: "error", detail: text(detail) });
    }
    function write(command) {
        if (!bridge || stopping || !bridge.stdin || bridge.stdin.destroyed) {
            fail("Bridge is unavailable. Click Connect.");
            return false;
        }
        try {
            bridge.stdin.write(`${JSON.stringify(command)}\n`);
            return true;
        } catch (error) {
            fail(`Bridge input failed: ${error.message}`);
            return false;
        }
    }
    function ensureBridge() {
        if (disposed || stopping) return false;
        if (bridge) return true;
        if (platform !== "win32") {
            fail("MouseMux requires Windows.");
            return false;
        }
        const executable = path.join(directory, "bin", "mousemux-live-bridge.exe");
        if (!existsSync(executable)) {
            fail("Bridge missing. Keep the bin folder beside CoLaB MouseMux.amxd.");
            return false;
        }
        let child;
        try {
            child = spawn(executable, [], {
                windowsHide: true, shell: false, cwd: directory,
                stdio: ["pipe", "pipe", "pipe"]
            });
        } catch (error) {
            fail(`Cannot start bridge: ${error.message}`);
            return false;
        }
        bridge = child;
        let buffer = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", chunk => {
            if (child !== bridge || stopping || disposed) return;
            buffer += chunk;
            if (buffer.length > MAX_LINE && !buffer.includes("\n")) {
                fail("Bridge sent an oversized event.");
                shutdown();
                return;
            }
            let newline;
            while ((newline = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                let event;
                try {
                    event = line.length <= MAX_LINE ? validateEvent(JSON.parse(line)) : null;
                } catch (_) {
                    event = null;
                }
                if (!event) {
                    fail("Bridge sent an invalid event.");
                    continue;
                }
                if (event.event === "status") {
                    if (disconnecting && ["connected", "connecting"].includes(event.state)) continue;
                    disconnecting = false;
                    status(event.state, event.detail);
                    continue;
                }
                // Never replace observed mode or roster with stale disconnected events.
                if (!connected && ["mode", "users", "activity"].includes(event.event)) continue;
                if (event.event === "mode") {
                    observedMode = event.confirmed;
                    if (requestAcknowledged && event.mode.includes(requestedMode)) {
                        requestedMode = "";
                        requestAcknowledged = false;
                    }
                } else if (event.event === "result" && event.command === "mode" && requestedMode) {
                    requestAcknowledged = event.ok;
                    if (!event.ok) requestedMode = "";
                }
                emit(event);
            }
            if (buffer.length > MAX_LINE) {
                fail("Bridge sent an oversized event.");
                shutdown();
            }
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", data => {
            if (child === bridge && !stopping && !disposed) fail(text(data));
        });
        child.stdin.on("error", error => {
            if (child === bridge && !stopping) fail(`Bridge input closed: ${error.message}`);
        });
        child.on("error", error => {
            if (child === bridge && !stopping && !disposed)
                status("error", `Cannot run bridge: ${error.message}`);
        });
        child.on("close", code => {
            if (child !== bridge) return;
            if (killTimer) cancel(killTimer);
            killTimer = null;
            bridge = null;
            const wasStopping = stopping;
            stopping = false;
            disconnecting = false;
            connected = false;
            if (!disposed) status("disconnected", wasStopping || code === 0 ?
                "Bridge stopped. MouseMux mode is unchanged." : `Bridge exited (${code}). Click Connect to retry.`);
        });
        return true;
    }
    function connect() {
        if (disposed) return;
        if (stopping || disconnecting) {
            fail("Bridge is disconnecting. Click Connect again after it finishes.");
            return;
        }
        if (!ensureBridge()) return;
        if (connected) {
            write({ command: "refresh" });
            return;
        }
        status("connecting", "Connecting to the installed MouseMux SDK...");
        write({ command: "connect" });
    }
    function disconnect() {
        if (disposed || stopping || disconnecting) return;
        if (!bridge) {
            status("disconnected", "Ready to connect.");
            return;
        }
        if (write({ command: "disconnect" })) {
            disconnecting = true;
            status("disconnected", "Disconnecting this controller. MouseMux mode is unchanged.");
        }
    }
    function refresh() {
        if (!connected) return fail("Connect to MouseMux before refreshing.");
        write({ command: "refresh" });
    }
    function mode(value) {
        if (!MODES.has(value)) return fail("Unknown MouseMux mode.");
        if (!connected) return fail("Connect to MouseMux before changing mode.");
        if (requestedMode) return fail("Wait for the pending MouseMux mode request to finish.");
        if (!observedMode) return fail("Wait for the mode reported by MouseMux before changing it.");
        if (write({ command: "mode", mode: value })) {
            requestedMode = value;
            requestAcknowledged = false;
            emit({ event: "request", mode: value });
        }
    }
    function startMouseMux() {
        if (disposed || loaderStarting) return;
        if (platform !== "win32") return fail("MouseMux requires Windows.");
        const programFiles = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const loader = path.win32.join(programFiles, "The MouseMux Company", "MouseMux V3",
            "store", "mousemux-v3-loader.exe");
        if (!existsSync(loader)) return fail("MouseMux V3 is not installed at its standard location.");
        loaderStarting = true;
        emit({ event: "notice", detail: "Starting the installed MouseMux application..." });
        let processHandle;
        try {
            processHandle = spawn(loader, ["--send-test=service", "--exec-safe=any,main"], {
                windowsHide: true, shell: false, cwd: path.win32.dirname(loader), stdio: "ignore"
            });
        } catch (error) {
            loaderStarting = false;
            return fail(`MouseMux launch failed: ${error.message}`);
        }
        processHandle.on("error", error => {
            loaderStarting = false;
            fail(`MouseMux launch failed: ${error.message}`);
        });
        processHandle.on("close", code => {
            loaderStarting = false;
            if (code === 0) emit({ event: "notice", detail: "MouseMux launched. Click Connect when ready." });
            else fail(`MouseMux loader exited (${code}). Open MouseMux and check its status.`);
        });
        // Vendor lifetime is independent: unloading this device must never kill MouseMux.
        processHandle.unref();
    }
    function shutdown() {
        if (!bridge || stopping) return;
        const child = bridge;
        try { child.stdin.write('{"command":"stop"}\n'); } catch (_) {}
        stopping = true;
        connected = false;
        observedMode = false;
        requestedMode = "";
        requestAcknowledged = false;
        if (!disposed) status("disconnected", "Stopping this controller. MouseMux mode is unchanged.");
        // EOF is the bridge's authoritative cleanup path, including Max process teardown.
        try { child.stdin.end(); } catch (_) {}
        killTimer = defer(() => {
            if (bridge === child) child.kill();
        }, 1200);
        if (killTimer && killTimer.unref) killTimer.unref();
    }
    function dispose() {
        disposed = true;
        shutdown();
    }
    function exit() {
        disposed = true;
        if (bridge && bridge.stdin) {
            try { bridge.stdin.end(); } catch (_) {}
        }
    }
    return { connect, disconnect, refresh, mode, startMouseMux, shutdown, dispose, exit };
}

module.exports = { createManager, validateEvent };

if (process.env.MAX_ENV) {
    const max = require("max-api");
    const manager = createManager({
        emit: event => max.outlet("event", JSON.stringify(event))
    });
    max.addHandler("connect", manager.connect);
    max.addHandler("disconnect", manager.disconnect);
    max.addHandler("refresh", manager.refresh);
    max.addHandler("mode", manager.mode);
    max.addHandler("startmousemux", manager.startMouseMux);
    max.addHandler("stop", manager.shutdown);
    max.addHandler("debug", (enabled, port = 9229) => {
        const inspector = require("node:inspector");
        if (Number(enabled)) {
            if (!inspector.url()) inspector.open(Number(port), "127.0.0.1", false);
            max.post("MouseMux manager inspector enabled on localhost.");
        } else inspector.close();
    });
    process.once("exit", manager.exit);
    process.once("SIGINT", manager.dispose);
    process.once("SIGTERM", manager.dispose);
    max.outlet("event", JSON.stringify({
        event: "status", state: "disconnected", detail: "Start MouseMux, then Connect. Loading this device changes no mode."
    }));
}
