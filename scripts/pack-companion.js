const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const companionDir = path.join(root, 'companion');
const outDir = path.join(root, 'release', 'companion');

fs.mkdirSync(outDir, { recursive: true });

const out = execSync('npm pack --pack-destination ' + JSON.stringify(outDir), {
  cwd: companionDir,
  encoding: 'utf8',
});

const filename = out.trim().split(/[\r\n]+/).pop();
console.log('Companion module packed: release/companion/' + filename);
