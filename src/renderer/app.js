(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const COLORS = [null, '#2f81f7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899'];

  let data = null;
  let waveCache = new Map();
  let statePushTimer = 0;
  let lastStateJson = '';

  /* ---------------- data helpers ---------------- */

  function activePlaylist() {
    return data.playlists.find((p) => p.id === data.ui.activePlaylistId) || data.playlists[0] || null;
  }

  function findCart(cartId) {
    for (const p of data.playlists) {
      const c = p.carts.find((c) => c.id === cartId);
      if (c) return { playlist: p, cart: c };
    }
    return null;
  }

  function cartDuration(cart) {
    const w = waveCache.get(cart.id);
    return w ? w.duration : null;
  }

  async function refreshData() {
    data = await window.sjapi.getData();
  }

  /* ---------------- rendering ---------------- */

  function renderPlaylists() {
    const ul = $('#playlist-list');
    ul.innerHTML = '';
    for (const p of data.playlists) {
      const li = document.createElement('li');
      li.className = 'pl-item' + (p.id === activePlaylist()?.id ? ' active' : '');
      li.innerHTML =
        `<span class="pl-name"></span><span class="pl-count">${p.carts.length}</span><button class="pl-del" title="Delete playlist">&#10005;</button>`;
      li.querySelector('.pl-name').textContent = p.name;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.pl-del')) return;
        data.ui.activePlaylistId = p.id;
        window.sjapi.setUI({ activePlaylistId: p.id });
        renderPlaylists();
        renderCarts();
        pushState(true);
      });
      li.querySelector('.pl-del').addEventListener('click', async () => {
        if (confirm(`Delete playlist "${p.name}" and its ${p.carts.length} jingle(s)?`)) {
          await window.sjapi.removePlaylist(p.id);
          await refreshData();
          renderPlaylists();
          renderCarts();
          pushState(true);
        }
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [
          { label: 'Rename playlist', action: () => renamePlaylist(p) },
          { label: 'Delete playlist', danger: true, action: async () => {
              if (confirm(`Delete playlist "${p.name}"?`)) {
                await window.sjapi.removePlaylist(p.id);
                await refreshData();
                renderPlaylists();
                renderCarts();
                pushState(true);
              }
            } },
        ]);
      });
      ul.appendChild(li);
    }
    $('#carts-title').textContent = activePlaylist() ? activePlaylist().name : 'Jingles';
  }

  function renderCarts() {
    const grid = $('#carts-grid');
    grid.style.setProperty('--cols', data.ui.cartColumns || 8);
    grid.innerHTML = '';
    const pl = activePlaylist();
    const carts = pl ? pl.carts : [];

    $('#empty-hint').classList.toggle('hidden', carts.length > 0);

    for (const cart of carts) {
      const btn = document.createElement('button');
      btn.className = 'cart';
      btn.dataset.id = cart.id;
      if (cart.color) btn.style.setProperty('--cart-color', cart.color);
      if (SJPlayer.isActive(cart.id)) btn.classList.add('playing');
      if (SJPlayer.getSelected() === cart.id) btn.classList.add('selected');

      const dur = cartDuration(cart);
      const durTxt = dur ? SJPlayer.fmt(dur) : '—';

      btn.innerHTML = `
        <span class="cart-name"></span>
        <span class="cart-meta">${durTxt}${cart.out ? ' · OUT ' + SJPlayer.fmt(cart.out) : ''}</span>
        <span class="cart-progress"></span>
        <span class="cart-edit" title="Edit IN/OUT">&#9998;</span>`;
      btn.querySelector('.cart-name').textContent = cart.name;

      btn.addEventListener('click', (e) => {
        if (e.target.closest('.cart-edit')) return;
        SJPlayer.play(cart.id, (id) => findCart(id)?.cart);
        updateSelectionUI();
      });
      btn.querySelector('.cart-edit').addEventListener('click', () => openEditor(cart.id));
      btn.addEventListener('dblclick', () => openEditor(cart.id));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [
          { label: 'Rename', action: () => renameCart(cart) },
          { label: 'Edit IN/OUT points…', action: () => openEditor(cart.id) },
          { label: 'Replace audio file…', action: () => replaceCartFile(cart) },
          { label: 'Cycle color', action: async () => {
              const idx = COLORS.indexOf(cart.color);
              await window.sjapi.updateCart(cart.id, { color: COLORS[(idx + 1) % COLORS.length] });
              await refreshData();
              renderCarts();
            } },
          { label: 'Duplicate', action: async () => {
              await window.sjapi.addCarts(cart.playlistId || pl.id, [cart.file]);
              await refreshData();
              renderPlaylists();
              renderCarts();
            } },
          { sep: true },
          { label: 'Remove', danger: true, action: async () => {
              SJPlayer.stopCart(cart.id);
              await window.sjapi.removeCart(cart.id);
              await refreshData();
              renderPlaylists();
              renderCarts();
              updateSelectionUI();
              pushState(true);
            } },
        ]);
      });

      grid.appendChild(btn);
    }
    updateCartPlayStates();
  }

  function updateSelectionUI() {
    for (const el of document.querySelectorAll('.cart')) {
      el.classList.toggle('selected', el.dataset.id === SJPlayer.getSelected());
    }
    drawWavebar();
  }

  function updateCartPlayStates() {
    for (const el of document.querySelectorAll('.cart')) {
      const id = el.dataset.id;
      const playing = SJPlayer.isActive(id);
      el.classList.toggle('playing', playing);
      if (playing) {
        const found = findCart(id);
        if (found && !el.style.getPropertyValue('--cart-color')) {
          /* keep default */
        }
      }
    }
  }

  /* ---------------- wave bar ---------------- */

  async function loadWave(cartId) {
    if (waveCache.has(cartId)) return waveCache.get(cartId);
    try {
      const wave = await SJWave.getWave(cartId, (id) => window.sjapi.readCartAudio(id));
      waveCache.set(cartId, wave);
      return wave;
    } catch {
      return null;
    }
  }

  let wavebarLoop = null;

  function drawWavebar() {
    const canvas = $('#wavebar-canvas');
    const container = $('#wavebar');
    const sel = SJPlayer.getSelected();
    const found = sel ? findCart(sel) : null;

    if (!found) {
      $('#wb-name').textContent = 'No jingle selected';
      $('#wb-times').innerHTML = '—';
      $('#btn-edit').disabled = true;
      canvas.width = 0;
      return;
    }

    $('#wb-name').textContent = found.cart.name;
    $('#btn-edit').disabled = false;

    const w = waveCache.get(sel);
    if (!w) {
      $('#wb-times').innerHTML = '<span class="muted">loading…</span>';
      loadWave(sel).then(() => drawWavebar());
      return;
    }

    const { w: cw, h: ch, dpr } = SJWave.fitCanvas(canvas, container);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const st = SJPlayer.state((id) => findCart(id)?.cart);
    const playing = st.playing.find((p) => p.cartId === sel);
    const playhead = playing ? (playing.in || 0) + playing.currentTime : null;
    const inS = found.cart.in || 0;
    const outS = found.cart.out || null;

    SJWave.drawWave(canvas, w, {
      inS,
      outS,
      playhead,
      selected: true,
      colors: { inside: '#3f8cff', outside: 'rgba(120,130,150,0.25)' },
    });

    const outTxt = outS ? SJPlayer.fmt(outS) : SJPlayer.fmt(w.duration);
    $('#wb-times').innerHTML =
      `IN <b class="in-t">${SJPlayer.fmt(inS)}</b> &nbsp;·&nbsp; OUT <b class="out-t">${outTxt}</b> &nbsp;·&nbsp; DUR <b>${SJPlayer.fmt((outS || w.duration) - inS)}</b>`;

    if (!wavebarLoop) {
      wavebarLoop = setInterval(drawWavebar, 200);
    }
  }

  /* ---------------- editor ---------------- */

  let editorCtx = null;

  function openEditor(cartId) {
    const found = findCart(cartId);
    if (!found) return;

    const overlay = $('#modal-overlay');
    const box = $('#modal-box');
    box.innerHTML = `
      <h2>Edit IN / OUT — ${escapeHtml(found.cart.name)}</h2>
      <div id="editor-wrap">
        <div class="editor-canvas-wrap" id="ed-canvas-wrap"><canvas id="ed-canvas"></canvas></div>
        <div class="editor-readout">
          <span>IN <span class="val in-val" id="ed-in">0:00.0</span></span>
          <span>OUT <span class="val out-val" id="ed-out">0:00.0</span></span>
          <span>DUR <span class="val" id="ed-dur">0:00.0</span></span>
          <span id="ed-pos">POS 0:00.0</span>
        </div>
        <div class="editor-controls">
          <button class="mini-btn" id="ed-play">&#9654; Preview</button>
          <button class="mini-btn" id="ed-stop">&#9632; Stop</button>
          <button class="mini-btn" id="ed-set-in">Set IN at playhead</button>
          <button class="mini-btn" id="ed-set-out">Set OUT at playhead</button>
          <button class="mini-btn" id="ed-clear">Clear points</button>
        </div>
        <div class="field" style="display:flex;gap:10px;">
          <div style="flex:1"><label>IN (sec)</label><input type="number" step="0.1" min="0" id="ed-in-num"></div>
          <div style="flex:1"><label>OUT (sec)</label><input type="number" step="0.1" min="0" id="ed-out-num"></div>
        </div>
        <p class="editor-hint">Drag the green/red markers on the waveform, type exact seconds, or press <b>Set IN/OUT</b> while previewing. Click on the waveform to seek.</p>
        <div class="modal-actions">
          <button class="mini-btn" id="ed-cancel">Cancel</button>
          <button class="mini-btn primary" id="ed-save">Save</button>
        </div>
      </div>`;

    overlay.classList.remove('hidden');

    const canvas = $('#ed-canvas');
    const wrap = $('#ed-canvas-wrap');
    let wave = null;
    let inS = found.cart.in || 0;
    let outS = found.cart.out || null;
    let preview = null;
    let dragging = null;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth;
      const ch = 190;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      const dur = wave ? wave.duration : 1;
      const out = outS || dur;
      SJWave.drawWave(canvas, wave || { duration: 1, peaks: new Float32Array(0) }, {
        inS,
        outS,
        playhead: preview ? preview.currentTime : null,
        colors: { inside: '#3f8cff', outside: 'rgba(120,130,150,0.25)' },
      });
      $('#ed-in').textContent = SJPlayer.fmt(inS);
      $('#ed-out').textContent = outS ? SJPlayer.fmt(outS) : SJPlayer.fmt(dur);
      $('#ed-dur').textContent = SJPlayer.fmt((outS || dur) - inS);
      $('#ed-in-num').value = inS.toFixed(2);
      $('#ed-out-num').value = outS ? outS.toFixed(2) : dur.toFixed(2);
    }

    function stopPreview() {
      if (preview) {
        preview.pause();
        preview.src = '';
        preview = null;
      }
    }

    function timeFromX(x) {
      const rect = canvas.getBoundingClientRect();
      const dur = wave ? wave.duration : 1;
      return Math.max(0, Math.min(dur, ((x - rect.left) / rect.width) * dur));
    }

    canvas.addEventListener('mousedown', (e) => {
      if (!wave) return;
      const rect = canvas.getBoundingClientRect();
      const dur = wave.duration;
      const x = e.clientX - rect.left;
      const inX = (inS / dur) * rect.width;
      const outX = ((outS || dur) / dur) * rect.width;
      if (Math.abs(x - inX) < 9) dragging = 'in';
      else if (outS && Math.abs(x - outX) < 9) dragging = 'out';
      else {
        const t = timeFromX(e.clientX);
        if (preview) preview.currentTime = t;
        else {
          preview = new Audio(window.sjapi.audioUrl(found.cart.file));
          preview.addEventListener('loadedmetadata', () => {
            try { preview.currentTime = t; } catch {}
          });
        }
      }
    });
    const onMove = (e) => {
      if (!dragging || !wave) return;
      const t = timeFromX(e.clientX);
      if (dragging === 'in') inS = Math.min(t, (outS || wave.duration) - 0.05);
      if (dragging === 'out') outS = Math.max(t, inS + 0.05);
      draw();
    };
    const onUp = () => (dragging = null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    $('#ed-play').addEventListener('click', () => {
      if (!wave) return;
      if (!preview) {
        preview = new Audio(window.sjapi.audioUrl(found.cart.file));
      }
      preview.currentTime = inS;
      preview.play();
    });
    $('#ed-stop').addEventListener('click', () => {
      stopPreview();
      draw();
    });
    $('#ed-set-in').addEventListener('click', () => {
      if (preview) {
        inS = Math.min(preview.currentTime, (outS || wave.duration) - 0.05);
        draw();
      }
    });
    $('#ed-set-out').addEventListener('click', () => {
      if (preview) {
        outS = Math.max(preview.currentTime, inS + 0.05);
        draw();
      }
    });
    $('#ed-clear').addEventListener('click', () => {
      inS = 0;
      outS = null;
      draw();
    });
    $('#ed-in-num').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && wave) {
        inS = Math.max(0, Math.min(v, (outS || wave.duration) - 0.05));
        draw();
      }
    });
    $('#ed-out-num').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && wave) {
        outS = Math.min(wave.duration, Math.max(v, inS + 0.05));
        draw();
      }
    });

    const previewLoop = setInterval(() => {
      if (preview) {
        const dur = wave ? wave.duration : 1;
        const out = outS || dur;
        if (preview.currentTime >= out) {
          stopPreview();
        }
        $('#ed-pos').textContent = 'POS ' + SJPlayer.fmt(preview.currentTime || 0);
        draw();
      }
    }, 100);

    function cleanup() {
      clearInterval(previewLoop);
      stopPreview();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      editorCtx = null;
    }

    $('#ed-cancel').addEventListener('click', () => {
      cleanup();
      overlay.classList.add('hidden');
    });
    $('#ed-save').addEventListener('click', async () => {
      await window.sjapi.updateCart(cartId, { in: inS, out: outS || null });
      await refreshData();
      cleanup();
      overlay.classList.add('hidden');
      renderCarts();
      drawWavebar();
      pushState(true);
    });

    loadWave(cartId).then((w) => {
      wave = w;
      if (!outS && w) outS = found.cart.out || null;
      draw();
    });
    draw();
  }

  /* ---------------- generic modal + context menu ---------------- */

  function promptModal(title, value, placeholder) {
    return new Promise((resolve) => {
      const overlay = $('#modal-overlay');
      const box = $('#modal-box');
      box.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        <div class="field"><input type="text" id="pm-input" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder || '')}"></div>
        <div class="modal-actions">
          <button class="mini-btn" id="pm-cancel">Cancel</button>
          <button class="mini-btn primary" id="pm-ok">OK</button>
        </div>`;
      overlay.classList.remove('hidden');
      const input = $('#pm-input');
      input.focus();
      input.select();
      const done = (val) => {
        overlay.classList.add('hidden');
        resolve(val);
      };
      $('#pm-ok').addEventListener('click', () => done(input.value));
      $('#pm-cancel').addEventListener('click', () => done(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(input.value);
        if (e.key === 'Escape') done(null);
      });
    });
  }

  async function renamePlaylist(p) {
    const name = await promptModal('Rename playlist', p.name);
    if (name) {
      await window.sjapi.renamePlaylist(p.id, name);
      await refreshData();
      renderPlaylists();
    }
  }

  async function renameCart(cart) {
    const name = await promptModal('Rename jingle', cart.name);
    if (name) {
      await window.sjapi.updateCart(cart.id, { name });
      await refreshData();
      renderCarts();
      drawWavebar();
    }
  }

  async function replaceCartFile(cart) {
    const files = await window.sjapi.pickAudio();
    if (files && files.length) {
      await window.sjapi.updateCart(cart.id, { file: files[0] });
      waveCache.delete(cart.id);
      await refreshData();
      renderCarts();
      drawWavebar();
      pushState(true);
    }
  }

  function openCtxMenu(x, y, items) {
    const menu = $('#ctx-menu');
    menu.innerHTML = '';
    for (const it of items) {
      if (it.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        continue;
      }
      const div = document.createElement('div');
      div.className = 'ctx-item' + (it.danger ? ' danger' : '');
      div.textContent = it.label;
      div.addEventListener('click', () => {
        hideCtx();
        it.action();
      });
      menu.appendChild(div);
    }
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  }

  function hideCtx() {
    $('#ctx-menu').classList.add('hidden');
  }
  document.addEventListener('click', hideCtx);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.cart, .pl-item')) hideCtx();
  });

  /* ---------------- settings ---------------- */

  async function openSettings() {
    const overlay = $('#modal-overlay');
    const box = $('#modal-box');
    const s = data.settings;
    box.innerHTML = `
      <h2>Settings</h2>
      <div class="field"><label>Remote API port</label><input type="number" id="set-port" value="${s.port}"></div>
      <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="set-remote" ${s.remoteEnabled !== false ? 'checked' : ''} style="width:auto;"> Enable remote control (tablet / Companion)</label></div>
      <div class="field"><label>Network access</label><div id="set-net" style="font-size:11px;color:var(--muted);line-height:1.7;"></div></div>
      <p class="editor-hint">Port changes take effect after restarting the app.</p>
      <div class="modal-actions">
        <button class="mini-btn" id="set-cancel">Cancel</button>
        <button class="mini-btn primary" id="set-save">Save</button>
      </div>`;
    overlay.classList.remove('hidden');

    const info = await window.sjapi.getNetwork();
    const net = $('#set-net');
    net.innerHTML = `<div><b>Local:</b> ${info.url}</div>` +
      info.interfaces.map((i) => `<div><b>${i.interface}:</b> ${i.url}</div>`).join('');

    $('#set-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    $('#set-save').addEventListener('click', async () => {
      await window.sjapi.setSettings({
        port: parseInt($('#set-port').value, 10) || 4405,
        remoteEnabled: $('#set-remote').checked,
      });
      await refreshData();
      overlay.classList.add('hidden');
      updateServerBadge();
    });
  }

  /* ---------------- server badge ---------------- */

  async function updateServerBadge() {
    try {
      const info = await window.sjapi.getNetwork();
      const badge = $('#server-badge');
      badge.classList.toggle('on', info.enabled);
      $('#server-label').textContent = info.enabled ? `API ${info.port}` : 'API off';
      badge.title = info.interfaces.length
        ? info.interfaces.map((i) => i.url).join('\n')
        : info.url;
    } catch {
      /* ignore */
    }
  }

  /* ---------------- state push ---------------- */

  function buildState() {
    const pl = activePlaylist();
    return {
      app: 'Smart Jingle',
      version: '0.1.0',
      paused: SJPlayer.state((id) => findCart(id)?.cart).paused,
      selectedCartId: SJPlayer.getSelected(),
      activePlaylistId: pl ? pl.id : null,
      playing: SJPlayer.state((id) => findCart(id)?.cart).playing,
      playlists: data.playlists.map((p) => ({ id: p.id, name: p.name, carts: p.carts.length })),
      carts: data.playlists.flatMap((p) =>
        p.carts.map((c) => ({
          id: c.id,
          name: c.name,
          playlistId: p.id,
          playlistName: p.name,
          color: c.color,
          in: c.in,
          out: c.out,
          volume: c.volume,
        }))
      ),
    };
  }

  function pushState(force) {
    const now = Date.now();
    if (!force && now - statePushTimer < 150) return;
    statePushTimer = now;
    const st = buildState();
    const js = JSON.stringify(st);
    if (js === lastStateJson && !force) return;
    lastStateJson = js;
    window.sjapi.sendState(st);
  }

  /* ---------------- remote commands ---------------- */

  function handleRemote(cmd) {
    switch (cmd.cmd) {
      case 'play':
        SJPlayer.play(cmd.cartId, (id) => findCart(id)?.cart);
        updateSelectionUI();
        break;
      case 'stop':
        SJPlayer.stopCart(cmd.cartId);
        break;
      case 'go':
        SJPlayer.go((id) => findCart(id)?.cart);
        updateSelectionUI();
        break;
      case 'pause':
        updatePauseButton();
        break;
      case 'reset':
        SJPlayer.reset();
        updateSelectionUI();
        updatePauseButton();
        break;
      case 'stop-all':
        SJPlayer.stopAll();
        updatePauseButton();
        break;
      case 'activate-playlist': {
        if (data.playlists.some((p) => p.id === cmd.playlistId)) {
          data.ui.activePlaylistId = cmd.playlistId;
          window.sjapi.setUI({ activePlaylistId: cmd.playlistId });
          renderPlaylists();
          renderCarts();
          pushState(true);
        }
        break;
      }
      case 'add-files':
        addFiles();
        break;
      case 'new-playlist':
        addPlaylist();
        break;
    }
    updateCartPlayStates();
    drawWavebar();
    pushState(true);
  }

  function updatePauseButton() {
    const paused = SJPlayer.state((id) => findCart(id)?.cart).paused;
    $('#btn-pause').classList.toggle('paused-state', paused);
  }

  /* ---------------- playlist / file add ---------------- */

  async function addFiles(paths) {
    let pl = activePlaylist();
    if (!pl) {
      await window.sjapi.addPlaylist('Playlist 1');
      await refreshData();
      pl = activePlaylist();
    }
    await window.sjapi.addCarts(pl.id, paths);
    await refreshData();
    renderPlaylists();
    renderCarts();
    pushState(true);
  }

  async function addPlaylist() {
    const name = await promptModal('New playlist', '', 'Playlist name');
    if (name) {
      await window.sjapi.addPlaylist(name);
      await refreshData();
      renderPlaylists();
      renderCarts();
      pushState(true);
    }
  }

  /* ---------------- main loop ---------------- */

  function tick() {
    const st = SJPlayer.state((id) => findCart(id)?.cart);
    for (const el of document.querySelectorAll('.cart')) {
      const p = st.playing.find((x) => x.cartId === el.dataset.id);
      const bar = el.querySelector('.cart-progress');
      if (bar) bar.style.width = (p ? p.progress * 100 : 0) + '%';
    }
    pushState(false);
    requestAnimationFrame(tick);
  }

  /* ---------------- init ---------------- */

  async function init() {
    await refreshData();

    $('#sel-cols').value = String(data.ui.cartColumns || 8);
    renderPlaylists();
    renderCarts();
    updateServerBadge();

    $('#btn-add-playlist').addEventListener('click', addPlaylist);
    $('#btn-add-files').addEventListener('click', async () => {
      const files = await window.sjapi.pickAudio();
      if (files && files.length) addFiles(files);
    });
    $('#btn-settings').addEventListener('click', openSettings);

    $('#btn-go').addEventListener('click', () => {
      SJPlayer.go((id) => findCart(id)?.cart);
      updateSelectionUI();
      updatePauseButton();
      pushState(true);
    });
    $('#btn-pause').addEventListener('click', () => {
      SJPlayer.togglePause();
      updatePauseButton();
      pushState(true);
    });
    $('#btn-reset').addEventListener('click', () => {
      SJPlayer.reset();
      updateSelectionUI();
      updatePauseButton();
      pushState(true);
    });
    $('#btn-stop').addEventListener('click', () => {
      SJPlayer.stopAll();
      updatePauseButton();
      pushState(true);
    });
    $('#btn-edit').addEventListener('click', () => {
      const sel = SJPlayer.getSelected();
      if (sel) openEditor(sel);
    });

    $('#sel-cols').addEventListener('change', async (e) => {
      const v = parseInt(e.target.value, 10);
      data.ui.cartColumns = v;
      await window.sjapi.setUI({ cartColumns: v });
      renderCarts();
    });

    $('#server-badge').addEventListener('click', async () => {
      const info = await window.sjapi.getNetwork();
      const url = info.interfaces[0]?.url || info.url;
      try {
        await navigator.clipboard.writeText(url);
        $('#server-badge').title = 'Copied ' + url;
      } catch {
        /* ignore */
      }
    });

    window.sjapi.onRemoteCommand(handleRemote);
    window.sjapi.onDropPaths((paths) => addFiles(paths));

    requestAnimationFrame(tick);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.addEventListener('DOMContentLoaded', init);
})();
