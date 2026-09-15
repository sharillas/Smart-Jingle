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

  console.log('--- PRESET STRUCTURE VALIDATION ---');
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };

  for (const [pid, preset] of Object.entries(captured.presets)) {
    check(preset.type === 'button', pid + ': type must be "button"');
    check(typeof preset.category === 'string' && preset.category.length > 0, pid + ': category missing');
    check(typeof preset.name === 'string' && preset.name.length > 0, pid + ': name missing');
    check(preset.size && Number.isInteger(preset.size.width) && Number.isInteger(preset.size.height), pid + ': preset size missing');
    check(Array.isArray(preset.buttons) && preset.buttons.length > 0, pid + ': buttons missing');
    for (const b of preset.buttons || []) {
      check(b.type === 'button', pid + ': button type');
      check(Number.isInteger(b.position.x) && Number.isInteger(b.position.y), pid + ': button position');
      check(b.size && b.size.width >= 1 && b.size.height >= 1, pid + ': button size');
      check(typeof b.style.text === 'string' && b.style.text.length > 0, pid + ': button text');
      check(Number.isInteger(b.style.bgcolor) && Number.isInteger(b.style.color), pid + ': button colors must be numeric');
      check(Array.isArray(b.steps) && b.steps.length > 0, pid + ': steps missing');
      for (const step of b.steps) {
        for (const action of step.down || []) {
          check(typeof action.actionId === 'string', pid + ': actionId missing');
          check(captured.actions[action.actionId], pid + ': actionId "' + action.actionId + '" not defined in actions');
        }
      }
      for (const fb of b.feedbacks || []) {
        check(captured.feedbacks[fb.feedbackId], pid + ': feedbackId "' + fb.feedbackId + '" not defined');
      }
    }
  }

  const firstJingleBtn = jinglePreset.buttons[0];
  console.log('jingle button steps[0].down[0]:', JSON.stringify(firstJingleBtn.steps[0].down[0]));
  console.log('jingle button feedbacks:', JSON.stringify(firstJingleBtn.feedbacks.map((f) => ({ id: f.feedbackId, options: f.options }))));
  console.log('jingle button style:', JSON.stringify(firstJingleBtn.style));

  if (errors.length) {
    console.log('PRESET ERRORS:');
    for (const e of errors) console.log(' - ' + e);
    process.exit(1);
  }
  console.log('PRESETS_VALID');
  inst.destroy();
  console.log('COMPANION_SMOKE_OK');
  process.exit(0);
})();
