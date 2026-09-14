const { app, BrowserWindow, Menu, dialog, protocol, shell, session } = require('electron');
const path = require('node:path');
const store = require('./src/main/store');
const media = require('./src/main/media');
const server = require('./src/main/server');
const ipc = require('./src/main/ipc');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sj',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow = null;
let latestState = null;
let quitting = false;

const isSmoke = process.env.SMART_JINGLE_SMOKE === '1';

function createWindow() {
  const bounds = store.getData().ui?.windowBounds || null;

  mainWindow = new BrowserWindow({
    width: bounds?.width || 1320,
    height: bounds?.height || 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0e1219',
    title: 'Smart Jingle',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    store.setUI({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        console.log('SMOKE_OK window loaded');
        app.exit(0);
      }, 2500);
    });
  }
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideothers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Jingle Files…',
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('remote:command', { cmd: 'add-files' });
          },
        },
        {
          label: 'New Playlist',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('remote:command', { cmd: 'new-playlist' });
          },
        },
        { type: 'separator' },
        {
          label: 'Reveal Data File',
          click: () => {
            shell.showItemInFolder(store.getPath());
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/sharillas/smart-jingle'),
        },
        {
          label: 'Open Remote Page',
          click: () => {
            const info = server.getNetworkInfo();
            if (info?.url) shell.openExternal(info.url);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  } catch (e) {
    console.warn('Permission handler error:', e);
  }

  store.load();
  media.register();
  server.start(store, app.getVersion(), () => mainWindow, (state) => (latestState = state));
  ipc.register(store, () => mainWindow);
  buildMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  server.stop();
});
