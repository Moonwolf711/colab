/*
 * CoLaB Dial Controller — M5Stack Dial (ESP32-S3) control surface for Ableton Live via CoLaB
 * ------------------------------------------------------------------------------------------
 * Reads the M5Dial's rotary encoder, front button, and capacitive touch, then sends
 * CoLaB-protocol text commands over WiFi UDP to the host running the CoLaB M4L device
 * (udpreceive on port 8001).
 *
 * CoLaB protocol (see C:\Users\Owner\colab\CLAUDE.md "UDP Command Protocol"):
 *   - It is PLAIN TEXT over UDP, NOT binary OSC. Each datagram is one line of text.
 *   - Lines beginning with "/live/..." are executed directly as LiveAPI/OSC commands.
 *   - Lines beginning with a tag like [CMD] [OSC] [PARAM] [NOTE] [INFO] are logged/colored.
 * So this sketch just writes ASCII strings — no CNMAT/ArduinoOSC binary OSC library needed.
 *
 * Mapping implemented here:
 *   - Rotary encoder delta  -> /live/device/set/parameter/value <track> <device> <param> <value>
 *                              (accumulates a normalized 0.0-1.0 value for the target param)
 *   - Front button (short)  -> /live/song/start_playing  (toggles with stop)
 *   - Front button (long)   -> /live/song/stop_playing
 *   - Touch tap             -> cycles the target device-parameter index (param 0,1,2,...)
 *                              and announces it with a [PARAM] log line
 *
 * LiveAPI argument order (verified against CLAUDE.md):
 *   /live/device/set/parameter/value  <track_index> <device_index> <param_index> <value>
 *   /live/track/set/volume            <track_index> <value 0.0-1.0>
 *
 * HARDWARE: M5Stack Dial V1.1 (ESP32-S3, GC9A01A 240x240 round display, FT5x06 touch,
 *           rotary encoder, front button, SK6812 LED ring). Uses the M5Dial Arduino
 *           library (M5Dial.h) which already knows this board's pin map — see README.md
 *           for the GPIO cross-reference taken from the upstream ESPHome project.
 *
 * !!! NOT FLASHED / NOT RUN ON DEVICE !!!
 *   No physical M5Dial is attached to the build machine, so this sketch has NOT been
 *   compiled against the ESP32 toolchain or flashed. It is a scaffold + reference.
 *   See README.md for Arduino-IDE and PlatformIO flash steps before trusting it on hardware.
 *
 * License: original CoLaB scaffold. Hardware pin reference adapted from
 *          Jasionf/smart-home-button (MIT) — see README.md.
 */

#include <M5Dial.h>     // M5Stack Dial board support: encoder, button (BtnA), touch, display
#include <WiFi.h>
#include <WiFiUdp.h>

// ============================ USER CONFIG ============================
// Set these for your network and CoLaB host before flashing.
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// IP of the machine running Ableton + the CoLaB M4L device (udpreceive 8001).
// On the CoLaB primary PC this is 192.168.0.3 per CLAUDE.md; set to YOUR host.
static const char* HOST_IP   = "192.168.0.3";
static const uint16_t HOST_PORT = 8001;        // CoLaB M4L udpreceive port

// Which Live target the encoder drives by default.
static const int  TARGET_TRACK  = 0;           // live_set tracks 0
static const int  TARGET_DEVICE = 0;           // first device in that track's chain

// How many device-parameter slots the touch-tap cycles through (0..PARAM_COUNT-1).
static const int  PARAM_COUNT   = 8;

// Encoder feel: how much one detent moves the normalized 0.0-1.0 value.
static const float ENCODER_STEP = 0.02f;

// Long-press threshold for the front button (ms).
static const uint32_t LONG_PRESS_MS = 600;
// =====================================================================

WiFiUDP udp;

// Per-parameter normalized value cache so each param keeps its own 0.0-1.0 position.
static float paramValue[PARAM_COUNT];
static int   activeParam = 0;

static long     lastEncoder   = 0;
static bool     isPlaying     = false;
static uint32_t btnPressStart = 0;
static bool     btnWasDown    = false;

// ---- Send one CoLaB-protocol text line over UDP -------------------------------------------
static void sendLine(const String& line) {
  udp.beginPacket(HOST_IP, HOST_PORT);
  udp.print(line);
  udp.endPacket();
}

