// coLaB peer server on port 9229 — run on 192.168.0.83
var TcpStack = require("../js/hub/tcp-stack");
var C = require("../js/shared/constants");
var PORT = 9229;
var s = new TcpStack({ port: PORT, sendBufferSize: 65536 });
s.on("state", function(p) {
  var t = p[0] === 17 ? "STATE" : p[0] === 32 ? "CURSOR" : "0x" + p[0].toString(16);
  console.log("[RECV] " + t + " seq=" + p.readUInt32LE(1) + " (" + p.length + " bytes)");
});
s.on("cursor", function(p) {
  console.log("[RECV] CURSOR track=" + p[5] + " scene=" + p[6]);
});
s.on("asset_manifest", function(p) {
  var m = JSON.parse(p.toString("utf8"));
  console.log("[RECV] MANIFEST " + m.files.length + " files, " + (m.plugins || []).length + " plugins");
});
s.on("asset_transfer", function(p) {
  var pl = p.readUInt16LE(0);
  var pa = p.slice(2, 2 + pl).toString("utf8");
  console.log("[RECV] FILE \"" + pa + "\" " + ((p.length - 2 - pl) / 1024).toFixed(0) + "KB");
});
s.on("connect", function(i) { console.log("[CONNECTED] " + i.address + ":" + i.port); });
s.on("disconnect", function(r) { console.log("[DISCONNECTED] " + r); });
s.on("rtt", function(ms) { console.log("[RTT] " + ms + "ms"); });
s.listen(PORT, function(e) {
  if (e) { console.log("FAIL: " + e); process.exit(1); }
  console.log("coLaB peer server on 0.0.0.0:" + PORT);
  console.log("Waiting for packets from 192.168.0.3...");
});
