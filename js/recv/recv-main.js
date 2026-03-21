// coLaB Receive Device - Main Controller
// M4L Audio Effect on ghost tracks that decodes and plays partner's audio
// Auto-created by Hub when partner shares a track

var C = require('../shared/constants');
var protocol = require('../shared/protocol');

var receiver = null;

function ReceiveDevice() {
  this.trackId = 0;
  this.enabled = false;

  // Jitter buffer: ring of decoded audio frames
  this._jitterBuffer = [];
  this._jitterTarget = C.JITTER_BUFFER_FRAMES;
  this._jitterMax = C.JITTER_BUFFER_MAX_FRAMES;
  this._readPos = 0;
  this._lastSeq = -1;
  this._packetsReceived = 0;
  this._packetsLost = 0;

  // Current playback frame
  this._currentFrame = null;
  this._frameReadPos = 0;

  // Stats
  this._bufferUnderruns = 0;
}

// --- Initialization ---

ReceiveDevice.prototype.init = function(trackId) {
  this.trackId = trackId;
  this.enabled = true;
  post('coLaB Receive initialized for track ' + trackId + '\n');
};

// --- Incoming Audio ---

ReceiveDevice.prototype.receivePacket = function(packetData) {
  if (!this.enabled) return;

  var parsed = protocol.parseAudioPacket(packetData);

  // Check for packet loss
  if (this._lastSeq >= 0) {
    var expected = this._lastSeq + 1;
    if (parsed.seq > expected) {
      var lost = parsed.seq - expected;
      this._packetsLost += lost;

      // Insert silence frames for lost packets (simple PLC)
      for (var i = 0; i < lost && i < 3; i++) {
        this._insertSilenceFrame();
      }
    }
  }
  this._lastSeq = parsed.seq;
  this._packetsReceived++;

  // Decode audio
  var decoded = this._opusDecode(parsed.payload);
  if (decoded) {
    this._jitterBuffer.push(decoded);

    // Trim buffer if too large
    while (this._jitterBuffer.length > this._jitterMax) {
      this._jitterBuffer.shift();
    }

    // Adaptive jitter buffer: grow if we're seeing losses
    if (this._packetsLost > 0 && this._packetsReceived > 100) {
      var lossRate = this._packetsLost / this._packetsReceived;
      if (lossRate > 0.02) {
        this._jitterTarget = Math.min(this._jitterMax, this._jitterTarget + 1);
      } else if (lossRate < 0.005 && this._jitterTarget > C.JITTER_BUFFER_FRAMES) {
        this._jitterTarget--;
      }
    }
  }
};

ReceiveDevice.prototype._insertSilenceFrame = function() {
  // Insert a frame of silence (or repeat last frame for better PLC)
  var frameSize = C.OPUS_FRAME_SAMPLES * C.OPUS_CHANNELS;
  var silence;

  if (this._jitterBuffer.length > 0) {
    // Simple PLC: repeat last frame (fade out would be better)
    silence = new Float32Array(this._jitterBuffer[this._jitterBuffer.length - 1]);
    // Apply fade
    for (var i = 0; i < silence.length; i++) {
      silence[i] *= 0.7; // crude fade
    }
  } else {
    silence = new Float32Array(frameSize);
  }

  this._jitterBuffer.push(silence);
};

// --- Audio Output ---
// Called by M4L perform() to fill output buffers

ReceiveDevice.prototype.getAudio = function(blockSize) {
  var outL = new Float32Array(blockSize);
  var outR = new Float32Array(blockSize);

  if (!this.enabled) return [outL, outR];

  // Wait until jitter buffer has enough frames before starting playback
  if (this._currentFrame === null && this._jitterBuffer.length < this._jitterTarget) {
    return [outL, outR]; // silence until buffer fills
  }

  for (var i = 0; i < blockSize; i++) {
    // Need a new frame?
    if (this._currentFrame === null || this._frameReadPos >= C.OPUS_FRAME_SAMPLES) {
      if (this._jitterBuffer.length > 0) {
        this._currentFrame = this._jitterBuffer.shift();
        this._frameReadPos = 0;
      } else {
        // Buffer underrun — output silence
        this._bufferUnderruns++;
        this._currentFrame = null;
        break;
      }
    }

    // Read interleaved stereo from current frame
    if (this._currentFrame) {
      var readIdx = this._frameReadPos * C.OPUS_CHANNELS;
      outL[i] = this._currentFrame[readIdx] || 0;
      outR[i] = this._currentFrame[readIdx + 1] || 0;
      this._frameReadPos++;
    }
  }

  return [outL, outR];
};

// --- Opus Decoding ---
// Phase 1: Decode raw int16 PCM (matches Send device MVP)
// Phase 2: Real Opus via WASM

ReceiveDevice.prototype._opusDecode = function(encodedData) {
  // MVP: Convert int16 PCM back to float32
  var int16 = new Int16Array(encodedData.buffer, encodedData.byteOffset, encodedData.length / 2);
  var float32 = new Float32Array(int16.length);
  for (var i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
};

// --- Stats ---

ReceiveDevice.prototype.getStats = function() {
  return {
    trackId: this.trackId,
    enabled: this.enabled,
    bufferSize: this._jitterBuffer.length,
    targetBuffer: this._jitterTarget,
    packetsReceived: this._packetsReceived,
    packetsLost: this._packetsLost,
    underruns: this._bufferUnderruns,
    lossRate: this._packetsReceived > 0
      ? (this._packetsLost / this._packetsReceived * 100).toFixed(2) + '%'
      : '0%'
  };
};

// --- M4L JS Entry Points ---

function init(trackId) {
  receiver = new ReceiveDevice();
  receiver.init(trackId || 0);
}

function audio_in() {
  // Called by Hub when audio packet arrives for this track
  if (receiver) {
    var bytes = new Uint8Array(Array.prototype.slice.call(arguments));
    receiver.receivePacket(bytes);
  }
}

function perform() {
  // M4L audio processing — output decoded audio
  if (receiver && receiver.enabled) {
    var result = receiver.getAudio(64); // typical M4L vector size
    return result;
  }
  return [new Float32Array(64), new Float32Array(64)];
}

function stats() {
  if (receiver) {
    var s = receiver.getStats();
    post('coLaB Recv [track ' + s.trackId + '] buf:' + s.bufferSize +
         '/' + s.targetBuffer + ' loss:' + s.lossRate +
         ' underruns:' + s.underruns + '\n');
  }
}

if (typeof module !== 'undefined') {
  module.exports = ReceiveDevice;
}
