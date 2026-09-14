process.send = process.send || function () {};

const SmartJingle = require('../src/main');

const captured = { presets: null, actions: null, feedbacks: null, variables: null };
SmartJingle.prototype.setPresetDefinitions = function (d) { captured.presets = d; };
SmartJingle.prototype.setActionDefinitions = function (d) { captured.actions = d; };
SmartJingle.prototype.setFeedbackDefinitions = function (d) { captured.feedbacks = d; };
SmartJingle.prototype.setVariableDefinitions = function (d) { captured.variables = d; };

(async () => {
  const inst = new SmartJingle({ id: 'test-instance', _isInstanceBaseProps: true, upgradeScripts: [] });
  await inst.init({ host: '127.0.0.1', port: 4405 }, true, {});
  await new Promise((r) => setTimeout(r, 1500));

  console.log('jingles discovered:', inst.jingles.length);
  console.log('connected:', inst.connected);
  console.log('preset ids:', Object.keys(captured.presets || {}).join(', '));
  console.log('action ids:', Object.keys(captured.actions || {}).join(', '));
  console.log('feedback ids:', Object.keys(captured.feedbacks || {}).join(', '));
  console.log('variable count:', (captured.variables || []).length);

  const transport = captured.actions.transport;
  const choices = transport.options[0].choices.map((c) => c.id).join(',');
  console.log('transport choices:', choices);

  const playAction = captured.actions.play_jingle;
  const firstJingle = inst.jingles[0];
  const key = firstJingle.cid || firstJingle.id;
  console.log('first jingle key:', key, '(' + firstJingle.name + ')');
  await playAction.callback({ options: { jingle: key } });
  await new Promise((r) => setTimeout(r, 800));
  const state = await inst.request('GET', '/api/state');
  console.log('remote playing count:', state.playing.length);

  inst.playing = (state.playing || []).reduce((m, p) => {
    m[p.cartId] = p;
    if (p.cid) m[p.cid] = p;
    return m;
  }, {});
  console.log('feedback playing(' + key + '):', captured.feedbacks.playing.callback({ options: { jingle: key } }));
  console.log('feedback connected:', captured.feedbacks.connected.callback({ options: {} }));

  const jinglePreset = captured.presets['smartjingle-jingles-1'];
  console.log('jingle preset buttons:', jinglePreset.buttons.length, 'first text:', JSON.stringify(jinglePreset.buttons[0].style.text));
  const transportPreset = captured.presets['smartjingle-transport'];
  console.log('transport preset buttons:', transportPreset.buttons.map((b) => b.style.text).join(' | '));

  inst.destroy();
  console.log('COMPANION_SMOKE_OK');
  process.exit(0);
})();
