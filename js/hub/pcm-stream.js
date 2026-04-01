/**
 * coLaB PCM Stream — Raw 48kHz/16-bit audio channel between two peers
 *
 * Streams uncompressed PCM audio from one Ableton track to a partner
 * over the LAN. No codec — bandwidth is cheap on local networks and
 * raw PCM eliminates encode/decode latency entirely.
 *
 * Specifications:
 *   Sample rate:  48000 Hz
 *   Bit depth:    16-bit signed integer (little-endian)
 *   Channels:     1 (mono) or 2 (stereo) per stream
 *   Frame size:   configurable (default 480 samples = 10ms)
 *   Bandwidth:    ~96 KB/s mono, ~192 KB/s stereo per stream
 *   Latency:      frame_size + jitter_buffer depth
 *
 * Wire format per audio frame:
 *   [4 bytes: frame sequence (uint32 LE)]
 *   [2 bytes: channel ID / track index (uint16 LE)]
 *   [1 byte:  stream channels (1=mono, 2=stereo)]
 *   [2 bytes: sample count (uint16 LE)]
 *   [4 bytes: timestamp ms low (uint32 LE)]
 *   [N bytes: PCM samples (int16 LE, interleaved if stereo)]
 *
 * Header: 13 bytes. Payload: sample_count * stream_channels * 2 bytes.
 * Total per 10ms mono frame: 13 + 960 = 973 bytes.
 *
 * Copyright (c) 2026 Tyler Yianacopolus / Moonwolf. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL — coLaB project original IP.
 *
 * @module pcm-stream
 * @version 1.0.0
 * @license PROPRIETARY
 */

var C = require('../shared/constants');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var SAMPLE_RATE = 48000;
var BIT_DEPTH = 16;
var BYTES_PER_SAMPLE = 2;               // 16-bit = 2 bytes
var DEFAULT_FRAME_MS = 10;              // 10ms frames (480 samples @ 48kHz)
var DEFAULT_FRAME_SAMPLES = 480;        // SAMPLE_RATE * DEFAULT_FRAME_MS / 1000
var MIN_FRAME_SAMPLES = 64;             // ~1.3ms
var MAX_FRAME_SAMPLES = 4800;           // 100ms
var AUDIO_HEADER_SIZE = 13;

var DEFAULT_JITTER_FRAMES = 3;          // 30ms @ 10ms frames
var MAX_JITTER_FRAMES = 20;            // 200ms @ 10ms frames
var MIN_JITTER_FRAMES = 1;

// ---------------------------------------------------------------------------
// PcmSender — captures PCM and sends to peer
// ---------------------------------------------------------------------------

/**
 * @param {object} transport - TcpStack or LanTransport instance
 * @param {object} [options]
 * @param {number} [options.frameSamples=480] - Samples per frame
 * @param {number} [options.channels=1] - 1 (mono) or 2 (stereo)
 * @param {number} [options.channelId=0] - Track/channel identifier
 */
function PcmSender(transport, options) {
  options = options || {};

  this._transport = transport;
  this._channelId = options.channelId || 0;
  this._streamChannels = options.channels || 1;
  this._frameSamples = clamp(options.frameSamples || DEFAULT_FRAME_SAMPLES,
                             MIN_FRAME_SAMPLES, MAX_FRAME_SAMPLES);
  this._frameBytes = this._frameSamples * this._streamChannels * BYTES_PER_SAMPLE;
  this._frameMs = (this._frameSamples / SAMPLE_RATE) * 1000;

  // Accumulation buffer — collects samples until a full frame
  this._accumBuf = Buffer.alloc(this._frameBytes);
  this._accumPos = 0;

  // Sequencing
  this._seq = 0;

  // Metering
  this._peakSample = 0;
  this._rmsSum = 0;
  this._rmsSamples = 0;

  // State
  this._active = false;
  this._sendTimer = null;

  // Stats
  this._stats = {
    framesSent: 0,
    bytesSent: 0,
    samplesProcessed: 0,
    overruns: 0,     // frames dropped because transport couldn't keep up
    peakDb: -Infinity
  };
}

