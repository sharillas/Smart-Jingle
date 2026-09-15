const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const companionDir = path.join(root, 'companion');
const outDir = path.join(root, 'release', 'companion');
const pkg = require(path.join(companionDir, 'package.json'));

const basePkg = JSON.parse(fs.readFileSync(path.join(companionDir, 'node_modules', '@companion-module', 'base', 'package.json'), 'utf8'));
const apiVersion = basePkg.version;

const manifest = {
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
  runtime: {
    type: 'node22',
    api: 'nodejs-ipc',
    apiVersion,
    entrypoint: '../main.js',
  },
  manufacturer: 'Smartchoice',
  products: ['SMART-JINGLE - by Nelson Teixeira'],
  keywords: ['audio', 'jingles', 'playout', 'cart', 'radio', 'sound'],
};

{
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(apiVersion);
  const supported =
    (m && m[1] === '0' && m[2] === '6') || (m && m[1] === '1' && m[2] === '14') || (m && m[1] === '2' && m[2] === '1');
  if (!supported) {
    console.error(`runtime.apiVersion ${apiVersion} is NOT supported by Companion (supported: ~0.6, 1.14.x, 2.1.x)`);
    process.exit(1);
  }
  console.log('apiVersion ' + apiVersion + ' (from bundled base) is compatible with Companion');
}

console.log('Bundling module with webpack (@companion-module/tools)...');
const webpackJs = path.join(companionDir, 'node_modules', 'webpack', 'bin', 'webpack.js');
const toolsConfig = path.join(companionDir, 'node_modules', '@companion-module', 'tools', 'webpack.config.cjs');
execFileSync(process.execPath, [webpackJs, '-c', toolsConfig, '--output-library-type', 'commonjs2'], {
  cwd: companionDir,
  stdio: 'inherit',
});

const pkgDir = path.join(companionDir, 'pkg');
const manifestDir = path.join(pkgDir, 'companion');
fs.mkdirSync(manifestDir, { recursive: true });
fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(
  path.join(pkgDir, 'package.json'),
  JSON.stringify({ name: manifest.name, version: manifest.version, license: manifest.license, type: 'commonjs', dependencies: {} }, null, 2) + '\n'
);
fs.copyFileSync(path.join(companionDir, 'HELP.md'), path.join(pkgDir, 'HELP.md'));
fs.copyFileSync(path.join(companionDir, 'HELP.md'), path.join(manifestDir, 'HELP.md'));

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.tgz')) fs.unlinkSync(path.join(outDir, f));
}

const outName = `Companion module Smart Jingle (v${pkg.version}).tgz`;
const outPath = path.join(outDir, outName);
execFileSync('tar', ['-czf', outPath, 'pkg'], { cwd: companionDir, stdio: 'inherit' });

fs.rmSync(pkgDir, { recursive: true, force: true });

console.log('Companion module packed: release/companion/' + outName);
