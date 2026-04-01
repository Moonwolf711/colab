// Run this on 192.168.0.83 to receive coLaB packets
// Usage: node peer-server.js

var TcpStack = require("../js/hub/tcp-stack");
var C = require("../js/shared/constants");

var PORT = 19090;
var server = new TcpStack({ port: PORT, sendBufferSize: 64 * 1024 });

server.on("state", function(p) {
  var type = p[0] === C.PKT.STATE_UPDATE ? "STATE" : p[0] === C.PKT.CURSOR_UPDATE ? "CURSOR" : "0x" + p[0].toString(16);
  console.log("[RECV] " + type + " seq=" + p.readUInt32LE(1) + " (" + p.length + " bytes)");
});
server.on("cursor", function(p) {
  console.log("[RECV] CURSOR track=" + p[5] + " scene=" + p[6] + " editing=" + (p[7]===1));
});
server.on("asset_manifest", function(p) {
  var m = JSON.parse(p.toString("utf8"));
  console.log("[RECV] MANIFEST — " + m.files.length + " files, " + (m.plugins||[]).length + " plugins");
});
server.on("asset_transfer", function(p) {
  var pathLen = p.readUInt16LE(0);
  var path = p.slice(2, 2 + pathLen).toString("utf8");
  var dataLen = p.length - 2 - pathLen;
  console.log("[RECV] FILE \"" + path + "\" — " + dataLen + " bytes");
});
server.on("rtt", function(ms) { console.log("[RTT] " + ms + "ms"); });
server.on("connect", function(info) { console.log("[CONNECTED] " + info.address + ":" + info.port); });
server.on("disconnect", function(r) { console.log("[DISCONNECTED] " + r); });

server.listen(PORT, function(err) {
  if (err) { console.log("FAIL: " + err); process.exit(1); }
  console.log("coLaB peer server listening on 0.0.0.0:" + PORT);
  console.log("Waiting for packets from 192.168.0.3...");
});