/**
 * Start streaming. Call writeSamples() from your audio callback to feed data.
 */
PcmSender.prototype.start = function() {
  this._active = true;
  this._seq = 0;
  this._accumPos = 0;
};

/**
 * Stop streaming.
 */
PcmSender.prototype.stop = function() {
  this._active = false;
  this._accumPos = 0;
};

/**
 * Feed PCM samples into the sender.
 * Call this from your audio processing loop (JACK callback, Max signal vector, etc.)
 *
 * @param {Buffer} pcmData - Raw int16 LE samples (interleaved if stereo)
 * @param {number} [sampleCount] - Number of samples (per channel). Defaults to pcmData.length / (channels * 2)
 */
PcmSender.prototype.writeSamples = function(pcmData, sampleCount) {
  if (!this._active) return;

  var bytesPerFrame = this._frameBytes;
  var totalBytes = sampleCount
    ? sampleCount * this._streamChannels * BYTES_PER_SAMPLE
    : pcmData.length;

  var srcOffset = 0;

  while (srcOffset < totalBytes) {
    var remaining = bytesPerFrame - this._accumPos;
    var available = totalBytes - srcOffset;
    var toCopy = Math.min(remaining, available);

    pcmData.copy(this._accumBuf, this._accumPos, srcOffset, srcOffset + toCopy);
    this._accumPos += toCopy;
    srcOffset += toCopy;

    // Meter the samples
    this._meterChunk(this._accumBuf, this._accumPos - toCopy, toCopy);

    // Full frame accumulated — send it
    if (this._accumPos >= bytesPerFrame) {
      this._sendFrame();
      this._accumPos = 0;
    }
  }
};

/**
 * Generate and push a silent frame. Useful for keeping the stream alive
 * during gaps (muted track, paused transport).
 */
PcmSender.prototype.writeSilence = function() {
  if (!this._active) return;
  this._accumBuf.fill(0);
  this._accumPos = this._frameBytes;
  this._sendFrame();
  this._accumPos = 0;
};

PcmSender.prototype._sendFrame = function() {
  // Build frame header + payload
  var payloadSize = this._frameBytes;
  var buf = Buffer.alloc(AUDIO_HEADER_SIZE + payloadSize);

  // Header
  buf.writeUInt32LE(this._seq++, 0);                // frame sequence
  buf.writeUInt16LE(this._channelId, 4);             // channel/track ID
  buf[6] = this._streamChannels;                     // mono=1, stereo=2
  buf.writeUInt16LE(this._frameSamples, 7);          // sample count
  buf.writeUInt32LE(Date.now() >>> 0, 9);            // timestamp low 32 bits

  // PCM payload
  this._accumBuf.copy(buf, AUDIO_HEADER_SIZE, 0, payloadSize);

  // Send via transport
  var ok;
  if (typeof this._transport.sendAudio === 'function') {
    // TcpStack — sends on CH.AUDIO
    ok = this._transport.sendAudio(buf);
  } else if (typeof this._transport.sendUnreliable === 'function') {
    // LanTransport — fire-and-forget UDP
    ok = this._transport.sendUnreliable(buf);
  } else {
    ok = false;
  }

  if (ok === false) {
    this._stats.overruns++;
  } else {
    this._stats.framesSent++;
    this._stats.bytesSent += AUDIO_HEADER_SIZE + payloadSize;
  }
  this._stats.samplesProcessed += this._frameSamples;
};

PcmSender.prototype._meterChunk = function(buf, offset, length) {
  var count = length / BYTES_PER_SAMPLE;
  for (var i = 0; i < count; i++) {
    var sample = buf.readInt16LE(offset + i * BYTES_PER_SAMPLE);
    var abs = sample < 0 ? -sample : sample;
    if (abs > this._peakSample) this._peakSample = abs;
    this._rmsSum += sample * sample;
    this._rmsSamples++;
  }
};

/**
 * Get current metering values and reset.
 * @returns {{ peakDb: number, rmsDb: number }}
 */
