const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

let dataPath = null;
let data = null;

function defaults() {
  return {
    settings: {
      port: 4405,
      remoteEnabled: true,
    },
    ui: {
      activePlaylistId: null,
      selectedCartId: null,
      cartColumns: 8,
    },
    playlists: [],
  };
}

function getPath() {
  if (!dataPath) {
    dataPath = path.join(app.getPath('userData'), 'smart-jingle-data.json');
  }
  return dataPath;
}

function load(defaultAudioDir) {
  try {
    const raw = fs.readFileSync(getPath(), 'utf8');
    data = Object.assign(defaults(), JSON.parse(raw));
  } catch {
    data = defaults();
    seedDefaults(defaultAudioDir);
    save();
  }
  if (!Array.isArray(data.playlists)) data.playlists = [];
  return data;
}

function seedDefaults(srcDir) {
  if (!srcDir || !fs.existsSync(srcDir)) return;
  const outDir = path.join(app.getPath('userData'), 'default-audio');
  const defaultsList = [
    { file: 'sweeper.wav', name: 'SWEEPER' },
    { file: 'transition.wav', name: 'TRANSITION' },
    { file: 'bed.wav', name: 'BED MUSIC' },
  ];
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const carts = [];
    for (const f of defaultsList) {
      const src = path.join(srcDir, f.file);
      const dst = path.join(outDir, f.file);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
      if (fs.existsSync(dst)) {
        carts.push({ id: id('c'), name: f.name, file: dst, in: 0, out: null, volume: 1, color: null });
      }
    }
    if (carts.length) {
      const pl = { id: id('pl'), name: 'Default Jingles', carts };
      data.playlists.push(pl);
      data.ui.activePlaylistId = pl.id;
    }
  } catch (e) {
    console.error('STORE: seeding default jingles failed', e);
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(getPath()), { recursive: true });
    fs.writeFileSync(getPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('STORE: save failed', e);
  }
  return data;
}

function getData() {
  if (!data) load();
  return data;
}

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

function findPlaylist(playlistId) {
  return getData().playlists.find((p) => p.id === playlistId) || null;
}

function findCart(cartId) {
  for (const p of getData().playlists) {
    const c = p.carts.find((c) => c.id === cartId);
    if (c) return { playlist: p, cart: c };
  }
  return null;
}

function setSettings(patch) {
  Object.assign(getData().settings, patch);
  return save();
}

function setUI(patch) {
  Object.assign(getData().ui, patch);
  save();
  return getData();
}

function addPlaylist(name) {
  const p = { id: id('pl'), name: name || 'New Playlist', carts: [] };
  getData().playlists.push(p);
  if (!getData().ui.activePlaylistId) getData().ui.activePlaylistId = p.id;
  save();
  return getData();
}

function renamePlaylist(playlistId, name) {
  const p = findPlaylist(playlistId);
  if (p && name) p.name = String(name);
  save();
  return getData();
}

function removePlaylist(playlistId) {
  const d = getData();
  d.playlists = d.playlists.filter((p) => p.id !== playlistId);
  if (d.ui.activePlaylistId === playlistId) {
    d.ui.activePlaylistId = d.playlists[0]?.id || null;
  }
  save();
  return d;
}

function addCart(playlistId, file) {
  const p = findPlaylist(playlistId);
  if (!p) throw new Error('Playlist not found');
  const name = path.basename(file, path.extname(file));
  const cart = {
    id: id('c'),
    name,
    file,
    in: 0,
    out: null,
    volume: 1,
    color: null,
  };
  p.carts.push(cart);
  save();
  return getData();
}

function updateCart(cartId, patch) {
  const found = findCart(cartId);
  if (!found) throw new Error('Cart not found');
  Object.assign(found.cart, patch);
  save();
  return getData();
}

function removeCart(cartId) {
  for (const p of getData().playlists) {
    p.carts = p.carts.filter((c) => c.id !== cartId);
  }
  if (getData().ui.selectedCartId === cartId) getData().ui.selectedCartId = null;
  save();
  return getData();
}

function publicState() {
  const d = getData();
  return {
    app: 'Smart Jingle',
    version: app.getVersion() || '0.1.1',
    playlists: d.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      carts: p.carts.length,
    })),
    carts: d.playlists.flatMap((p) =>
      p.carts.map((c) => ({
        id: c.id,
        name: c.name,
        playlistId: p.id,
        playlistName: p.name,
        color: c.color,
        in: c.in,
        out: c.out,
        volume: c.volume,
      }))
    ),
  };
}

module.exports = {
  getPath,
  load,
  save,
  getData,
  setSettings,
  setUI,
  addPlaylist,
  renamePlaylist,
  removePlaylist,
  addCart,
  updateCart,
  removeCart,
  findCart,
  findPlaylist,
  publicState,
};
