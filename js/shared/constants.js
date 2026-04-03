// coLaB shared constants

// Network
exports.MULTICAST_ADDR = '224.0.0.42';
exports.DISCOVERY_PORT = 4242;
exports.STATE_PORT = 4243;
exports.AUDIO_PORT_BASE = 4244;
exports.DATA_PORT = 4253;        // LAN Transport reliable channel (UDP)
exports.TCP_PORT = 4260;         // TCP/IP stack primary port
exports.ABLETON_BRIDGE_PORT = 9877;  // AbletonBridge Remote Script TCP
exports.ABLETON_BRIDGE_UDP_PORT = 9882; // AbletonBridge fire-and-forget UDP

// Packet types
exports.PKT = {
  DISCOVERY_BEACON: 0x01,
  DISCOVERY_RESPONSE: 0x02,
  STATE_SYNC: 0x10,
  STATE_UPDATE: 0x11,
  CURSOR_UPDATE: 0x20,
  AUDIO_DATA: 0x30,
  HEARTBEAT: 0x40,
  HEARTBEAT_ACK: 0x41,
  CONNECT_REQUEST: 0x50,
  CONNECT_ACCEPT: 0x51,
  DISCONNECT: 0x52,
  ASSET_MANIFEST: 0x60,
  ASSET_REQUEST: 0x61,
  ASSET_TRANSFER: 0x62,
  ASSET_MISSING: 0x63,
  PLUGIN_AUDIT: 0x64,

  // LAN Transport control packets
  ACK: 0xA0,
  NACK: 0xA1,
  RELIABLE_WRAP: 0xA2,
  PING: 0xA3,
  PONG: 0xA4,
  FLOW_CTRL: 0xA5
};

// Audio
exports.SAMPLE_RATE = 48000;
exports.OPUS_FRAME_MS = 20;
exports.OPUS_FRAME_SAMPLES = 960; // 48000 * 0.02
exports.OPUS_BITRATE = 128000;
exports.OPUS_CHANNELS = 2;
exports.JITTER_BUFFER_FRAMES = 3;
exports.JITTER_BUFFER_MAX_FRAMES = 5;

// Timing
exports.HEARTBEAT_INTERVAL_MS = 2000;
exports.HEARTBEAT_TIMEOUT_MS = 6000; // 3 missed heartbeats
exports.CURSOR_POLL_HZ = 15;
exports.CURSOR_POLL_MS = Math.round(1000 / 15);
exports.PARAM_DEBOUNCE_MS = 30;
exports.RECONNECT_DELAY_MS = 1000;
exports.RECONNECT_MAX_ATTEMPTS = 10;

// Limits
exports.MAX_SHARED_TRACKS = 16;
exports.MAX_SYNCED_CLIPS = 64;
exports.MAX_TRANSFER_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file transfer
exports.TRANSFER_CHUNK_SIZE = 32768; // 32KB chunks for UDP file transfer

// File types for asset scanning
exports.AUDIO_EXTENSIONS = ['.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a', '.wma'];
exports.PRESET_EXTENSIONS = ['.adv', '.adg', '.agr', '.als', '.fxp', '.fxb', '.nmsv', '.vstpreset'];