PcmSender.prototype.getMeter = function() {
  var peak = this._peakSample / 32768;
  var rms = this._rmsSamples > 0
    ? Math.sqrt(this._rmsSum / this._rmsSamples) / 32768
    : 0;

  this._peakSample = 0;
  this._rmsSum = 0;
  this._rmsSamples = 0;

  return {
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity
  };
};

PcmSender.prototype.getStats = function() {
  return {
    active: this._active,
    channelId: this._channelId,
    streamChannels: this._streamChannels,
    frameSamples: this._frameSamples,
    frameMs: this._frameMs,
    frameBytes: this._frameBytes,
    bytesPerSec: Math.round(this._frameBytes * (1000 / this._frameMs)),
    counters: this._stats
  };
};

// ---------------------------------------------------------------------------
// PcmReceiver — receives PCM from peer, buffers, outputs
// ---------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {number} [options.jitterFrames=3] - Jitter buffer depth in frames
 * @param {number} [options.frameSamples=480] - Expected frame size
 * @param {number} [options.channels=1] - Expected stream channels
 * @param {number} [options.channelId=0] - Which channel to accept
 */
function PcmReceiver(options) {
  options = options || {};

  this._channelId = options.channelId || 0;
  this._streamChannels = options.channels || 1;
  this._frameSamples = options.frameSamples || DEFAULT_FRAME_SAMPLES;
  this._frameBytes = this._frameSamples * this._streamChannels * BYTES_PER_SAMPLE;
  this._frameMs = (this._frameSamples / SAMPLE_RATE) * 1000;

  // Jitter buffer — ring buffer of frames
  this._jitterDepth = clamp(options.jitterFrames || DEFAULT_JITTER_FRAMES,
                            MIN_JITTER_FRAMES, MAX_JITTER_FRAMES);
  this._ringSize = this._jitterDepth + MAX_JITTER_FRAMES; // extra headroom
  this._ring = new Array(this._ringSize);
  for (var i = 0; i < this._ringSize; i++) {
    this._ring[i] = { seq: -1, data: Buffer.alloc(this._frameBytes), valid: false };
  }
  this._writeIdx = 0;
  this._readIdx = 0;
  this._bufferedFrames = 0;
  this._primed = false;       // wait for jitter buffer to fill before reading

  // Sequence tracking
  this._lastSeq = -1;
  this._expectedSeq = 0;

  // Output buffer — double-buffered for lock-free read
  this._outputBuf = Buffer.alloc(this._frameBytes);
  this._outputReady = false;

  // Metering
  this._peakSample = 0;

  // Stats
  this._stats = {
    framesReceived: 0,
    framesPlayed: 0,
    framesDropped: 0,       // arrived too late (past jitter window)
    framesDuplicate: 0,
    gapsFilled: 0,          // silence inserted for missing frames
    underruns: 0,           // read called with empty buffer
    overruns: 0,            // write overflow (buffer full)
    maxJitter: 0,           // worst observed reorder distance
    bytesReceived: 0
  };

  // Event handlers
  this._onUnderrun = null;
  this._onOverrun = null;
}

/**
 * Feed a received audio frame into the jitter buffer.
 * Called by the transport event handler.
 *
 * @param {Buffer} frameData - Raw frame as received (header + PCM)
 */
