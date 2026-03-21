// Bundle Yjs for Max for Live JS runtime
// M4L JS doesn't support require() for node_modules,
// so we create a single-file bundle

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'js', 'lib');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Read Yjs source and create a self-contained module
const yjsPath = require.resolve('yjs');
const yjsSource = fs.readFileSync(yjsPath, 'utf8');

// Wrap in a module pattern that works in M4L JS
const bundle = `// Auto-generated Yjs bundle for Max for Live
// Do not edit — run 'node scripts/bundle.js' to regenerate
(function(exports) {
${yjsSource}
})(typeof module !== 'undefined' ? module.exports : (this.Y = {}));
`;

const outPath = path.join(outDir, 'yjs-bundle.js');
fs.writeFileSync(outPath, bundle);
console.log('Bundled Yjs to ' + outPath + ' (' + Math.round(bundle.length / 1024) + 'KB)');
