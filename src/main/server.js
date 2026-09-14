const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer } = require('ws');

let storeRef = null;
let appVersion = '0.1.1';
let getWin = null;
let server = null;
let wss = null;
let stateCache = null;
let stateListeners = [];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS));
  res.end(body);
}

function sendCommand(cmd) {
  const win = getWin && getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send('remote:command', cmd);
  }
}

function notifyStateListeners() {
  for (const fn of stateListeners) {
    try {
      fn(stateCache);
    } catch (e) {
      /* ignore */
    }
  }
}

function setState(state) {
  stateCache = state;
  broadcast(JSON.stringify({ type: 'state', payload: state }));
  notifyStateListeners();
}

function broadcast(text) {
  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(text);
  }
}

function route(req, res, method, urlPath) {
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (method === 'GET') {
    if (urlPath === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'remote.html'), 'utf8'));
      return;
    }
    if (urlPath === '/api/state') {
      json(res, 200, stateCache || buildEmptyState());
      return;
    }
    if (urlPath === '/api/info') {
      json(res, 200, {
        app: 'Smart Jingle',
        version: appVersion,
        by: 'Nelson Teixeira',
      });
      return;
    }
  }

  if (method === 'POST') {
    let m;
    if ((m = /^\/api\/jingles\/([^/]+)\/play$/.exec(urlPath))) {
      sendCommand({ cmd: 'play', cartId: decodeURIComponent(m[1]) });
      json(res, 200, { ok: true });
      return;
    }
    if ((m = /^\/api\/jingles\/([^/]+)\/stop$/.exec(urlPath))) {
      sendCommand({ cmd: 'stop', cartId: decodeURIComponent(m[1]) });
      json(res, 200, { ok: true });
      return;
    }
    if ((m = /^\/api\/transport\/(go|pause|reset|stop-all)$/.exec(urlPath))) {
      sendCommand({ cmd: m[1] });
      json(res, 200, { ok: true });
      return;
    }
    if ((m = /^\/api\/playlists\/([^/]+)\/activate$/.exec(urlPath))) {
      sendCommand({ cmd: 'activate-playlist', playlistId: decodeURIComponent(m[1]) });
      json(res, 200, { ok: true });
      return;
    }
    if (urlPath === '/api/stop-all') {
      sendCommand({ cmd: 'stop-all' });
      json(res, 200, { ok: true });
      return;
    }
  }

  json(res, 404, { error: 'Not found' });
}

function buildEmptyState() {
  const base = storeRef ? storeRef.publicState() : { playlists: [], carts: [] };
  return Object.assign(base, {
    paused: false,
    selectedCartId: null,
    activePlaylistId: null,
    playing: [],
  });
}

function getNetworkInfo() {
  const settings = storeRef ? storeRef.getData().settings : { port: 4405 };
  const interfaces = [];
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const info of os.networkInterfaces()[name] || []) {
      if (!info.internal && info.family === 'IPv4') {
        interfaces.push({
          interface: name,
          address: info.address,
          url: `http://${info.address}:${settings.port}`,
        });
      }
    }
  }
  return {
    enabled: settings.remoteEnabled !== false,
    port: settings.port,
    url: `http://127.0.0.1:${settings.port}`,
    interfaces,
  };
}

function start(store, version, winGetter, onState) {
  storeRef = store;
  appVersion = version;
  getWin = winGetter;

  const settings = storeRef.getData().settings;
  const port = settings.port || 4405;
  const enabled = settings.remoteEnabled !== false;

  server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    route(req, res, req.method, u.pathname);
  });

  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', payload: stateCache || buildEmptyState() }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'trigger_jingle' && msg.cartId) {
          sendCommand({ cmd: 'play', cartId: msg.cartId });
        } else if (msg.action === 'stop_jingle' && msg.cartId) {
          sendCommand({ cmd: 'stop', cartId: msg.cartId });
        } else if (msg.action === 'transport' && ['go', 'pause', 'reset', 'stop-all'].includes(msg.command)) {
          sendCommand({ cmd: msg.command });
        } else if (msg.action === 'activate_playlist' && msg.playlistId) {
          sendCommand({ cmd: 'activate-playlist', playlistId: msg.playlistId });
        }
      } catch {
        /* ignore malformed */
      }
    });
  });

  server.on('error', (err) => {
    console.error('SERVER: error', err.message);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`SERVER: Smart Jingle API listening on http://0.0.0.0:${port}`);
  });

  stateListeners.push(onState);
}

function stop() {
  try {
    if (wss) wss.close();
    if (server) server.close();
  } catch {
    /* ignore */
  }
}

module.exports = {
  start,
  stop,
  setState,
  getNetworkInfo,
  onStateChange: (fn) => stateListeners.push(fn),
};