PcmReceiver.prototype.receiveFrame = function(frameData) {
  if (frameData.length < AUDIO_HEADER_SIZE) return;

  // Parse header
  var seq = frameData.readUInt32LE(0);
  var channelId = frameData.readUInt16LE(4);
  var channels = frameData[6];
  var sampleCount = frameData.readUInt16LE(7);

  // Filter: only accept our channel
  if (channelId !== this._channelId) return;

  var pcmData = frameData.slice(AUDIO_HEADER_SIZE);
  var expectedBytes = sampleCount * channels * BYTES_PER_SAMPLE;

  if (pcmData.length < expectedBytes) return; // truncated

  this._stats.framesReceived++;
  this._stats.bytesReceived += frameData.length;

  // Detect jitter (how far out of order)
  if (this._lastSeq >= 0) {
    var distance = seq - this._expectedSeq;
    if (distance < 0) distance = -distance;
    if (distance > this._stats.maxJitter) this._stats.maxJitter = distance;
  }
  this._lastSeq = seq;
  this._expectedSeq = seq + 1;

  // Duplicate check
  for (var d = 0; d < this._ringSize; d++) {
    if (this._ring[d].valid && this._ring[d].seq === seq) {
      this._stats.framesDuplicate++;
      return;
    }
  }

  // Write into ring buffer
  if (this._bufferedFrames >= this._ringSize) {
    // Overflow — drop oldest
    this._stats.overruns++;
    this._ring[this._readIdx].valid = false;
    this._readIdx = (this._readIdx + 1) % this._ringSize;
    this._bufferedFrames--;
    if (this._onOverrun) this._onOverrun();
  }

  var slot = this._ring[this._writeIdx];
  slot.seq = seq;
  pcmData.copy(slot.data, 0, 0, Math.min(pcmData.length, this._frameBytes));
  slot.valid = true;
  this._writeIdx = (this._writeIdx + 1) % this._ringSize;
  this._bufferedFrames++;

  // Prime the jitter buffer — don't start reading until we have enough
  if (!this._primed && this._bufferedFrames >= this._jitterDepth) {
    this._primed = true;
  }
};

/**
 * Read one frame of PCM from the jitter buffer.
 * Call this from your audio output callback at the frame rate.
 *
 * @param {Buffer} [destBuf] - Buffer to write into. If null, uses internal buffer.
 * @returns {Buffer|null} The PCM frame, or null on underrun.
 */
PcmReceiver.prototype.readFrame = function(destBuf) {
  var out = destBuf || this._outputBuf;

  // Not primed yet — output silence
  if (!this._primed) {
    out.fill(0, 0, this._frameBytes);
    return out;
  }

  // Read from ring buffer
  if (this._bufferedFrames <= 0) {
    // Underrun — no data available
    this._stats.underruns++;
    out.fill(0, 0, this._frameBytes);
    if (this._onUnderrun) this._onUnderrun();

    // If we've run dry, re-prime
    this._primed = false;
    return out;
  }

  var slot = this._ring[this._readIdx];

  if (!slot.valid) {
    // Gap — insert silence
    this._stats.gapsFilled++;
    out.fill(0, 0, this._frameBytes);
  } else {
    slot.data.copy(out, 0, 0, this._frameBytes);
    slot.valid = false;
    this._stats.framesPlayed++;
  }

  this._readIdx = (this._readIdx + 1) % this._ringSize;
  this._bufferedFrames--;

  // Meter
  for (var i = 0; i < this._frameBytes; i += BYTES_PER_SAMPLE) {
    var s = out.readInt16LE(i);
    var abs = s < 0 ? -s : s;
    if (abs > this._peakSample) this._peakSample = abs;
  }

  return out;
};

/**
 * Get the current buffered latency in milliseconds.
 */
PcmReceiver.prototype.getBufferLatencyMs = function() {
  return this._bufferedFrames * this._frameMs;
};

/**
 * Set jitter buffer depth. Higher = more resilient, more latency.
 * @param {number} frames
 */
PcmReceiver.prototype.setJitterDepth = function(frames) {
  this._jitterDepth = clamp(frames, MIN_JITTER_FRAMES, MAX_JITTER_FRAMES);
};

PcmReceiver.prototype.getMeter = function() {
  var peak = this._peakSample / 32768;
  this._peakSample = 0;
  return {
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity
  };
};

PcmReceiver.prototype.onUnderrun = function(fn) { this._onUnderrun = fn; };
PcmReceiver.prototype.onOverrun = function(fn) { this._onOverrun = fn; };

PcmReceiver.prototype.reset = function() {
  for (var i = 0; i < this._ringSize; i++) {
    this._ring[i].valid = false;
    this._ring[i].seq = -1;
  }
  this._writeIdx = 0;
  this._readIdx = 0;
  this._bufferedFrames = 0;
  this._primed = false;
  this._lastSeq = -1;
  this._expectedSeq = 0;
};

