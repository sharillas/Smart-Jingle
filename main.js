const { app, BrowserWindow, Menu, dialog, protocol, shell, session, globalShortcut } = require('electron');
const path = require('node:path');
const store = require('./src/main/store');
const media = require('./src/main/media');
const server = require('./src/main/server');
const ipc = require('./src/main/ipc');
const oscServer = require('./src/main/osc');

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
let audioDevices = [];

const isSmoke = process.env.SMART_JINGLE_SMOKE === '1';

const MENU_T = {
  en: {
    file: 'File',
    add_files: 'Add Jingle Files…',
    new_playlist: 'New Playlist',
    new_project: 'New Project',
    open_project: 'Open Project…',
    save_project: 'Save Project',
    save_project_as: 'Save Project As…',
    reveal: 'Reveal Data File',
    settings: 'Settings',
    open_settings: 'Open Settings…',
    remote_info: 'Remote / API Info…',
    audio_device: 'Audio Output Device',
    remote_enabled: 'Remote Server Enabled',
    language: 'Language',
    help: 'Help',
    check_updates: 'Check for Updates…',
    github: 'GitHub Repository',
    open_remote: 'Open Remote Page',
  },
  pt: {
    file: 'Ficheiro',
    add_files: 'Adicionar Jingles…',
    new_playlist: 'Nova Lista',
    new_project: 'Novo Projeto',
    open_project: 'Abrir Projeto…',
    save_project: 'Guardar Projeto',
    save_project_as: 'Guardar Projeto Como…',
    reveal: 'Mostrar Ficheiro de Dados',
    settings: 'Definições',
    open_settings: 'Abrir Definições…',
    remote_info: 'Informação Remota / API…',
    audio_device: 'Dispositivo de Saída de Áudio',
    remote_enabled: 'Servidor Remoto Ativado',
    language: 'Idioma',
    help: 'Ajuda',
    check_updates: 'Verificar Atualizações…',
    github: 'Repositório GitHub',
    open_remote: 'Abrir Página Remota',
  },
  fr: {
    file: 'Fichier',
    add_files: 'Ajouter des jingles…',
    new_playlist: 'Nouvelle liste',
    new_project: 'Nouveau projet',
    open_project: 'Ouvrir un projet…',
    save_project: 'Enregistrer le projet',
    save_project_as: 'Enregistrer sous…',
    reveal: 'Afficher le fichier de données',
    settings: 'Paramètres',
    open_settings: 'Ouvrir les paramètres…',
    remote_info: 'Infos API / à distance…',
    audio_device: 'Périphérique de sortie audio',
    remote_enabled: 'Serveur distant activé',
    language: 'Langue',
    help: 'Aide',
    check_updates: 'Vérifier les mises à jour…',
    github: 'Dépôt GitHub',
    open_remote: 'Ouvrir la page distante',
  },
};

function mt(key) {
  const lang = store.getData().settings.language || 'en';
  const dict = MENU_T[lang] || MENU_T.en;
  return dict[key] || MENU_T.en[key] || key;
}

function setLanguage(lang) {
  store.setSettings({ language: lang });
  sendToRenderer({ cmd: 'language-changed', language: lang });
  buildMenu();
}

function registerGlobalHotkeys() {
  globalShortcut.unregisterAll();
  const data = store.getData();
  const pl = data.playlists.find((p) => p.id === data.ui.activePlaylistId) || data.playlists[0];
  if (!pl) return;
  for (const cart of pl.carts) {
    const hk = cart.hotkey;
    if (!hk) continue;
    let accelerator = null;
    if (/^F([1-9]|1[0-2])$/.test(hk)) accelerator = hk;
    else if (/^[0-9]$/.test(hk)) accelerator = hk;
    else if (/^[A-Z]$/.test(hk)) accelerator = 'CommandOrControl+Alt+' + hk;
    if (!accelerator) continue;
    try {
      const ok = globalShortcut.register(accelerator, () => {
        sendToRenderer({ cmd: 'global-hotkey', hotkey: hk });
      });
      if (!ok) console.log('SHORTCUT: failed to register', accelerator);
    } catch (e) {
      /* ignore */
    }
  }
}

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
    icon: path.join(__dirname, 'assets', 'icon-black.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log('RENDERER:', message);
  });

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

function semverGt(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdates(manual) {
  try {
    const res = await fetch('https://api.github.com/repos/sharillas/Smart-Jingle/releases/latest', {
      headers: { 'User-Agent': 'smart-jingle', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const tag = String(json.tag_name || '').replace(/^v/, '');
    if (!tag || !/\d+\.\d+/.test(tag)) return;
    if (semverGt(tag, app.getVersion())) {
      console.log('UPDATE: newer version available v' + tag);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:available', { version: tag, url: json.html_url });
      }
    } else if (manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:none', {});
    }
  } catch (e) {
    console.error('UPDATE: check failed', e.message);
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:none', {});
    }
  }
}

function sendToRenderer(cmd) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remote:command', cmd);
  }
}

