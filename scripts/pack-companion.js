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
  runtime: { type: 'node22', api: 'nodejs-ipc', apiVersion: '2.1.0', entrypoint: 'index.js' },
  manufacturer: 'Smartchoice',
  products: ['SMART-JINGLE - by Nelson Teixeira'],
  keywords: ['audio', 'jingles', 'playout', 'cart', 'radio', 'sound'],
};

const shippedPackageJson = {
  name: 'smart-jingle',
  version: pkg.version,
  description: manifest.description,
  main: 'index.js',
  type: 'commonjs',
  license: 'UNLICENSED',
  dependencies: {
    '@companion-module/base': '^2.1.0',
  },
};

try {
  const { validateManifest } = require(path.join(companionDir, 'node_modules', '@companion-module', 'base', 'dist', 'manifest.js'));
  validateManifest(manifest, false);
  console.log('Manifest validated against @companion-module/base (Companion validator)');
} catch (e) {
  console.error('Manifest validation FAILED:', e.message);
  process.exit(1);
}

try {
  const v = String(manifest.runtime.apiVersion || '');
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  const supported =
    (m && m[1] === '0' && m[2] === '6') || (m && m[1] === '1' && m[2] === '14') || (m && m[1] === '2' && m[2] === '1');
  if (!supported) {
    console.error(
      `runtime.apiVersion ${v} is NOT supported by Companion (supported: ~0.6, 1.14.x, 2.1.x)`
    );
    process.exit(1);
  }
  console.log('apiVersion ' + v + ' is compatible with Companion');
} catch (e) {
  console.error('apiVersion check FAILED:', e.message);
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
fs.writeFileSync(path.join(stagingDir, 'package.json'), JSON.stringify(shippedPackageJson, null, 2) + '\n');
fs.writeFileSync(path.join(stagingDir, 'companion', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

fs.cpSync(path.join(companionDir, 'node_modules'), path.join(stagingDir, 'node_modules'), {
  recursive: true,
  filter: (src) => !src.includes('\\.bin'),
});

console.log('Bundled @companion-module/base', pkg.version, '+ dependencies into module');

const outName = `Companion module Smart Jingle (v${pkg.version}).tgz`;
const outPath = path.join(outDir, outName);

execFileSync('tar', ['-czf', outPath, rootDirName], { cwd: stagingParent, stdio: 'inherit' });

fs.rmSync(stagingParent, { recursive: true, force: true });

console.log('Companion module packed: release/companion/' + outName);