PcmReceiver.prototype.getStats = function() {
  return {
    channelId: this._channelId,
    streamChannels: this._streamChannels,
    frameSamples: this._frameSamples,
    frameMs: this._frameMs,
    jitterDepth: this._jitterDepth,
    bufferedFrames: this._bufferedFrames,
    bufferLatencyMs: this.getBufferLatencyMs(),
    primed: this._primed,
    counters: this._stats
  };
};

// ---------------------------------------------------------------------------
// PcmChannel — paired sender + receiver for a single audio channel
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: one send stream + one receive stream for a track.
 *
 * @param {object} transport - TcpStack or LanTransport
 * @param {object} [options]
 * @param {number} [options.channelId=0]
 * @param {number} [options.channels=1] - 1=mono, 2=stereo
 * @param {number} [options.frameSamples=480]
 * @param {number} [options.jitterFrames=3]
 */
function PcmChannel(transport, options) {
  options = options || {};

  this.channelId = options.channelId || 0;
  this.sender = new PcmSender(transport, options);
  this.receiver = new PcmReceiver(options);

  // Wire transport audio events to receiver
  var self = this;
  if (typeof transport.on === 'function') {
    transport.on('audio', function(data) {
      self.receiver.receiveFrame(data);
    });
  }

  // Read timer — pulls frames from jitter buffer at the frame rate
  this._readTimer = null;
  this._outputCallback = null;
}

/**
 * Start sending audio. Feed with writeSamples().
 */
PcmChannel.prototype.startSending = function() {
  this.sender.start();
};

/**
 * Stop sending audio.
 */
PcmChannel.prototype.stopSending = function() {
  this.sender.stop();
};

/**
 * Start pulling audio from the jitter buffer and calling the output callback.
 * @param {function} callback - Called every frame with (pcmBuffer, sampleCount, channels)
 */
PcmChannel.prototype.startReceiving = function(callback) {
  this._outputCallback = callback;
  var self = this;
  var frameMs = this.receiver._frameMs;

  // Pull at the frame rate
  this._readTimer = setInterval(function() {
    var buf = self.receiver.readFrame();
    if (buf && self._outputCallback) {
      self._outputCallback(buf, self.receiver._frameSamples, self.receiver._streamChannels);
    }
  }, frameMs);
};

/**
 * Stop receiving.
 */
PcmChannel.prototype.stopReceiving = function() {
  if (this._readTimer) {
    clearInterval(this._readTimer);
    this._readTimer = null;
  }
  this._outputCallback = null;
};

/**
 * Write PCM samples to send to peer.
 */
PcmChannel.prototype.writeSamples = function(pcmData, sampleCount) {
  this.sender.writeSamples(pcmData, sampleCount);
};

PcmChannel.prototype.destroy = function() {
  this.stopSending();
  this.stopReceiving();
  this.receiver.reset();
};

PcmChannel.prototype.getStats = function() {
  return {
    channelId: this.channelId,
    sender: this.sender.getStats(),
    receiver: this.receiver.getStats()
  };
};

// ---------------------------------------------------------------------------
// PcmMixer — manages multiple channels, mixes received audio to output
// ---------------------------------------------------------------------------

/**
 * @param {object} transport
 * @param {object} [options]
 * @param {number} [options.maxChannels=16]
 * @param {number} [options.frameSamples=480]
 * @param {number} [options.jitterFrames=3]
 */
function PcmMixer(transport, options) {
  options = options || {};

  this._transport = transport;
  this._frameSamples = options.frameSamples || DEFAULT_FRAME_SAMPLES;
  this._jitterFrames = options.jitterFrames || DEFAULT_JITTER_FRAMES;
  this._maxChannels = options.maxChannels || 16;

  this._channels = {};    // channelId → PcmReceiver
  this._mixBuf = null;    // float mix buffer
  this._outputBuf = null; // int16 output
  this._tempBuf = null;   // per-channel read buffer

  // Wire transport
  var self = this;
  if (typeof transport.on === 'function') {
    transport.on('audio', function(data) {
      self._routeAudio(data);
    });
  }
}

/**
 * Add a receive channel.
 * @param {number} channelId
 * @param {number} [channels=1] - mono or stereo
 */
