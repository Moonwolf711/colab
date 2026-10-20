autowatch = 0;
inlets = 1;
outlets = 1;

// Called only by live.thisdevice -> deferlow -> init. No global LiveAPI objects.
function init() {
    try {
        const device = new LiveAPI(null, "this_device");
        if (!device.id) throw new Error("Device is not hosted by Live");
        const parent = new LiveAPI(null, "this_device canonical_parent");
        let depth = 0;
        while (parent.id && parent.type !== "Track" && depth++ < 12) {
            parent.goto("canonical_parent");
        }
        const track = parent.id && parent.type === "Track" ? String(parent.get("name")) : "Live device";
        outlet(0, "host", JSON.stringify({ ready: true, track: track }));
    } catch (error) {
        outlet(0, "host", JSON.stringify({ ready: false, track: "Open this MIDI effect in Ableton Live" }));
        post("CoLaB MouseMux: " + error.message + "\n");
    }
}
