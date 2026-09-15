const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const companionDir = path.join(root, 'companion');
const outDir = path.join(root, 'release', 'companion');
const pkg = require(path.join(companionDir, 'package.json'));

const manifest = {
  type: 'connection',
  id: 'smartchoice-smart-jingle',
  name: 'SMART-JINGLE - by Nelson Teixeira',
  shortname: 'smart-jingle',
  description:
    'Control Smart Jingle playout (jingle carts, GO/PAUSE/RESET/STOP ALL transport, playlists) - by Nelson Teixeira',
  version: pkg.version,
  license: 'UNLICENSED',
  repository: 'https://github.com/sharillas/Smart-Jingle',
  bugs: 'https://github.com/sharillas/Smart-Jingle/issues',
  maintainers: [{ name: 'Nelson Teixeira' }],
  legacyIds: ['smart-jingle'],
  runtime: { type: 'node22', api: 'nodejs-ipc', apiVersion: '1.0.0', entrypoint: 'index.js' },
  manufacturer: 'Smartchoice',
  products: ['SMART-JINGLE - by Nelson Teixeira'],
  keywords: ['audio', 'jingles', 'playout', 'cart', 'radio', 'sound'],
};

try {
  const { validateManifest } = require(path.join(companionDir, 'node_modules', '@companion-module', 'base'));
  validateManifest(manifest, false);
  console.log('Manifest validated against @companion-module/base (Companion validator)');
} catch (e) {
  console.error('Manifest validation FAILED:', e.message);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.tgz')) fs.unlinkSync(path.join(outDir, f));
}

const rootDirName = `${manifest.id}-${manifest.version}`;
const stagingParent = path.join(root, 'release', '.companion-staging');
const stagingDir = path.join(stagingParent, rootDirName);
fs.rmSync(stagingParent, { recursive: true, force: true });
fs.mkdirSync(path.join(stagingDir, 'companion'), { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'src'), { recursive: true });

fs.copyFileSync(path.join(companionDir, 'index.js'), path.join(stagingDir, 'index.js'));
fs.copyFileSync(path.join(companionDir, 'src', 'main.js'), path.join(stagingDir, 'src', 'main.js'));
fs.copyFileSync(path.join(companionDir, 'README.md'), path.join(stagingDir, 'README.md'));
fs.copyFileSync(path.join(companionDir, 'LICENSE'), path.join(stagingDir, 'LICENSE'));
fs.writeFileSync(path.join(stagingDir, 'companion', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const outName = `Companion module Smart Jingle (v${pkg.version}).tgz`;
const outPath = path.join(outDir, outName);

execFileSync('tar', ['-czf', outPath, rootDirName], { cwd: stagingParent, stdio: 'inherit' });

fs.rmSync(stagingParent, { recursive: true, force: true });

console.log('Companion module packed: release/companion/' + outName);