function showRemoteInfoDialog() {
  const info = server.getNetworkInfo();
  const lines = info.interfaces.map((i) => i.url).join('\n');
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Smart Jingle — Remote API',
      message: 'Remote API (port ' + info.port + ')',
      detail:
        (info.enabled ? 'Server: ENABLED\n' : 'Server: DISABLED\n') +
        'Local: ' + info.url + '\n\nNetwork:\n' + (lines || '  (none found)') + '\n\nTablets/PCs open one of these URLs.\nCompanion connects to the IP with this port.',
      buttons: ['Copy local URL', 'OK'],
      defaultId: 1,
      cancelId: 1,
    })
    .then((r) => {
      if (r.response === 0) {
        require('electron').clipboard.writeText(info.url);
      }
    })
    .catch(() => {});
}

function toggleRemoteServer(enabled) {
  store.setSettings({ remoteEnabled: !!enabled });
  server.setEnabled(!!enabled);
  buildMenu();
}

function setOutputDevice(deviceId) {
  store.setSettings({ outputDeviceId: deviceId || 'default' });
  sendToRenderer({ cmd: 'set-device', deviceId: deviceId || 'default' });
  buildMenu();
}

function buildMenu() {
  const settings = store.getData().settings;
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
      label: mt('file'),
      submenu: [
        {
          label: mt('add_files'),
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('remote:command', { cmd: 'add-files' });
          },
        },
        {
          label: mt('new_playlist'),
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('remote:command', { cmd: 'new-playlist' });
          },
        },
        { type: 'separator' },
        {
          label: mt('new_project'),
          click: async () => {
            const r = await ipc.newProject();
            if (!r.ok) console.error('PROJECT: new failed');
          },
        },
        {
          label: mt('open_project'),
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const r = await ipc.openProject();
            if (r.ok) console.log('PROJECT: opened', r.path);
            else if (r.error) dialog.showErrorBox('Open project', r.error);
          },
        },
        {
          label: mt('save_project'),
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            const r = await ipc.saveProject();
            if (r.needPath) {
              const r2 = await ipc.saveProjectAs();
              if (r2.ok) console.log('PROJECT: saved', r2.path);
            } else if (r.ok) console.log('PROJECT: saved', r.path);
            else if (r.error) dialog.showErrorBox('Save project', r.error);
          },
        },
        {
          label: mt('save_project_as'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            const r = await ipc.saveProjectAs();
            if (r.ok) console.log('PROJECT: saved', r.path);
            else if (r.error) dialog.showErrorBox('Save project', r.error);
          },
        },
        { type: 'separator' },
        {
          label: mt('reveal'),
          click: () => {
            shell.showItemInFolder(store.getPath());
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: mt('settings'),
      submenu: [
        {
          label: mt('open_settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer({ cmd: 'open-settings' }),
        },
        {
          label: mt('remote_info'),
          click: () => showRemoteInfoDialog(),
        },
        { type: 'separator' },
        {
          label: mt('audio_device'),
          submenu: (audioDevices.length ? audioDevices : [{ id: 'default', label: 'System default' }]).map((d) => ({
            label: d.label,
            type: 'radio',
            checked: d.id === settings.outputDeviceId,
            click: () => setOutputDevice(d.id),
          })),
        },
        {
          label: mt('language'),
          submenu: [
            { label: 'English', type: 'radio', checked: settings.language === 'en', click: () => setLanguage('en') },
            { label: 'Português', type: 'radio', checked: settings.language === 'pt', click: () => setLanguage('pt') },
            { label: 'Français', type: 'radio', checked: settings.language === 'fr', click: () => setLanguage('fr') },
          ],
        },
        { type: 'separator' },
        {
          label: mt('remote_enabled'),
          type: 'checkbox',
          checked: settings.remoteEnabled !== false,
          click: (item) => toggleRemoteServer(item.checked),
        },
        {
          label: 'OSC Server Enabled',
          type: 'checkbox',
          checked: settings.oscEnabled === true,
          click: (item) => {
            oscServer.setEnabled(item.checked);
            buildMenu();
          },
        },
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
      label: mt('help'),
      submenu: [
        {
          label: mt('check_updates'),
          click: () => checkForUpdates(true),
        },
        {
          label: mt('github'),
          click: () => shell.openExternal('https://github.com/sharillas/Smart-Jingle'),
        },
        {
          label: mt('open_remote'),
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
    session.defaultSession.setDevicePermissionHandler((details) => {
      return details.deviceType === 'audiooutput';
    });
  } catch (e) {
    console.warn('Permission handler error:', e);
  }

  store.load(path.join(__dirname, 'assets', 'default-audio'));
  media.register();
  server.start(store, app.getVersion(), () => mainWindow, (state) => (latestState = state));
  oscServer.start(store, (cmd) => sendToRenderer(cmd));
  ipc.register(store, () => mainWindow, (devices) => {
    audioDevices = devices;
    buildMenu();
  }, () => {
    registerGlobalHotkeys();
  }, () => {
    oscServer.restart();
    buildMenu();
  });
  buildMenu();
  registerGlobalHotkeys();
  await createWindow();

  if (process.env.SMART_JINGLE_OPEN_EDITOR === '1') {
    setTimeout(() => sendToRenderer({ cmd: 'edit-cart' }), 2000);
  }

  setTimeout(() => checkForUpdates(false), 4000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);

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
  oscServer.stop();
  globalShortcut.unregisterAll();
});