PcmMixer.prototype.addChannel = function(channelId, channels) {
  if (this._channels[channelId]) return this._channels[channelId];

  var rx = new PcmReceiver({
    channelId: channelId,
    channels: channels || 1,
    frameSamples: this._frameSamples,
    jitterFrames: this._jitterFrames
  });

  this._channels[channelId] = rx;
  return rx;
};

PcmMixer.prototype.removeChannel = function(channelId) {
  if (this._channels[channelId]) {
    this._channels[channelId].reset();
    delete this._channels[channelId];
  }
};

PcmMixer.prototype._routeAudio = function(frameData) {
  if (frameData.length < AUDIO_HEADER_SIZE) return;
  var channelId = frameData.readUInt16LE(4);

  // Auto-create channel if not present
  if (!this._channels[channelId]) {
    var channels = frameData[6];
    if (Object.keys(this._channels).length >= this._maxChannels) return;
    this.addChannel(channelId, channels);
  }

  this._channels[channelId].receiveFrame(frameData);
};

/**
 * Mix all active receive channels into a single stereo output frame.
 * @returns {Buffer} Interleaved int16 LE stereo PCM (frameSamples * 4 bytes)
 */
PcmMixer.prototype.mixDown = function() {
  var outSamples = this._frameSamples * 2; // stereo output
  var outBytes = outSamples * BYTES_PER_SAMPLE;

  if (!this._mixBuf || this._mixBuf.length !== outSamples) {
    this._mixBuf = new Float32Array(outSamples);
  }
  if (!this._outputBuf || this._outputBuf.length !== outBytes) {
    this._outputBuf = Buffer.alloc(outBytes);
  }

  // Zero the mix buffer
  for (var z = 0; z < outSamples; z++) this._mixBuf[z] = 0;

  var ids = Object.keys(this._channels);
  for (var c = 0; c < ids.length; c++) {
    var rx = this._channels[ids[c]];
    var frame = rx.readFrame();
    if (!frame) continue;

    var srcChannels = rx._streamChannels;
    for (var s = 0; s < this._frameSamples; s++) {
      if (srcChannels === 2) {
        // Stereo — direct to L/R
        this._mixBuf[s * 2] += frame.readInt16LE(s * 4) / 32768;
        this._mixBuf[s * 2 + 1] += frame.readInt16LE(s * 4 + 2) / 32768;
      } else {
        // Mono — center pan (equal to both L and R)
        var mono = frame.readInt16LE(s * 2) / 32768;
        this._mixBuf[s * 2] += mono;
        this._mixBuf[s * 2 + 1] += mono;
      }
    }
  }

  // Clamp and convert back to int16
  for (var o = 0; o < outSamples; o++) {
    var clamped = this._mixBuf[o];
    if (clamped > 1.0) clamped = 1.0;
    if (clamped < -1.0) clamped = -1.0;
    this._outputBuf.writeInt16LE(Math.round(clamped * 32767), o * BYTES_PER_SAMPLE);
  }

  return this._outputBuf;
};

PcmMixer.prototype.getStats = function() {
  var channels = {};
  var ids = Object.keys(this._channels);
  for (var i = 0; i < ids.length; i++) {
    channels[ids[i]] = this._channels[ids[i]].getStats();
  }
  return {
    channelCount: ids.length,
    frameSamples: this._frameSamples,
    channels: channels
  };
};

PcmMixer.prototype.destroy = function() {
  var ids = Object.keys(this._channels);
  for (var i = 0; i < ids.length; i++) {
    this._channels[ids[i]].reset();
  }
  this._channels = {};
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PcmSender: PcmSender,
  PcmReceiver: PcmReceiver,
  PcmChannel: PcmChannel,
  PcmMixer: PcmMixer,

  // Constants
  SAMPLE_RATE: SAMPLE_RATE,
  BIT_DEPTH: BIT_DEPTH,
  BYTES_PER_SAMPLE: BYTES_PER_SAMPLE,
  AUDIO_HEADER_SIZE: AUDIO_HEADER_SIZE,
  DEFAULT_FRAME_SAMPLES: DEFAULT_FRAME_SAMPLES,
  DEFAULT_FRAME_MS: DEFAULT_FRAME_MS
};
