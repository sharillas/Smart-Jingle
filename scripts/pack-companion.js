const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const companionDir = path.join(root, 'companion');
const outDir = path.join(root, 'release', 'companion');
const pkg = require(path.join(companionDir, 'package.json'));

fs.mkdirSync(outDir, { recursive: true });

for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.tgz')) fs.unlinkSync(path.join(outDir, f));
}

const outName = `Companion module Smart Jingle (v${pkg.version}).tgz`;
const outPath = path.join(outDir, outName);

const files = ['index.js', 'src', 'package.json', 'README.md', 'LICENSE'];

execFileSync('tar', ['-czf', outPath, ...files], { cwd: companionDir, stdio: 'inherit' });

console.log('Companion module packed: release/companion/' + outName);
