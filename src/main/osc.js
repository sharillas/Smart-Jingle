const osc = require('osc');

let udpPort = null;
let storeRef = null;
let sendCmd = null;
let currentPort = 4410;

function routeMessage(msg) {
  try {
    const address = String(msg.address || '');
    const args = (msg.args || []).map((a) => a.value);
    const on = args.length ? args[0] : 1;

    let m;
    if ((m = /^\/jingle\/(.+)$/.exec(address))) {
      if (on) sendCmd({ cmd: 'play', cartId: decodeURIComponent(m[1]) });
      else sendCmd({ cmd: 'stop', cartId: decodeURIComponent(m[1]) });
      return;
    }
    if ((m = /^\/transport\/(go|pause|reset|stop-all|loop-playlist)$/.exec(address))) {
      if (on) sendCmd({ cmd: m[1] });
      return;
    }
    if ((m = /^\/playlist\/(.+)$/.exec(address))) {
      if (on) sendCmd({ cmd: 'activate-playlist', playlistId: decodeURIComponent(m[1]) });
      return;
    }
  } catch (e) {
    /* ignore */
  }
}

function start(store, sender) {
  storeRef = store;
  sendCmd = sender;
  const settings = storeRef.getData().settings;
  if (settings.oscEnabled === true) {
    startListening();
  } else {
    console.log('OSC: disabled in settings');
  }
}

function startListening() {
  const settings = storeRef.getData().settings;
  currentPort = settings.oscPort || 4410;
  if (udpPort) return;
  udpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: currentPort,
    metadata: true,
  });
  udpPort.on('message', routeMessage);
  udpPort.on('error', (err) => {
    console.error('OSC: error', err.message);
  });
  udpPort.open();
  console.log(`OSC: listening on UDP port ${currentPort} (/jingle/:id, /transport/:cmd, /playlist/:id)`);
}

function stopListening() {
  try {
    if (udpPort) {
      udpPort.close();
      udpPort = null;
    }
  } catch (e) {
    /* ignore */
  }
}

function setEnabled(enabled) {
  storeRef.setSettings({ oscEnabled: !!enabled });
  if (enabled) startListening();
  else stopListening();
}

function restart() {
  stopListening();
  const settings = storeRef.getData().settings;
  if (settings.oscEnabled === true) startListening();
}

function stop() {
  stopListening();
}

module.exports = { start, stop, setEnabled, restart };
