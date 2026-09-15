const SmartJingle = require('../index.js');

const captured = { structure: null, presets: null, actions: null, feedbacks: null, variables: null, statuses: [], variableValues: {} };

const noop = () => {};
const fakeContext = {
  _isInstanceContext: true,
  id: 'test-instance',
  label: 'Smart Jingle',
  upgradeScripts: [],
  saveConfig: noop,
  updateStatus: (status, message) => captured.statuses.push([status, message]),
  oscSend: noop,
  recordAction: noop,
  setActionDefinitions: (a) => (captured.actions = a),
  subscribeActions: noop,
  unsubscribeActions: noop,
  setFeedbackDefinitions: (f) => (captured.feedbacks = f),
  unsubscribeFeedbacks: noop,
  checkFeedbacks: noop,
  checkAllFeedbacks: noop,
  checkFeedbacksById: noop,
  setPresetDefinitions: (structure, presets) => {
    captured.structure = structure;
    captured.presets = presets;
  },
  setCompositeElementDefinitions: noop,
  setVariableDefinitions: (v) => (captured.variables = v),
  setVariableValues: (values) => Object.assign(captured.variableValues, values),
  getVariableValue: () => undefined,
  sharedUdpSocketHandlers: new Map(),
  sharedUdpSocketJoin: async () => '',
  sharedUdpSocketLeave: async () => {},
  sharedUdpSocketSend: async () => {},
};

(async () => {
  const inst = new SmartJingle(fakeContext);
  await inst.init({ host: '127.0.0.1', port: 4405, pin: '' }, true, {});
  await new Promise((r) => setTimeout(r, 1500));

  console.log('jingles discovered:', inst.jingles.length);
  console.log('connected:', inst.connected);
  console.log('action ids:', Object.keys(captured.actions || {}).join(', '));
  console.log('feedback ids:', Object.keys(captured.feedbacks || {}).join(', '));
  console.log('variables is object:', captured.variables && !Array.isArray(captured.variables), 'count:', Object.keys(captured.variables || {}).length);
  console.log('preset sections:', (captured.structure || []).map((s) => s.id + '[' + s.definitions.length + ']').join(', '));
  console.log('preset count:', Object.keys(captured.presets || {}).length);
  console.log('preset ids:', Object.keys(captured.presets || {}).join(', '));

  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  for (const [pid, p] of Object.entries(captured.presets || {})) {
    check(p.type === 'simple', pid + ': type must be simple');
    check(typeof p.category === 'string' && p.category.length > 0, pid + ': category missing');
    check(typeof p.name === 'string' && p.name.length > 0, pid + ': name missing');
    check(p.style && typeof p.style.text === 'string' && Number.isInteger(p.style.bgcolor), pid + ': style missing');
    check(Array.isArray(p.steps), pid + ': steps missing');
    for (const step of p.steps) {
      for (const a of step.down || []) {
        check(captured.actions && captured.actions[a.actionId], pid + ': actionId "' + a.actionId + '" not defined');
      }
    }
    for (const fb of p.feedbacks || []) {
      check(captured.feedbacks && captured.feedbacks[fb.feedbackId], pid + ': feedbackId "' + fb.feedbackId + '" not defined');
    }
  }
  const structureIds = (captured.structure || []).flatMap((s) => s.definitions);
  for (const id of structureIds) {
    check(captured.presets && captured.presets[id], 'structure references missing preset ' + id);
  }

  const transport = captured.actions.transport;
  const choices = transport.options[0].choices.map((c) => c.id).join(',');
  console.log('transport choices:', choices);

  const playAction = captured.actions.play_jingle;
  const firstJingle = inst.jingles[0];
  const key = firstJingle.cid || firstJingle.id;
  console.log('first jingle key:', key, '(' + firstJingle.name + ')');
  await playAction.callback({ options: { jingle: key } }, {});
  await new Promise((r) => setTimeout(r, 800));
  const state = await inst.request('GET', '/api/state');
  console.log('remote playing count:', state.playing.length);

  inst.playing = (state.playing || []).reduce((m, p) => {
    m[p.cartId] = p;
    if (p.cid) m[p.cid] = p;
    return m;
  }, {});
  console.log('feedback playing(' + key + '):', captured.feedbacks.playing.callback({ options: { jingle: key } }, {}));
  console.log('feedback connected:', captured.feedbacks.connected.callback({ options: {} }, {}));

  const goPreset = captured.presets['sj-go'];
  console.log('GO preset down action:', JSON.stringify(goPreset.steps[0].down[0]));
  const jinglePreset = captured.presets['sj-j-' + key];
  console.log('jingle preset text:', JSON.stringify(jinglePreset.style.text), 'bg:', jinglePreset.style.bgcolor);

  if (errors.length) {
    console.log('PRESET ERRORS:');
    for (const e of errors) console.log(' - ' + e);
    process.exit(1);
  }
  console.log('PRESETS_VALID');
  await inst.destroy();
  console.log('COMPANION_SMOKE_OK');
  process.exit(0);
})();
