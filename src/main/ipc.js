const { ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const server = require('./server');

const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'webm'];

let storeRef = null;
let getWin = null;

function register(store, winGetter) {
  storeRef = store;
  getWin = winGetter;

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

  ipcMain.on('state:update', (_e, state) => {
    server.setState(state);
  });
}

module.exports = { register };
