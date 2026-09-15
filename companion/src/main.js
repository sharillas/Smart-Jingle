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
    this.setPresetDefinitions(this.buildStructure(), this.buildPresets());
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
      {
        type: 'textinput',
        id: 'pin',
        label: 'Remote PIN (leave empty if none)',
        width: 12,
        default: '',
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
    const pin = (this.config && this.config.pin) || '';
    let p = path;
    if (pin) p += (p.includes('?') ? '&' : '?') + 'pin=' + encodeURIComponent(pin);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host,
          port,
          path: p,
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
      this.updateStatus(InstanceStatus.Ok, 'Smart Jingle v' + (state.version || '0.3.6'));
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
    for (const p of state.playing || []) {
      this.playing[p.cartId] = p;
      if (p.cid) this.playing[p.cid] = p;
    }
    this.paused = !!state.paused;
    this.selectedCartId = state.selectedCartId || null;
    const selCart = this.jingles.find((j) => j.id === this.selectedCartId);
    this.selectedKey = selCart ? selCart.cid || selCart.id : this.selectedCartId;

    const sig = JSON.stringify(
      this.jingles.map((j) => [j.cid || j.id, j.name, j.playlistName]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    );
    if (sig !== this.lastJinglesJson) {
      this.lastJinglesJson = sig;
      this.setActionDefinitions(this.buildActions());
      this.setFeedbackDefinitions(this.buildFeedbacks());
      this.setVariableDefinitions(this.buildVariables());
      this.setPresetDefinitions(this.buildStructure(), this.buildPresets());
    }

    const values = {};
    for (const j of this.jingles) {
      const p = this.playing[j.cid || j.id] || this.playing[j.id];
      values[this.varId(j)] = p ? 'PLAYING ' + Math.round(p.progress * 100) + '%' : 'STOPPED';
    }
    values.paused = this.paused ? 'PAUSED' : 'RUNNING';
    values.playing_count = Object.keys(this.playing).length;
    values.selected = selCart ? selCart.name : 'None';
    const pl = (this.playlists || []).find((p) => p.id === state.activePlaylistId);
    values.playlist = pl ? pl.name : 'None';
    this.setVariableValues(values);

    this.checkFeedbacks('playing');
    this.checkFeedbacks('selected');
    this.checkFeedbacks('paused');
  }

  keyOf(j) {
    return j.cid || j.id;
  }

  varId(j) {
    return 'j_' + String(j.cid || j.id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  jingleChoices() {
    return this.jingles.map((j) => ({ id: this.keyOf(j), label: `${this.keyOf(j)} · ${j.name}` }));
  }

  playlistChoices() {
    return (this.playlists || []).map((p) => ({ id: p.id, label: p.name }));
  }

  buildActions() {
    const jingleOpt = (label) => ({
      type: 'dropdown',
      id: 'jingle',
      label,
      default: this.jingles.length ? this.keyOf(this.jingles[0]) : '',
      choices: this.jingleChoices(),
      minChoicesForSearch: 0,
    });

    return {
      play_jingle: {
        name: 'Play Jingle',
        description: 'Launch a jingle cart immediately',
        options: [jingleOpt('Jingle')],
        callback: async (action) => {
          await this.request('POST', '/api/jingles/' + encodeURIComponent(action.options.jingle) + '/play');
        },
      },
      stop_jingle: {
        name: 'Stop Jingle',
        description: 'Stop a running jingle cart',
        options: [jingleOpt('Jingle')],
        callback: async (action) => {
          await this.request('POST', '/api/jingles/' + encodeURIComponent(action.options.jingle) + '/stop');
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
              { id: 'go', label: 'GO - launch cued jingle + advance to next' },
              { id: 'pause', label: 'PAUSE - pause / resume all' },
              { id: 'reset', label: 'RESET - stop all + clear selection' },
              { id: 'stop-all', label: 'STOP ALL' },
            ],
          },
        ],
        callback: async (action) => {
          await this.request('POST', '/api/transport/' + action.options.command);
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
        callback: async (action) => {
          await this.request('POST', '/api/playlists/' + encodeURIComponent(action.options.playlist) + '/activate');
        },
      },
    };
  }

  buildFeedbacks() {
    const jingleOpt = {
      type: 'dropdown',
      id: 'jingle',
      label: 'Jingle',
      default: this.jingles.length ? this.keyOf(this.jingles[0]) : '',
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
        callback: (feedback) => !!this.playing[feedback.options.jingle],
      },
      selected: {
        type: 'boolean',
        name: 'Jingle is selected',
        description: 'Highlight the jingle that GO will launch',
        options: [jingleOpt],
        defaultStyle: { bgcolor: combineRgb(0, 102, 255), color: combineRgb(255, 255, 255) },
        callback: (feedback) => this.selectedKey === feedback.options.jingle,
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
    const vars = {};
    for (const j of this.jingles) {
      vars[this.varId(j)] = { name: `Jingle "${this.keyOf(j)} - ${j.name}" status` };
    }
    vars.paused = { name: 'Transport state' };
    vars.playing_count = { name: 'Number of jingles playing' };
    vars.selected = { name: 'Selected jingle name' };
    vars.playlist = { name: 'Active playlist name' };
    return vars;
  }

  hexToRgb(color) {
    try {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(color || ''));
      if (!m) return null;
      return parseInt(m[1], 16);
    } catch (e) {
      return null;
    }
  }

  buildStructure() {
    const sections = [];
    sections.push({
      id: 'sj-transport',
      name: 'Transport',
      definitions: ['sj-go', 'sj-pause', 'sj-reset', 'sj-stop-all'],
    });
    const jingleIds = this.jingles.map((j) => 'sj-j-' + this.keyOf(j));
    if (jingleIds.length) {
      sections.push({
        id: 'sj-jingles',
        name: 'Jingles',
        definitions: jingleIds,
      });
    }
    if (!this.jingles.length) {
      sections.push({
        id: 'sj-placeholder',
        name: 'Smart Jingle (no jingles configured)',
        definitions: ['sj-placeholder'],
      });
    }
    return sections;
  }

  buildPresets() {
    const presets = {};

    const mkTransport = (id, text, command, feedbacks) => {
      presets[id] = {
        type: 'simple',
        category: 'Smart Jingle',
        name: 'Transport - ' + text.replace('\n', ' '),
        style: {
          text,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        steps: [{ down: [{ actionId: 'transport', options: { command } }], up: [] }],
        feedbacks: feedbacks || [],
      };
    };

    mkTransport('sj-go', 'GO', 'go', [
      { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
    ]);
    mkTransport('sj-pause', 'PAUSE', 'pause', [
      { feedbackId: 'paused', options: {}, style: { bgcolor: combineRgb(245, 158, 11), color: combineRgb(0, 0, 0) } },
      { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
    ]);
    mkTransport('sj-reset', 'RESET', 'reset', [
      { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
    ]);
    mkTransport('sj-stop-all', 'STOP\nALL', 'stop-all', [
      { feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } },
    ]);

    for (const j of this.jingles) {
      const key = this.keyOf(j);
      const color = this.hexToRgb(j.color);
      presets['sj-j-' + key] = {
        type: 'simple',
        category: 'Smart Jingle',
        name: 'Jingle ' + key + ' - ' + j.name,
        style: {
          text: j.name,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: color || combineRgb(0, 0, 0),
        },
        steps: [{ down: [{ actionId: 'play_jingle', options: { jingle: key } }], up: [] }],
        feedbacks: [
          { feedbackId: 'playing', options: { jingle: key }, style: { bgcolor: combineRgb(0, 153, 0) } },
          { feedbackId: 'selected', options: { jingle: key }, style: { bgcolor: combineRgb(0, 102, 255) } },
        ],
      };
    }

    if (!this.jingles.length) {
      presets['sj-placeholder'] = {
        type: 'simple',
        category: 'Smart Jingle',
        name: 'Smart Jingle (no jingles configured)',
        style: {
          text: 'Configure jingles\nin Smart Jingle',
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        steps: [],
        feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0) } }],
      };
    }

    return presets;
  }
}

module.exports = SmartJingleInstance;
