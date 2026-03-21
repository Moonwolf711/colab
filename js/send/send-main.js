// coLaB Send Device - Main Controller
// M4L Audio Effect that captures track audio and streams to partner
// Placed on any track the user wants to share

var C = require('../shared/constants');
var protocol = require('../shared/protocol');

var sender = null;

function SendDevice() {
  this.trackId = 0;
  this.enabled = false;
  this.seq = 0;

  // Ring buffer for accumulating audio samples before Opus encoding
  this._ringBuffer = new Float32Array(C.OPUS_FRAME_SAMPLES * C.OPUS_CHANNELS * 2); // double buffer
  this._writePos = 0;
  this._frameReady = false;

  // Opus encoder state (placeholder — actual Opus via WASM or sidecar)
  this._opusReady = false;

  // Timestamp tracking
  this._sampleCount = 0;
}

// --- Initialization ---

SendDevice.prototype.init = function(trackId) {
  this.trackId = trackId;
  post('coLaB Send initialized on track ' + trackId + '\n');
};

SendDevice.prototype.enable = function() {
  this.enabled = true;
  this._sampleCount = 0;
  this._writePos = 0;
  post('coLaB Send enabled on track ' + this.trackId + '\n');
};

SendDevice.prototype.disable = function() {
  this.enabled = false;
  post('coLaB Send disabled on track ' + this.trackId + '\n');
};

// --- Audio Processing ---
// Called by M4L's [js] object in the audio thread via perform()
// In M4L, audio comes as interleaved float arrays

SendDevice.prototype.processAudio = function(inputL, inputR, blockSize) {
  if (!this.enabled) return;

  // Accumulate samples into ring buffer (interleaved stereo)
  for (var i = 0; i < blockSize; i++) {
    this._ringBuffer[this._writePos++] = inputL[i];
    this._ringBuffer[this._writePos++] = inputR[i];

    // When we have a full Opus frame worth of samples
    if (this._writePos >= C.OPUS_FRAME_SAMPLES * C.OPUS_CHANNELS) {
      this._encodeAndSend();
      this._writePos = 0;
    }
  }

  this._sampleCount += blockSize;
};

SendDevice.prototype._encodeAndSend = function() {
  // Extract one frame of interleaved stereo samples
  var frame = this._ringBuffer.subarray(0, C.OPUS_FRAME_SAMPLES * C.OPUS_CHANNELS);

  // Encode with Opus
  var encoded = this._opusEncode(frame);
  if (!encoded) return;

  // Build and send packet
  var packet = protocol.buildAudioPacket(
    this.seq++,
    this._sampleCount,
    this.trackId,
    encoded
  );

  // Send via outlet to Max patcher which routes to Hub's network
  if (typeof outlet === 'function') {
    // Convert to byte list for Max
    var args = ['audio_out'];
    for (var i = 0; i < packet.length; i++) {
      args.push(packet[i]);
    }
    outlet.apply(null, [0].concat(args));
  }
};

// --- Opus Encoding ---
// Phase 1: Simple passthrough (send raw PCM as 16-bit int for testing)
// Phase 2: Real Opus via WASM or Node.js sidecar

SendDevice.prototype._opusEncode = function(floatSamples) {
  // MVP: Convert float32 to int16 PCM (no Opus yet)
  // This uses more bandwidth but eliminates the Opus integration risk
  var int16 = new Int16Array(floatSamples.length);
  for (var i = 0; i < floatSamples.length; i++) {
    var s = Math.max(-1, Math.min(1, floatSamples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return new Uint8Array(int16.buffer);
};

// --- M4L JS Entry Points ---

function init(trackId) {
  sender = new SendDevice();
  sender.init(trackId || 0);
}

function enable() {
  if (sender) sender.enable();
}

function disable() {
  if (sender) sender.disable();
}

function setTrackId(id) {
  if (sender) sender.trackId = id;
}

// perform() is called by M4L for audio processing
// In M4L JS audio, we get inlet arrays
function perform(inputL, inputR) {
  if (sender && sender.enabled) {
    sender.processAudio(inputL, inputR, inputL.length);
  }
  // Pass through audio unchanged
  return [inputL, inputR];
}

if (typeof module !== 'undefined') {
  module.exports = SendDevice;
}
