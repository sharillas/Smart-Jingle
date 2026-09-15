const { fork } = require('node:child_process');
const path = require('node:path');

const companionDir = path.join(__dirname, '..');
const child = fork(path.join(companionDir, 'index.js'), [], {
  cwd: companionDir,
  env: {
    ...process.env,
    MODULE_MANIFEST: 'companion/manifest.json',
    CONNECTION_ID: 'test-conn-1',
    VERIFICATION_TOKEN: 'tok123',
  },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});

let registered = false;
let fields = null;
let initSent = false;

child.stdout.on('data', (d) => console.log('[module]', d.toString().trim()));
child.stderr.on('data', (d) => console.log('[module-err]', d.toString().trim()));

const respond = (msg, payload) => {
  child.send({
    direction: 'response',
    callbackId: msg.callbackId,
    success: true,
    payload: JSON.stringify(payload === undefined ? {} : payload),
  });
};

child.on('message', (msg) => {
  if (msg && msg.direction === 'call') {
    console.log('[host] got call:', msg.name, JSON.stringify(msg.payload).slice(0, 200));
    if (msg.name === 'register') {
      registered = true;
      respond(msg, { connectionId: 'test-conn-1', moduleApiVersion: '1.14.0' });
    } else if (msg.name === 'getConfigFields') {
      setTimeout(() => {
        child.send({
          direction: 'call',
          name: 'getConfigFields',
          payload: JSON.stringify({}),
          callbackId: 999,
        });
      }, 50);
      respond(msg, { fields: [] });
    } else if (msg.name === 'init') {
      respond(msg, { hasHttpHandler: false, newUpgradeIndex: 0 });
    } else if (msg.name === 'updateConfigAndLabel' || msg.name === 'updateConfig') {
      respond(msg, {});
    } else if (msg.name === 'setActionDefinitions' || msg.name === 'setFeedbackDefinitions' || msg.name === 'setPresetDefinitions' || msg.name === 'setVariableDefinitions') {
      // no response needed
    }
  } else if (msg && msg.direction === 'response') {
    if (msg.callbackId === 999) {
      const parsed = JSON.parse(msg.payload);
      fields = parsed.fields;
    }
  }
});

child.on('exit', (code) => {
  console.log('[module] exited with code', code);
  process.exit(1);
});

setTimeout(() => {
  // send init to make the module run
  if (registered) {
    child.send({ direction: 'call', name: 'init', payload: JSON.stringify({ config: { host: '127.0.0.1', port: 4405, pin: '' }, label: 'Smart Jingle', isFirstInit: true, lastUpgradeIndex: 0, secrets: {} }), callbackId: 500 });
    initSent = true;
  }
}, 800);

setTimeout(() => {
  console.log('=== RESULT ===');
  console.log('registered:', registered);
  console.log('initSent:', initSent);
  console.log('configFields:', JSON.stringify(fields));
  child.kill();
  process.exit(registered && fields && fields.length > 0 ? 0 : 1);
}, 4000);
