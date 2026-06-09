# CoLaB Dial Controller

A hardware control surface for Ableton Live driven through **CoLaB**, built for the
**M5Stack Dial V1.1** (ESP32-S3). The Dial's rotary encoder, front button, and capacitive
touch are read by an Arduino sketch (`dial_controller.ino`) that sends **CoLaB-protocol
text commands over WiFi UDP** to the machine running the CoLaB Max-for-Live device
(`udpreceive 8001`).

> **Status: scaffold only — NOT flashed, NOT run on device.**
> No physical M5Dial is attached to the build machine, so the sketch has not been compiled
> against the ESP32 toolchain or flashed to hardware. It is a working reference you flash
> yourself with the steps below. Pin assignments are cross-referenced (not invented) from
> the upstream ESPHome project — see *Provenance* at the bottom.

## How it talks to CoLaB

CoLaB's "OSC" is **plain text over UDP**, not binary OSC (confirmed in
`C:\Users\Owner\colab\CLAUDE.md` → *UDP Command Protocol*). Each datagram is one line:

- Lines starting with `/live/...` are executed directly as LiveAPI/OSC commands.
- Lines starting with a tag (`[CMD]`, `[OSC]`, `[PARAM]`, `[NOTE]`, `[INFO]`, `[WARN]`,
  `[ERR]`, `[SYS]`) are shown color-coded in the CoLaB feed.

The sketch therefore just writes ASCII with `WiFiUDP.print()` — **no CNMAT/ArduinoOSC
binary OSC library is needed or used.**

### Control mapping

| Input | Sends | CoLaB line |
|-------|-------|------------|
| Rotary encoder turn | Set active device parameter | `/live/device/set/parameter/value <track> <device> <param> <value>` + a `[PARAM]` log line |
| Front button (short) | Toggle transport play/stop | `/live/song/start_playing` or `/live/song/stop_playing` + `[CMD]` |
| Front button (long ≥600 ms) | Force stop | `/live/song/stop_playing` + `[CMD]` |
| Touch tap | Cycle which device-parameter index the encoder drives | `[INFO]` announce |

LiveAPI argument order (verified against `CLAUDE.md`):

```
/live/device/set/parameter/value  <track_index> <device_index> <param_index> <value 0.0-1.0>
/live/track/set/volume            <track_index> <value 0.0-1.0>
```

Each parameter slot keeps its own cached normalized value (0.0–1.0), so turning the encoder
nudges *that* slot up/down by `ENCODER_STEP` and pushes the absolute value to Live.

## Configuration constants

Edit the `USER CONFIG` block at the top of `dial_controller.ino`:

```cpp
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// IP of the machine running Ableton + CoLaB M4L (udpreceive 8001).
// CoLaB primary PC is 192.168.0.3 per CLAUDE.md; set to YOUR host.
static const char* HOST_IP   = "192.168.0.3";
static const uint16_t HOST_PORT = 8001;

static const int  TARGET_TRACK  = 0;   // live_set tracks 0
static const int  TARGET_DEVICE = 0;   // first device in that track's chain
static const int  PARAM_COUNT   = 8;   // touch-tap cycles through param 0..7
static const float ENCODER_STEP = 0.02f;
static const uint32_t LONG_PRESS_MS = 600;
```

The host must be reachable on the LAN and the CoLaB device must be loaded on a track in
Ableton (so its `udpreceive 8001` is listening).

## Hardware (M5Stack Dial V1.1)

- ESP32-S3 controller
- 240×240 GC9A01A round display
- FT5x06 capacitive touch
- Rotary encoder + front button
- SK6812 RGB LED ring (unused by this sketch; available for status feedback later)
- USB-C for flashing/power

The sketch uses the **M5Dial Arduino library (`M5Dial.h`)**, which already encapsulates this
board's pin map and exposes `M5Dial.Encoder`, `M5Dial.BtnA` (front click), and
`M5Dial.Touch`. You should not need to wire anything or set raw GPIOs — everything is on the
Dial itself; just connect USB-C.

### GPIO cross-reference (from upstream ESPHome `hardware.yaml`)

For sanity-checking against the M5Dial library, the upstream project documents these pins
(you do **not** set these manually when using `M5Dial.h`):

| Function | GPIO |
|----------|------|
| Internal I2C (touch, RTC) SDA / SCL | GPIO11 / GPIO12 |
| External I2C (Port A/B) SDA / SCL | GPIO13 / GPIO15 |
| Display SPI MOSI / CLK | GPIO5 / GPIO6 |
| Display CS / RST / DC | GPIO7 / GPIO8 / GPIO4 |
| Touch (FT5x06) interrupt | GPIO14 |
| Backlight (LEDC) | GPIO9 |
| Buzzer (LEDC) | GPIO3 |
| Battery power-hold (must stay HIGH on battery) | GPIO46 |

> **Battery note:** on V1.1, GPIO46 must be held HIGH to stay on under battery-only power.
> The M5Dial library / `M5.config()` handles power management; if you run on battery and the
> Dial sleeps immediately, that's the pin to investigate.

## Flash steps

You need an internet connection on first build (board packages + libraries download).

### Option A — Arduino IDE

1. Install the **ESP32 boards** package: *Preferences → Additional Boards Manager URLs* →
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then *Tools → Board → Boards Manager* → install **esp32 by Espressif** (3.x).
2. *Sketch → Include Library → Manage Libraries* → install **M5Dial** (pulls in **M5Unified** +
   **M5GFX** as dependencies).
3. Open `dial_controller.ino`.
4. *Tools → Board* → **M5Dial** (or **M5Stack-StampS3** if M5Dial isn't listed in your core).
5. Edit the `USER CONFIG` block (WiFi + `HOST_IP`).
6. Connect the Dial via USB-C, pick the COM port, click **Upload**.

### Option B — PlatformIO

Create `platformio.ini` next to the sketch (rename `dial_controller.ino` → `src/main.cpp`
for PlatformIO layout, or keep `.ino` with the `arduino` framework):

```ini
[env:m5dial]
platform = espressif32
board = m5stack-stamps3
framework = arduino
monitor_speed = 115200
lib_deps =
    m5stack/M5Dial
build_flags =
    -DBOARD_HAS_PSRAM
```

Then `pio run -t upload`.

## Verifying without the Dial

You can prove the *receiving* side works without any hardware by sending the same lines from
your PC. From the repo root (CoLaB device loaded on a track):

```powershell
# Smoke-send the exact lines the sketch emits, to the CoLaB M4L device:
python - <<'PY'
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
host=("127.0.0.1", 8001)
for line in [
    "[SYS] CoLaB Dial connected from 192.168.0.99",
    "/live/song/start_playing",
    "[CMD] dial: transport play",
    "/live/device/set/parameter/value 0 0 0 0.5200",
    "[PARAM] dial: T0 D0 P0 = 0.520",
]:
    s.sendto(line.encode(), host)
PY
```

If those appear color-coded in the CoLaB feed and the transport starts, the protocol path the
sketch targets is correct — only the WiFi/UDP send from the Dial remains to be verified on
real hardware.

## Provenance

- Sketch: original CoLaB scaffold.
- M5Dial GPIO cross-reference adapted from **Jasionf/smart-home-button** (MIT License),
  vendored at `E:\Projects\_deps\smart-home-button` (gitignored, not committed).
  That upstream is an **ESPHome/LVGL/YAML** firmware, not Arduino — so it could not be
  reused directly for raw UDP output; only its hardware pin map informed this sketch.