static float clamp01(float v) {
  if (v < 0.0f) return 0.0f;
  if (v > 1.0f) return 1.0f;
  return v;
}

// Encoder turned -> push the active device parameter's new value to Live.
static void onEncoderDelta(long delta) {
  if (delta == 0) return;
  paramValue[activeParam] = clamp01(paramValue[activeParam] + delta * ENCODER_STEP);

  // /live/device/set/parameter/value <track> <device> <param> <value>
  String cmd = "/live/device/set/parameter/value " +
               String(TARGET_TRACK) + " " +
               String(TARGET_DEVICE) + " " +
               String(activeParam) + " " +
               String(paramValue[activeParam], 4);
  sendLine(cmd);

  // Human-readable log line in the CoLaB feed.
  sendLine("[PARAM] dial: T" + String(TARGET_TRACK) +
           " D" + String(TARGET_DEVICE) +
           " P" + String(activeParam) +
           " = " + String(paramValue[activeParam], 3));
}

// Touch tap -> advance the active parameter index and announce it.
static void onTouchTap() {
  activeParam = (activeParam + 1) % PARAM_COUNT;
  sendLine("[INFO] dial: active param -> P" + String(activeParam));
}

// Front button short press -> toggle transport; long press -> force stop.
static void onButtonShort() {
  if (isPlaying) {
    sendLine("/live/song/stop_playing");
    sendLine("[CMD] dial: transport stop");
    isPlaying = false;
  } else {
    sendLine("/live/song/start_playing");
    sendLine("[CMD] dial: transport play");
    isPlaying = true;
  }
}

static void onButtonLong() {
  sendLine("/live/song/stop_playing");
  sendLine("[CMD] dial: transport STOP (long press)");
  isPlaying = false;
}

static void drawStatus(const String& msg) {
  M5Dial.Display.fillScreen(TFT_BLACK);
  M5Dial.Display.setTextColor(TFT_CYAN);
  M5Dial.Display.setTextDatum(middle_center);
  M5Dial.Display.setTextSize(1.4);
  M5Dial.Display.drawString("CoLaB Dial", M5Dial.Display.width() / 2, 80);
  M5Dial.Display.setTextColor(TFT_WHITE);
  M5Dial.Display.drawString(msg, M5Dial.Display.width() / 2, 130);
  M5Dial.Display.setTextColor(TFT_GREEN);
  M5Dial.Display.drawString("P" + String(activeParam) +
                            " " + String(paramValue[activeParam], 2),
                            M5Dial.Display.width() / 2, 165);
}

void setup() {
  auto cfg = M5.config();
  M5Dial.begin(cfg, /*enableEncoder=*/true, /*enableRFID=*/false);

  for (int i = 0; i < PARAM_COUNT; ++i) paramValue[i] = 0.5f;  // start params centered

  drawStatus("WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
  }

  udp.begin(0);  // ephemeral local port; we only send

  if (WiFi.status() == WL_CONNECTED) {
    drawStatus(WiFi.localIP().toString());
    sendLine("[SYS] CoLaB Dial connected from " + WiFi.localIP().toString());
  } else {
    drawStatus("WiFi FAIL");
  }

  lastEncoder = M5Dial.Encoder.read();
}

void loop() {
  M5Dial.update();

  // ---- Rotary encoder ----
  long enc = M5Dial.Encoder.read();
  long delta = enc - lastEncoder;
  if (delta != 0) {
    lastEncoder = enc;
    onEncoderDelta(delta);
    drawStatus(WiFi.localIP().toString());
  }

  // ---- Front button (M5Dial maps the front click to BtnA) ----
  bool down = M5Dial.BtnA.isPressed();
  if (down && !btnWasDown) {
    btnPressStart = millis();
    btnWasDown = true;
  } else if (!down && btnWasDown) {
    uint32_t held = millis() - btnPressStart;
    btnWasDown = false;
    if (held >= LONG_PRESS_MS) onButtonLong();
    else                       onButtonShort();
    drawStatus(WiFi.localIP().toString());
  }

  // ---- Capacitive touch (tap to cycle target param) ----
  auto t = M5Dial.Touch.getDetail();
  if (t.wasPressed()) {
    onTouchTap();
    drawStatus(WiFi.localIP().toString());
  }

  delay(5);
}
