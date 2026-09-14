const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('sjapi', {
  getData: () => ipcRenderer.invoke('data:get'),
  setSettings: (settings) => ipcRenderer.invoke('data:settings:set', settings),
  setUI: (ui) => ipcRenderer.invoke('data:ui:set', ui),

  addPlaylist: (name) => ipcRenderer.invoke('playlist:add', name),
  renamePlaylist: (id, name) => ipcRenderer.invoke('playlist:rename', id, name),
  removePlaylist: (id) => ipcRenderer.invoke('playlist:remove', id),

  pickAudio: () => ipcRenderer.invoke('cart:pick-audio'),
  addCarts: (playlistId, files) => ipcRenderer.invoke('cart:add', playlistId, files),
  updateCart: (id, patch) => ipcRenderer.invoke('cart:update', id, patch),
  removeCart: (id) => ipcRenderer.invoke('cart:remove', id),
  readCartAudio: (id) => ipcRenderer.invoke('cart:read-audio', id),

  getNetwork: () => ipcRenderer.invoke('net:info'),
  sendState: (state) => ipcRenderer.send('state:update', state),
  onRemoteCommand: (cb) => {
    ipcRenderer.on('remote:command', (_e, cmd) => cb(cmd));
  },
  audioUrl: (file) => 'sj://media/' + encodeURIComponent(file),
  onDropPaths: (cb) => {
    document.addEventListener('sj-drop', (e) => cb(e.detail.paths));
  },
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files]
    .map((f) => {
      try {
        return webUtils.getPathForFile(f);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (paths.length) {
    document.dispatchEvent(new CustomEvent('sj-drop', { detail: { paths } }));
  }
});
