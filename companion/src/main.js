const http = require('node:http');
const { InstanceBase, InstanceStatus, combineRgb } = require('@companion-module/base');

const POLL_MS = 300;
const TIMEOUT_MS = 1500;

class SmartJingleInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.jingles = [];
    this.playlists = [];
    this.playing = {};
    this.paused = false;
    this.selectedCartId = null;
    this.connected = false;
    this.pollTimer = null;
    this.lastJinglesJson = '';
  }

  async init(config) {
    this.config = config || {};
    this.updateStatus(InstanceStatus.Connecting);
    this.setActionDefinitions(this.buildActions());
    this.setFeedbackDefinitions(this.buildFeedbacks());
    this.setVariableDefinitions(this.buildVariables());
    this.setPresetDefinitions(this.buildPresets());
    this.startPolling();
  }

  async configUpdated(config) {
    this.config = config;
    this.restartPolling();
  }

  async destroy() {
    this.stopPolling();
  }

  getConfigFields() {
    return [
      {
        type: 'textinput',
        id: 'host',
        label: 'Smart Jingle IP address',
        width: 6,
        default: '127.0.0.1',
      },
      {
        type: 'number',
        id: 'port',
        label: 'Port',
        width: 6,
        default: 4405,
        min: 1,
        max: 65535,
      },
    ];
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
  }

  restartPolling() {
    this.updateStatus(InstanceStatus.Connecting);
    this.startPolling();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  request(method, path) {
    const host = (this.config && this.config.host) || '127.0.0.1';
    const port = Number((this.config && this.config.port) || 4405);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host,
          port,
          path,
          method,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({});
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  async poll() {
    try {
      const state = await this.request('GET', '/api/state');
      this.applyState(state);
      if (!this.connected) {
        this.connected = true;
        this.checkFeedbacks('connected');
      }
      this.updateStatus(InstanceStatus.Ok, 'Smart Jingle v' + (state.version || '0.1.0'));
    } catch (e) {
      if (this.connected) {
        this.connected = false;
        this.checkFeedbacks('connected');
      }
      this.updateStatus(InstanceStatus.ConnectionFailure, e.message || 'unreachable');
    }
  }

  applyState(state) {
    if (!state || !Array.isArray(state.carts)) return;
    this.jingles = state.carts;
    this.playlists = state.playlists || [];
    this.playing = {};
    for (const p of state.playing || []) this.playing[p.cartId] = p;
    this.paused = !!state.paused;
    this.selectedCartId = state.selectedCartId || null;

    const sig = JSON.stringify(
      this.jingles.map((j) => [j.id, j.name, j.playlistName]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    );
    if (sig !== this.lastJinglesJson) {
      this.lastJinglesJson = sig;
      this.setActionDefinitions(this.buildActions());
      this.setFeedbackDefinitions(this.buildFeedbacks());
      this.setVariableDefinitions(this.buildVariables());
      this.setPresetDefinitions(this.buildPresets());
    }

    const values = {};
    for (const j of this.jingles) {
      const p = this.playing[j.id];
      values[j.id] = p ? 'PLAYING ' + Math.round(p.progress * 100) + '%' : 'STOPPED';
    }
    values.paused = this.paused ? 'PAUSED' : 'RUNNING';
    values.playing_count = Object.keys(this.playing).length;
    const sel = this.jingles.find((j) => j.id === this.selectedCartId);
    values.selected = sel ? sel.name : 'None';
    const pl = (this.playlists || []).find((p) => p.id === state.activePlaylistId);
    values.playlist = pl ? pl.name : 'None';
    this.setVariableValues(values);

    this.checkFeedbacks('playing');
    this.checkFeedbacks('selected');
    this.checkFeedbacks('paused');
  }

  jingleChoices() {
    return this.jingles.map((j) => ({ id: j.id, label: `${j.name} [${j.playlistName || ''}]` }));
  }

  playlistChoices() {
    return (this.playlists || []).map((p) => ({ id: p.id, label: p.name }));
  }

  buildActions() {
    const jingleOpt = (label) => ({
      type: 'dropdown',
      id: 'jingle',
      label,
      default: this.jingles.length ? this.jingles[0].id : '',
      choices: this.jingleChoices(),
      minChoicesForSearch: 0,
    });

    return {
      play_jingle: {
        name: 'Play Jingle',
        description: 'Launch a jingle cart immediately',
        options: [jingleOpt('Jingle')],
        callback: async (evt) => {
          await this.request('POST', '/api/jingles/' + encodeURIComponent(evt.options.jingle) + '/play');
        },
      },
      stop_jingle: {
        name: 'Stop Jingle',
        description: 'Stop a running jingle cart',
        options: [jingleOpt('Jingle')],
        callback: async (evt) => {
          await this.request('POST', '/api/jingles/' + encodeURIComponent(evt.options.jingle) + '/stop');
        },
      },
      transport: {
        name: 'Transport',
        description: 'GO / PAUSE / RESET / STOP ALL',
        options: [
          {
            type: 'dropdown',
            id: 'command',
            label: 'Command',
            default: 'go',
            choices: [
              { id: 'go', label: 'GO - launch selected jingle' },
              { id: 'pause', label: 'PAUSE - pause / resume all' },
              { id: 'reset', label: 'RESET - stop all + clear selection' },
              { id: 'stop-all', label: 'STOP ALL' },
            ],
          },
        ],
        callback: async (evt) => {
          await this.request('POST', '/api/transport/' + evt.options.command);
        },
      },
      select_playlist: {
        name: 'Select Playlist',
        description: 'Switch the active playlist group',
        options: [
          {
            type: 'dropdown',
            id: 'playlist',
            label: 'Playlist',
            default: this.playlists.length ? this.playlists[0].id : '',
            choices: this.playlistChoices(),
            minChoicesForSearch: 0,
          },
        ],
        callback: async (evt) => {
          await this.request('POST', '/api/playlists/' + encodeURIComponent(evt.options.playlist) + '/activate');
        },
      },
    };
  }

  buildFeedbacks() {
    const jingleOpt = {
      type: 'dropdown',
      id: 'jingle',
      label: 'Jingle',
      default: this.jingles.length ? this.jingles[0].id : '',
      choices: this.jingleChoices(),
      minChoicesForSearch: 0,
    };

    return {
      playing: {
        type: 'boolean',
        name: 'Jingle is playing',
        description: 'Highlight while the jingle cart is playing',
        options: [jingleOpt],
        defaultStyle: { bgcolor: combineRgb(0, 153, 0), color: combineRgb(255, 255, 255) },
        callback: (fb) => !!this.playing[fb.options.jingle],
      },
      selected: {
        type: 'boolean',
        name: 'Jingle is selected',
        description: 'Highlight the jingle that GO will relaunch',
        options: [jingleOpt],
        defaultStyle: { bgcolor: combineRgb(0, 102, 255), color: combineRgb(255, 255, 255) },
        callback: (fb) => this.selectedCartId === fb.options.jingle,
      },
      paused: {
        type: 'boolean',
        name: 'Transport is paused',
        description: 'Highlight PAUSE button while transport is paused',
        options: [],
        defaultStyle: { bgcolor: combineRgb(245, 158, 11), color: combineRgb(0, 0, 0) },
        callback: () => this.paused,
      },
      connected: {
        type: 'boolean',
        name: 'Connected to Smart Jingle',
        description: 'Highlight while the app is reachable',
        options: [],
        defaultStyle: { bgcolor: combineRgb(0, 140, 0), color: combineRgb(255, 255, 255) },
        callback: () => this.connected,
      },
    };
  }

  buildVariables() {
    const vars = [];
    for (const j of this.jingles) {
      vars.push({ variableId: j.id, name: `Jingle "${j.name}" status` });
    }
    vars.push({ variableId: 'paused', name: 'Transport state' });
    vars.push({ variableId: 'playing_count', name: 'Number of jingles playing' });
    vars.push({ variableId: 'selected', name: 'Selected jingle name' });
    vars.push({ variableId: 'playlist', name: 'Active playlist name' });
    return vars;
  }

  buildPresets() {
    const presets = {};

    const mkBtn = (x, y, text, steps, feedbacks, opts) => {
      const b = {
        type: 'button',
        position: { x, y },
        size: { width: 1, height: 1 },
        style: {
          text,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        steps: steps,
        feedbacks: feedbacks || [],
        ...opts,
      };
      return b;
    };

    const transportButtons = [
      mkBtn(0, 0, 'GO', [{ down: [{ actionId: 'transport', options: { command: 'go' } }], up: [] }], [
        { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
      ]),
      mkBtn(1, 0, 'PAUSE', [{ down: [{ actionId: 'transport', options: { command: 'pause' } }], up: [] }], [
        { feedbackId: 'paused', options: {}, style: { bgcolor: combineRgb(245, 158, 11), color: combineRgb(0, 0, 0) } },
        { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
      ]),
      mkBtn(2, 0, 'RESET', [{ down: [{ actionId: 'transport', options: { command: 'reset' } }], up: [] }], [
        { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
      ]),
      mkBtn(3, 0, 'STOP\nALL', [{ down: [{ actionId: 'transport', options: { command: 'stop-all' } }], up: [] }], [
        { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
      ]),
    ];

    presets['smartjingle-transport'] = {
      id: 'smartjingle-transport',
      type: 'button',
      category: 'Smart Jingle',
      name: 'Transport (GO/PAUSE/RESET/STOP)',
      style: { text: 'Smart Jingle\\nTransport', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      size: { width: 4, height: 1 },
      buttons: transportButtons,
      feedbacks: [],
    };

    const PER_PRESET = 8;
    for (let i = 0; i < this.jingles.length; i += PER_PRESET) {
      const block = this.jingles.slice(i, i + PER_PRESET);
      const buttons = block.map((j, idx) => {
        const x = idx % 4;
        const y = Math.floor(idx / 4);
        return mkBtn(
          x,
          y,
          j.name,
          [{ down: [{ actionId: 'play_jingle', options: { jingle: j.id } }], up: [] }],
          [
            { feedbackId: 'playing', options: { jingle: j.id }, style: { bgcolor: combineRgb(0, 153, 0) } },
            { feedbackId: 'selected', options: { jingle: j.id }, style: { bgcolor: combineRgb(0, 102, 255) } },
          ]
        );
      });
      presets['smartjingle-jingles-' + (i / PER_PRESET + 1)] = {
        id: 'smartjingle-jingles-' + (i / PER_PRESET + 1),
        type: 'button',
        category: 'Smart Jingle',
        name: 'Jingles ' + (i + 1) + '-' + (i + block.length),
        style: {
          text: 'Smart Jingle\\nJingles ' + (i + 1) + '-' + (i + block.length),
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        size: { width: 4, height: 2 },
        buttons,
        feedbacks: [],
      };
    }

    if (!this.jingles.length) {
      presets['smartjingle-placeholder'] = {
        id: 'smartjingle-placeholder',
        type: 'button',
        category: 'Smart Jingle',
        name: 'Smart Jingle (no jingles configured)',
        style: { text: 'Configure jingles\\nin Smart Jingle', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
        steps: [],
        feedbacks: [
          { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
        ],
      };
    }

    return presets;
  }
}

module.exports = SmartJingleInstance;
