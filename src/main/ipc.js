const { app, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const server = require('./server');

const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'webm'];

let storeRef = null;
let getWin = null;
let onDevicesList = null;
let lastProjectPath = null;

function register(store, winGetter, devicesCallback) {
  storeRef = store;
  getWin = winGetter;
  onDevicesList = devicesCallback || null;

  ipcMain.handle('data:get', () => storeRef.getData());
  ipcMain.handle('data:settings:set', (_e, settings) => {
    const d = storeRef.setSettings(settings || {});
    return { ok: true, settings: d.settings };
  });
  ipcMain.handle('data:ui:set', (_e, ui) => storeRef.setUI(ui || {}));

  ipcMain.handle('playlist:add', (_e, name) => storeRef.addPlaylist(name));
  ipcMain.handle('playlist:rename', (_e, id, name) => storeRef.renamePlaylist(id, name));
  ipcMain.handle('playlist:remove', (_e, id) => storeRef.removePlaylist(id));

  ipcMain.handle('cart:pick-audio', async () => {
    const win = getWin && getWin();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio files', extensions: AUDIO_EXT },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('cart:add', (_e, playlistId, files) => {
    const list = Array.isArray(files) ? files : [];
    for (const f of list) {
      storeRef.addCart(playlistId, f);
    }
    return storeRef.getData();
  });

  ipcMain.handle('cart:update', (_e, id, patch) => storeRef.updateCart(id, patch || {}));
  ipcMain.handle('cart:remove', (_e, id) => storeRef.removeCart(id));
  ipcMain.handle('cart:move', (_e, playlistId, cartId, beforeCartId) =>
    storeRef.moveCart(playlistId, cartId, beforeCartId == null ? null : beforeCartId)
  );

  ipcMain.handle('cart:read-audio', async (_e, id) => {
    const found = storeRef.findCart(id);
    if (!found) return { error: 'Cart not found' };
    try {
      const bytes = await fs.promises.readFile(found.cart.file);
      return { bytes, file: found.cart.file, size: bytes.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('net:info', () => server.getNetworkInfo());
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.on('devices:list', (_e, list) => {
    if (onDevicesList && Array.isArray(list)) onDevicesList(list);
  });

  ipcMain.handle('project:save-as', async () => {
    const win = getWin && getWin();
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Smart Jingle project',
      defaultPath: lastProjectPath || 'smart-jingle-project.smartjingle',
      filters: [{ name: 'Smart Jingle project', extensions: ['smartjingle', 'json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const payload = {
        type: 'smart-jingle-project',
        version: 1,
        savedAt: new Date().toISOString(),
        data: storeRef.getData(),
      };
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      lastProjectPath = result.filePath;
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('project:save', async () => {
    if (!lastProjectPath) return { ok: false, needPath: true };
    try {
      const payload = {
        type: 'smart-jingle-project',
        version: 1,
        savedAt: new Date().toISOString(),
        data: storeRef.getData(),
      };
      fs.writeFileSync(lastProjectPath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: lastProjectPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('project:open', async () => {
    const win = getWin && getWin();
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Smart Jingle project',
      properties: ['openFile'],
      filters: [
        { name: 'Smart Jingle project', extensions: ['smartjingle', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf8');
      const parsed = JSON.parse(raw);
      const data = parsed && parsed.data ? parsed.data : parsed;
      if (!data || typeof data !== 'object' || !Array.isArray(data.playlists)) {
        return { ok: false, error: 'Not a valid Smart Jingle project file' };
      }
      storeRef.replaceData(data);
      lastProjectPath = result.filePaths[0];
      const winObj = getWin && getWin();
      if (winObj && !winObj.isDestroyed()) {
        winObj.webContents.send('remote:command', { cmd: 'project-loaded' });
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('project:new', async () => {
    storeRef.replaceData({});
    const winObj = getWin && getWin();
    if (winObj && !winObj.isDestroyed()) {
      winObj.webContents.send('remote:command', { cmd: 'project-loaded' });
    }
    return { ok: true };
  });

  ipcMain.on('state:update', (_e, state) => {
    server.setState(state);
  });
}

module.exports = { register };
