var fs = require('fs');
var path = require('path');

var src = path.join(process.env.USERPROFILE, 'CoLanew_original.amxd');
var dst = path.join(process.env.USERPROFILE, 'CoLanew_fixed.amxd');

var buf = fs.readFileSync(src);
var jsonStart = buf.indexOf(0x7B); // first '{'
var header = buf.slice(0, jsonStart);
var json = buf.slice(jsonStart).toString('utf8').trim();

// Fix bugs
var fixed = json
  .replace(/192\.163\.0\.83/g, '192.168.0.3')     // IP typo
  .replace(/colab_hub_v4\.js/g, 'colab_hub_v5.js'); // upgrade JS

console.log('Header:', header.length, 'bytes');
console.log('IP fix:', fixed.indexOf('192.163') < 0 ? 'FIXED (192.163->192.168)' : 'FAIL');
console.log('JS fix:', fixed.indexOf('v4.js') < 0 ? 'FIXED (v4->v5)' : 'FAIL');
console.log('udpsend:', fixed.match(/udpsend [0-9.]+ [0-9]+/g));
console.log('connect:', fixed.match(/connect [0-9.]+/g));
console.log('js refs:', fixed.match(/colab_hub_v[0-9]+\.js/g));

var output = Buffer.concat([header, Buffer.from(fixed, 'utf8')]);
fs.writeFileSync(dst, output);
console.log('Written', output.length, 'bytes to', dst);
