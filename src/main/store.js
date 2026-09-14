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
      masterVolume: 1,
      outputDeviceId: 'default',
      language: 'en',
    },
    ui: {
      activePlaylistId: null,
      selectedCartId: null,
      cartColumns: 8,
      playlistLoop: false,
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
  ensureCids();
  return data;
}

function ensureCids() {
  const used = new Set();
  let counter = 1;
  let changed = false;
  for (const p of data.playlists) {
    for (const c of p.carts) {
      if (!c.cid) {
        let cid;
        do {
          cid = 'J' + counter++;
        } while (used.has(cid));
        c.cid = cid;
        changed = true;
      }
      used.add(c.cid);
    }
  }
  if (changed) save();
}

function nextCid() {
  const used = new Set();
  for (const p of getData().playlists) {
    for (const c of p.carts) {
      if (c.cid) used.add(c.cid);
    }
  }
  let i = 1;
  while (used.has('J' + i)) i++;
  return 'J' + i;
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
      const pl = { id: id('pl'), name: 'Jingle List', carts };
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

function replaceData(newData) {
  const merged = Object.assign(defaults(), newData || {});
  if (!Array.isArray(merged.playlists)) merged.playlists = [];
  data = merged;
  ensureCids();
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
    cid: nextCid(),
    name,
    file,
    in: 0,
    out: null,
    volume: 1,
    color: null,
    mode: 'once',
    hotkey: null,
  };
  p.carts.push(cart);
  save();
  return getData();
}

function updateCart(cartId, patch) {
  const found = findCart(cartId);
  if (!found) throw new Error('Cart not found');
  const next = Object.assign({}, patch);
  if (next.cid !== undefined) {
    const clean = String(next.cid).trim();
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(clean)) {
      throw new Error('Invalid ID: only letters, numbers and . _ - (max 32 chars)');
    }
    const clash = getData().playlists.some((p) =>
      p.carts.some((c) => c.id !== cartId && c.cid === clean)
    );
    if (clash) throw new Error('ID "' + clean + '" is already used by another jingle');
    next.cid = clean;
  }
  if (next.mode !== undefined && next.mode !== 'once' && next.mode !== 'loop') {
    next.mode = 'once';
  }
  if (next.hotkey !== undefined) {
    if (next.hotkey === null || String(next.hotkey).trim() === '') {
      next.hotkey = null;
    } else {
      next.hotkey = String(next.hotkey);
      for (const p of getData().playlists) {
        for (const c of p.carts) {
          if (c.id !== cartId && c.hotkey === next.hotkey) c.hotkey = null;
        }
      }
    }
  }
  Object.assign(found.cart, next);
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

function moveCart(playlistId, cartId, beforeCartId) {
  const p = findPlaylist(playlistId);
  if (!p) return getData();
  const from = p.carts.findIndex((c) => c.id === cartId);
  if (from === -1) return getData();
  const [cart] = p.carts.splice(from, 1);
  let to = beforeCartId == null ? p.carts.length : p.carts.findIndex((c) => c.id === beforeCartId);
  if (to === -1) to = p.carts.length;
  p.carts.splice(to, 0, cart);
  save();
  return getData();
}

function publicState() {
  const d = getData();
  return {
    app: 'Smart Jingle',
    version: app.getVersion() || '0.2.0',
    playlistLoop: !!d.ui.playlistLoop,
    playlists: d.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      carts: p.carts.length,
    })),
    carts: d.playlists.flatMap((p) =>
      p.carts.map((c) => ({
        id: c.id,
        cid: c.cid || c.id,
        name: c.name,
        playlistId: p.id,
        playlistName: p.name,
        color: c.color,
        in: c.in,
        out: c.out,
        volume: c.volume,
        mode: c.mode || 'once',
        hotkey: c.hotkey || null,
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
  replaceData,
  addPlaylist,
  renamePlaylist,
  removePlaylist,
  addCart,
  updateCart,
  removeCart,
  moveCart,
  findCart,
  findPlaylist,
  publicState,
};
