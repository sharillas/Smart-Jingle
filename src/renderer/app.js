(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const t = (key, vars) => window.SJI18N.t(key, vars);

  const COLORS = [null, '#2f81f7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#f97316', '#84cc16', '#14b8a6', '#6366f1', '#d946ef', '#eab308', '#0ea5e9', '#94a3b8'];

  let data = null;
  let waveCache = new Map();
  let statePushTimer = 0;
  let lastStateJson = '';
  let dragId = null;

  /* ---------------- data helpers ---------------- */

  function activePlaylist() {
    return data.playlists.find((p) => p.id === data.ui.activePlaylistId) || data.playlists[0] || null;
  }

  function findCart(cartId) {
    for (const p of data.playlists) {
      const c = p.carts.find((c) => c.id === cartId || c.cid === cartId);
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
        if (confirm(t('delete_pl_confirm', { name: p.name, n: p.carts.length }))) {
          await window.sjapi.removePlaylist(p.id);
          await refreshData();
          renderPlaylists();
          renderCarts();
          pushState(true);
          window.sjapi.notifyHotkeys();
        }
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [
          { label: t('rename_playlist'), action: () => renamePlaylist(p) },
          { label: t('delete_playlist'), danger: true, action: async () => {
              if (confirm(t('delete_pl_confirm', { name: p.name, n: p.carts.length }))) {
                await window.sjapi.removePlaylist(p.id);
                await refreshData();
                renderPlaylists();
                renderCarts();
                pushState(true);
                window.sjapi.notifyHotkeys();
              }
            } },
        ]);
      });
      ul.appendChild(li);
    }
    $('#carts-title').textContent = activePlaylist() ? activePlaylist().name : t('jingle_p');
  }

  function renderCarts() {
    const grid = $('#carts-grid');
    grid.style.setProperty('--cols', data.ui.cartColumns || 8);
    grid.dataset.size = data.ui.cartSize || 'normal';
    grid.innerHTML = '';
    const pl = activePlaylist();
    const allCarts = pl ? pl.carts : [];

    const q = ($('#cart-search')?.value || '').trim().toLowerCase();
    const carts = q
      ? allCarts.filter((c) =>
          [c.name, c.cid, c.hotkey, c.mode].some((v) => String(v || '').toLowerCase().includes(q))
        )
      : allCarts;

    const rowsView = data.ui.cartView === 'rows';
    grid.classList.toggle('rows-view', rowsView);
    $('#carts-count').textContent = q
      ? t('filtered', { shown: carts.length, total: allCarts.length })
      : (allCarts.length + ' ' + t(allCarts.length === 1 ? 'jingle_s' : 'jingle_p'));

    $('#empty-hint').classList.toggle('hidden', allCarts.length > 0);

    const bindEvents = (el, cart) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.cart-tools, .row-tools')) return;
        SJPlayer.play(cart.id, (id) => findCart(id)?.cart);
        updateSelectionUI();
        updatePauseButton();
        pushState(true);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        SJPlayer.setSelected(cart.id);
        updateSelectionUI();
        pushState(true);
      });
    };

    const clearDropIndicators = () => {
      for (const el of grid.querySelectorAll('.drop-before, .drop-after, .dragging')) {
        el.classList.remove('drop-before', 'drop-after', 'dragging');
      }
    };

    const bindDrag = (el, cart) => {
      const isRow = el.classList.contains('cart-row');
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        dragId = cart.id;
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', cart.id);
        } catch {
          /* ignore */
        }
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        dragId = null;
        clearDropIndicators();
      });
      el.addEventListener('dragover', (e) => {
        if (!dragId || dragId === cart.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const before = isRow
          ? e.clientY - rect.top < rect.height / 2
          : e.clientX - rect.left < rect.width / 2;
        el.classList.toggle('drop-before', before);
        el.classList.toggle('drop-after', !before);
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drop-before', 'drop-after');
      });
      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        const id = dragId;
        dragId = null;
        clearDropIndicators();
        if (!id || id === cart.id) return;
        const rect = el.getBoundingClientRect();
        const before = isRow
          ? e.clientY - rect.top < rect.height / 2
          : e.clientX - rect.left < rect.width / 2;
        const idx = allCarts.findIndex((c) => c.id === cart.id);
        const beforeId = before ? cart.id : (allCarts[idx + 1] ? allCarts[idx + 1].id : null);
        await window.sjapi.moveCart(pl.id, id, beforeId);
        await refreshData();
        renderCarts();
        pushState(true);
        window.sjapi.notifyHotkeys();
      });
    };

    for (const cart of carts) {
      if (rowsView) {
        const row = document.createElement('div');
        row.className = 'cart-row';
        row.dataset.id = cart.id;
        if (cart.color) row.style.setProperty('--cart-color', cart.color);
        if (SJPlayer.isActive(cart.id)) row.classList.add('playing');
        if (SJPlayer.getSelected() === cart.id) row.classList.add('selected');
        const dur = cartDuration(cart);
        const durTxt = dur ? SJPlayer.fmt(dur) : '—';
        row.innerHTML = `
          <span class="row-cid">${escapeHtml(cart.cid)}</span>
          <span class="row-name"></span>
          <span class="row-badges">
            ${cart.hotkey ? `<span class="badge key">${escapeHtml(cart.hotkey)}</span>` : ''}
            ${cart.mode === 'loop' ? `<span class="badge loop">∞</span>` : ''}
            ${(cart.volume ?? 1) < 1 ? `<span class="badge vol">VOL ${Math.round((cart.volume ?? 1) * 100)}%</span>` : ''}
          </span>
          <span class="row-times">${t('in')} ${SJPlayer.fmt(cart.in || 0)} · ${t('out')} ${cart.out ? SJPlayer.fmt(cart.out) : durTxt} · ${t('dur')} ${SJPlayer.fmt((cart.out || dur || 0) - (cart.in || 0))}</span>
          <span class="row-progress"></span>
          <span class="row-tools">
            <span class="cart-edit" title="Edit settings">&#9998;</span>
          </span>`;
        row.querySelector('.row-name').textContent = cart.name;
        bindEvents(row, cart);
        bindDrag(row, cart);
        row.querySelector('.cart-edit').addEventListener('click', () => openEditor(cart.id));
        grid.appendChild(row);
        continue;
      }

      const btn = document.createElement('button');
      btn.className = 'cart';
      btn.dataset.id = cart.id;
      if (cart.color) btn.style.setProperty('--cart-color', cart.color);
      if (SJPlayer.isActive(cart.id)) btn.classList.add('playing');
      if (SJPlayer.getSelected() === cart.id) btn.classList.add('selected');

      const dur = cartDuration(cart);
      const durTxt = dur ? SJPlayer.fmt(dur) : '—';
      const baseMeta = `${cart.cid} · ${durTxt}${cart.out ? ' · ' + t('out') + ' ' + SJPlayer.fmt(cart.out) : ''}${cart.mode === 'loop' ? ' · ∞' : ''}`;

      btn.innerHTML = `
        <span class="cart-name"></span>
        <span class="cart-meta">${escapeHtml(baseMeta)}</span>
        <span class="cart-progress"></span>
        ${cart.hotkey ? `<span class="cart-hotkey">${escapeHtml(cart.hotkey)}</span>` : ''}
        <span class="cart-tools">
          <span class="cart-edit" title="Edit settings">&#9998;</span>
        </span>`;
      btn.querySelector('.cart-name').textContent = cart.name;
      btn.querySelector('.cart-meta').dataset.base = baseMeta;
      btn.querySelector('.cart-meta').dataset.loop = cart.mode === 'loop' ? '1' : '0';

      bindEvents(btn, cart);
      bindDrag(btn, cart);
      btn.querySelector('.cart-edit').addEventListener('click', () => openEditor(cart.id));

      grid.appendChild(btn);
    }
    updateCartPlayStates();
  }

  function updateSelectionUI() {
    for (const el of document.querySelectorAll('.cart, .cart-row')) {
      el.classList.toggle('selected', el.dataset.id === SJPlayer.getSelected());
    }
    drawWavebar();
  }

  function updateCartPlayStates() {
    for (const el of document.querySelectorAll('.cart, .cart-row')) {
      const id = el.dataset.id;
      const playing = SJPlayer.isActive(id);
      el.classList.toggle('playing', playing);
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
  let wavebarView = null;
  let lastWbSel = null;

  function drawWavebar() {
    const canvas = $('#wavebar-canvas');
    const container = $('#wavebar');
    const sel = SJPlayer.getSelected();
    const found = sel ? findCart(sel) : null;

    if (lastWbSel !== sel) {
      lastWbSel = sel;
      wavebarView = null;
    }

    if (!found) {
      $('#wb-name').textContent = t('no_selected');
      $('#wb-times').innerHTML = '—';
      $('#wb-remain-val').textContent = '—';
      $('#wb-remain').classList.remove('live');
      $('#btn-edit').disabled = true;
      canvas.width = 0;
      return;
    }

    $('#wb-name').textContent = found.cart.cid + ' · ' + found.cart.name;
    $('#btn-edit').disabled = false;

    const w = waveCache.get(sel);
    if (!w) {
      $('#wb-times').innerHTML = '<span class="muted">' + t('loading') + '</span>';
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

    if (wavebarView && wavebarView.dur >= w.duration - 0.001) wavebarView = null;

    SJWave.drawWave(canvas, w, {
      inS,
      outS,
      playhead,
      selected: true,
      view: wavebarView,
      ruler: true,
      colors: { inside: '#3f8cff', outside: 'rgba(120,130,150,0.25)' },
    });

    const outTxt = outS ? SJPlayer.fmt(outS) : SJPlayer.fmt(w.duration);
    $('#wb-times').innerHTML =
      `${t('in')} <b class="in-t">${SJPlayer.fmt(inS)}</b> &nbsp;·&nbsp; ${t('out')} <b class="out-t">${outTxt}</b> &nbsp;·&nbsp; ${t('dur')} <b>${SJPlayer.fmt((outS || w.duration) - inS)}</b>`;

    const remainEl = $('#wb-remain-val');
    if (playing) {
      const remain = Math.max(0, playing.duration - playing.currentTime);
      remainEl.textContent = SJPlayer.fmt(remain);
      $('#wb-remain').classList.add('live');
    } else {
      remainEl.textContent = '—';
      $('#wb-remain').classList.remove('live');
    }

    if (!wavebarLoop) {
      wavebarLoop = setInterval(drawWavebar, 200);
    }
  }

  function wavebarZoom(e) {
    const canvas = $('#wavebar-canvas');
    const sel = SJPlayer.getSelected();
    const w = sel ? waveCache.get(sel) : null;
    if (!w) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const old = wavebarView || { start: 0, dur: w.duration };
    const tAt = old.start + (x / Math.max(1, rect.width)) * old.dur;
    const factor = e.deltaY > 0 ? 1.3 : 1 / 1.3;
    let nd = Math.min(w.duration, Math.max(0.5, old.dur * factor));
    let ns = tAt - (x / Math.max(1, rect.width)) * nd;
    ns = Math.max(0, Math.min(ns, w.duration - nd));
    wavebarView = { start: ns, dur: nd };
    if (nd >= w.duration - 0.001) wavebarView = null;
    drawWavebar();
  }

  /* ---------------- editor ---------------- */

  let editorCtx = null;

  function openEditor(cartId) {
    const found = findCart(cartId);
    if (!found) return;

    const overlay = $('#modal-overlay');
    const box = $('#modal-box');
    box.innerHTML = `
      <h2>${t('edit_title')} — ${escapeHtml(found.cart.cid)} · ${escapeHtml(found.cart.name)}</h2>
      <div id="editor-wrap">
        <div class="editor-canvas-wrap" id="ed-canvas-wrap"><canvas id="ed-canvas"></canvas></div>
        <div class="editor-readout">
          <span>${t('in')} <span class="val in-val" id="ed-in">0:00.0</span></span>
          <span>${t('out')} <span class="val out-val" id="ed-out">0:00.0</span></span>
          <span>${t('dur')} <span class="val" id="ed-dur">0:00.0</span></span>
          <span id="ed-pos">${t('pos')} 0:00.0</span>
        </div>
        <div class="editor-controls">
          <button class="mini-btn" id="ed-play">${t('preview')}</button>
          <button class="mini-btn" id="ed-stop">${t('stop')}</button>
          <button class="mini-btn" id="ed-set-in">${t('set_in')}</button>
          <button class="mini-btn" id="ed-set-out">${t('set_out')}</button>
          <button class="mini-btn" id="ed-clear">${t('clear_points')}</button>
          <button class="mini-btn" id="ed-fit">${t('fit')}</button>
        </div>
        <div class="field" style="display:flex;gap:10px;">
          <div style="flex:1"><label>${t('in')} (sec)</label><input type="number" step="0.1" min="0" id="ed-in-num"></div>
          <div style="flex:1"><label>${t('out')} (sec)</label><input type="number" step="0.1" min="0" id="ed-out-num"></div>
        </div>
        <div class="field">
          <label>${t('gain')} <span class="val" id="ed-vol-val">100%</span> · <span class="val" id="ed-db-val">0.0 dB</span></label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input type="range" id="ed-vol" min="0" max="100" step="1" value="100" style="flex:1;">
            <input type="number" id="ed-db" step="0.5" min="-60" max="12" value="0" style="width:90px;">
          </div>
        </div>
        <div class="field" style="display:flex;gap:10px;">
          <div style="flex:1"><label>${t('fade_in')}</label><input type="number" id="ed-fadein" min="0" step="5" value="${Math.round((found.cart.fadeIn || 0) * 1000)}"></div>
          <div style="flex:1"><label>${t('fade_out')}</label><input type="number" id="ed-fadeout" min="0" step="5" value="${Math.round((found.cart.fadeOut || 0) * 1000)}"></div>
        </div>
        <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="ed-lock" ${found.cart.lock ? 'checked' : ''} style="width:auto;"> ${t('retrigger_lock')}</label></div>
        <div class="field"><label>${t('color')}</label><div class="swatches" id="ed-swatches"></div><input type="color" id="ed-color-custom" value="${found.cart.color || '#2f81f7'}"></div>
        <div class="field" style="display:flex;gap:10px;">
          <div style="flex:1"><label>${t('name')}</label><input type="text" id="ed-name" value="${escapeHtml(found.cart.name)}"></div>
          <div style="flex:1"><label>${t('jingle_id')}</label><input type="text" id="ed-cid" value="${escapeHtml(found.cart.cid)}"></div>
        </div>
        <div class="field" style="display:flex;gap:10px;">
          <div style="flex:1">
            <label>${t('playback_mode')}</label>
            <select id="ed-mode">
              <option value="once" ${found.cart.mode !== 'loop' ? 'selected' : ''}>${t('mode_once')}</option>
              <option value="loop" ${found.cart.mode === 'loop' ? 'selected' : ''}>${t('mode_loop')}</option>
            </select>
          </div>
          <div style="flex:1">
            <label>${t('shortcut')}</label>
            <button class="mini-btn" id="ed-hotkey" style="width:100%;">${found.cart.hotkey ? t('shortcut') + ': ' + escapeHtml(found.cart.hotkey) : t('shortcut_none')}</button>
          </div>
        </div>
        <div class="editor-controls" style="margin-top:4px;">
          <button class="mini-btn" id="ed-replace">${t('replace_file')}</button>
          <button class="mini-btn" id="ed-duplicate">${t('duplicate')}</button>
          <button class="mini-btn" id="ed-remove" style="color:#ff8b8b;">${t('remove_jingle')}</button>
        </div>
        <p class="editor-hint">Mouse wheel zooms the timeline. Drag the green/red markers, type exact seconds, or press <b>Set IN/OUT</b> while previewing. Click on the waveform to seek.</p>
        <div class="modal-actions">
          <button class="mini-btn" id="ed-cancel">${t('cancel')}</button>
          <button class="mini-btn primary" id="ed-save">${t('save')}</button>
        </div>
      </div>`;

    overlay.classList.remove('hidden');

    const canvas = $('#ed-canvas');
    const wrap = $('#ed-canvas-wrap');
    let wave = null;
    let inS = found.cart.in || 0;
    let outS = found.cart.out || null;
    let vol = Math.round((found.cart.volume ?? 1) * 100);
    let edColor = found.cart.color || null;
    let edName = found.cart.name;
    let edCid = found.cart.cid;
    let edMode = found.cart.mode === 'loop' ? 'loop' : 'once';
    let edHotkey = found.cart.hotkey || null;
    let edFile = found.cart.file;
    let preview = null;
    let dragging = null;
    let edView = null;
    let hotkeyCapture = false;

    const volToDb = (v) => (v <= 0 ? -60 : 20 * Math.log10(v / 100));
    const dbToVol = (db) => Math.max(0, Math.min(100, Math.round(100 * Math.pow(10, db / 20))));

    function viewOf() {
      const dur = wave ? wave.duration : 1;
      return edView || { start: 0, dur };
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth;
      const ch = 236;
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
        view: edView,
        ruler: true,
        gainScale: vol / 100,
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
      const v = viewOf();
      const t = v.start + ((x - rect.left) / Math.max(1, rect.width)) * v.dur;
      return Math.max(0, Math.min(dur, t));
    }

    canvas.addEventListener('mousedown', (e) => {
      if (!wave) return;
      const rect = canvas.getBoundingClientRect();
      const dur = wave.duration;
      const v = viewOf();
      const x = e.clientX - rect.left;
      const t2px = (t) => ((t - v.start) / v.dur) * rect.width;
      const inX = t2px(inS);
      const outX = t2px(outS || dur);
      if (inX >= -2 && inX <= rect.width + 2 && Math.abs(x - inX) < 9) dragging = 'in';
      else if (outS && outX >= -2 && outX <= rect.width + 2 && Math.abs(x - outX) < 9) dragging = 'out';
      else {
        const t = timeFromX(e.clientX);
        if (preview) preview.currentTime = t;
        else {
          preview = new Audio(window.sjapi.audioUrl(edFile));
          preview.volume = vol / 100;
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
        preview = new Audio(window.sjapi.audioUrl(edFile));
        preview.volume = vol / 100;
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
    $('#ed-fit').addEventListener('click', () => {
      edView = null;
      draw();
    });
    canvas.addEventListener('wheel', (e) => {
      if (!wave) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const old = viewOf();
      const tAt = old.start + (x / Math.max(1, rect.width)) * old.dur;
      const factor = e.deltaY > 0 ? 1.3 : 1 / 1.3;
      const nd = Math.min(wave.duration, Math.max(0.2, old.dur * factor));
      let ns = tAt - (x / Math.max(1, rect.width)) * nd;
      ns = Math.max(0, Math.min(ns, wave.duration - nd));
      edView = nd >= wave.duration - 0.001 ? null : { start: ns, dur: nd };
      draw();
    }, { passive: false });
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

    const syncVol = () => {
      $('#ed-vol').value = String(vol);
      $('#ed-vol-val').textContent = vol + '%';
      $('#ed-db-val').textContent = volToDb(vol).toFixed(1) + ' dB';
      $('#ed-db').value = volToDb(vol).toFixed(1);
      if (preview) preview.volume = vol / 100;
      if (wave) draw();
    };
    syncVol();
    $('#ed-vol').addEventListener('input', (e) => {
      vol = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      syncVol();
    });
    $('#ed-db').addEventListener('input', (e) => {
      const db = parseFloat(e.target.value);
      if (isFinite(db)) {
        vol = dbToVol(Math.max(-60, Math.min(12, db)));
        syncVol();
      }
    });

    $('#ed-name').addEventListener('input', (e) => (edName = e.target.value));
    $('#ed-cid').addEventListener('input', (e) => (edCid = e.target.value.trim()));
    $('#ed-mode').addEventListener('change', (e) => (edMode = e.target.value));

    const hotkeyBtn = $('#ed-hotkey');
    const hotkeyLabel = () => (hotkeyCapture ? t('shortcut_press') : (edHotkey ? t('shortcut') + ': ' + edHotkey : t('shortcut_none')));
    const onHotkeyCapture = (e) => {
      if (!hotkeyCapture) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        edHotkey = null;
        hotkeyCapture = false;
        hotkeyBtn.textContent = hotkeyLabel();
        return;
      }
      const k = normalizeKey(e.key);
      if (!k) return;
      edHotkey = k;
      hotkeyCapture = false;
      hotkeyBtn.textContent = hotkeyLabel();
    };
    window.addEventListener('keydown', onHotkeyCapture, true);
    hotkeyBtn.addEventListener('click', () => {
      hotkeyCapture = !hotkeyCapture;
      hotkeyBtn.textContent = hotkeyLabel();
    });

    const edSwGrid = $('#ed-swatches');
    const refreshSwatches = () => {
      for (const s of edSwGrid.children) {
        s.classList.toggle('active', s.dataset.color === String(edColor));
      }
    };
    for (const c of COLORS) {
      const s = document.createElement('div');
      s.className = 'swatch';
      s.dataset.color = String(c);
      if (c === null) s.style.background = 'linear-gradient(135deg, #2f81f7, #1e6fd9)';
      else s.style.background = c;
      s.title = c === null ? 'Default' : c;
      s.addEventListener('click', () => {
        edColor = c;
        refreshSwatches();
      });
      edSwGrid.appendChild(s);
    }
    refreshSwatches();
    $('#ed-color-custom').addEventListener('input', (e) => {
      edColor = e.target.value;
      refreshSwatches();
    });

    $('#ed-replace').addEventListener('click', async () => {
      const files = await window.sjapi.pickAudio();
      if (!files || !files.length) return;
      edFile = files[0];
      await window.sjapi.updateCart(cartId, { file: edFile });
      waveCache.delete(cartId);
      stopPreview();
      loadWave(cartId).then((w) => {
        if (!w) return;
        wave = w;
        inS = 0;
        outS = null;
        edView = null;
        draw();
      });
    });
    $('#ed-duplicate').addEventListener('click', async () => {
      await window.sjapi.addCarts(found.playlist.id, [edFile]);
      await refreshData();
      renderPlaylists();
      renderCarts();
      pushState(true);
    });
    $('#ed-remove').addEventListener('click', async () => {
      if (!confirm(t('remove_confirm'))) return;
      SJPlayer.stopCart(cartId);
      await window.sjapi.removeCart(cartId);
      await refreshData();
      cleanup();
      overlay.classList.add('hidden');
      renderCarts();
      updateSelectionUI();
      pushState(true);
      window.sjapi.notifyHotkeys();
    });

    const previewLoop = setInterval(() => {
      if (preview) {
        const dur = wave ? wave.duration : 1;
        const out = outS || dur;
        if (preview.currentTime >= out) {
          stopPreview();
        }
        $('#ed-pos').textContent = t('pos') + ' ' + SJPlayer.fmt(preview.currentTime || 0);
        draw();
      }
    }, 100);

    function cleanup() {
      clearInterval(previewLoop);
      stopPreview();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onHotkeyCapture, true);
      editorCtx = null;
    }

    $('#ed-cancel').addEventListener('click', () => {
      cleanup();
      overlay.classList.add('hidden');
    });
    $('#ed-save').addEventListener('click', async () => {
      try {
        await window.sjapi.updateCart(cartId, {
          in: inS,
          out: outS || null,
          volume: vol / 100,
          color: edColor,
          name: edName,
          cid: edCid,
          mode: edMode,
          hotkey: edHotkey,
          file: edFile,
          fadeIn: (parseFloat($('#ed-fadein').value) || 0) / 1000,
          fadeOut: (parseFloat($('#ed-fadeout').value) || 0) / 1000,
          lock: $('#ed-lock').checked,
        });
      } catch (e) {
        const msg = String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, '');
        alert(msg);
        return;
      }
      await refreshData();
      cleanup();
      overlay.classList.add('hidden');
      renderCarts();
      drawWavebar();
      pushState(true);
      window.sjapi.notifyHotkeys();
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
    const name = await promptModal(t('rename_playlist'), p.name);
    if (name) {
      await window.sjapi.renamePlaylist(p.id, name);
      await refreshData();
      renderPlaylists();
    }
  }

  function normalizeKey(key) {
    if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
    if (/^[0-9]$/.test(key)) return key;
    if (/^[a-z]$/i.test(key) && key.length === 1) return key.toUpperCase();
    return null;
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

  async function listOutputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      if (!outs.length) return [{ id: 'default', label: 'System default' }];
      const list = [{ id: 'default', label: 'System default' }];
      for (const d of outs) {
        if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const label = d.label || 'Output device ' + (list.length);
        list.push({
          id: d.deviceId,
          label: label + (/dante|dvs/i.test(label) ? '  [DVS]' : ''),
        });
      }
      return list;
    } catch {
      return [{ id: 'default', label: 'System default' }];
    }
  }

  async function openSettings() {
    const overlay = $('#modal-overlay');
    const box = $('#modal-box');
    const s = data.settings;
    box.innerHTML = `
      <h2>${t('settings_title')}</h2>
      <div class="field"><label>${t('remote_port')}</label><input type="number" id="set-port" value="${s.port}"></div>
      <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="set-remote" ${s.remoteEnabled !== false ? 'checked' : ''} style="width:auto;"> ${t('enable_remote')}</label></div>
      <div class="field"><label>${t('remote_pin')}</label><input type="text" id="set-pin" value="${escapeHtml(s.remotePin || '')}" placeholder="1234"></div>
      <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="set-osc" ${s.oscEnabled === true ? 'checked' : ''} style="width:auto;"> ${t('osc_enable')}
        <input type="number" id="set-osc-port" value="${s.oscPort || 4410}" style="width:90px;margin-left:8px;"></label></div>
      <div class="field"><label>${t('audio_device')}</label>
        <div style="display:flex;gap:8px;">
          <select id="set-device" style="flex:1;"></select>
          <button class="mini-btn" id="set-device-refresh" title="Rescan devices">&#8635;</button>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">${t('dvs_hint')}</div>
      </div>
      <div class="field"><label>${t('network')}</label><div id="set-net" style="font-size:11px;color:var(--muted);line-height:1.7;"></div></div>
      <p class="editor-hint">${t('restart_hint')}</p>
      <div class="modal-actions">
        <button class="mini-btn" id="set-cancel">${t('cancel')}</button>
        <button class="mini-btn primary" id="set-save">${t('save')}</button>
      </div>`;
    overlay.classList.remove('hidden');

    const info = await window.sjapi.getNetwork();
    const net = $('#set-net');
    net.innerHTML = `<div><b>${t('local')}:</b> ${info.url}</div>` +
      info.interfaces.map((i) => `<div><b>${i.interface}:</b> ${i.url}</div>`).join('');

    const sel = $('#set-device');
    const fillDevices = async () => {
      const devices = await listOutputDevices();
      const current = s.outputDeviceId || 'default';
      sel.innerHTML = '';
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.label;
        if (d.id === current || (current !== 'default' && !devices.some((x) => x.id === current) && d.id === 'default')) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      }
      window.sjapi.sendDevices(devices);
    };
    await fillDevices();
    $('#set-device-refresh').addEventListener('click', fillDevices);
    $('#set-device').addEventListener('change', () => {
      SJPlayer.setOutputDevice(sel.value);
    });

    $('#set-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    $('#set-save').addEventListener('click', async () => {
      await window.sjapi.setSettings({
        port: parseInt($('#set-port').value, 10) || 4405,
        remoteEnabled: $('#set-remote').checked,
        remotePin: ($('#set-pin').value || '').trim(),
        outputDeviceId: sel.value || 'default',
        masterVolume: data.settings.masterVolume,
        oscEnabled: $('#set-osc').checked,
        oscPort: parseInt($('#set-osc-port').value, 10) || 4410,
      });
      SJPlayer.setOutputDevice(sel.value || 'default');
      await refreshData();
      overlay.classList.add('hidden');
      window.sjapi.notifySettings();
    });
  }

  /* ---------------- state push ---------------- */

  function buildState() {
    const pl = activePlaylist();
    return {
      app: 'Smart Jingle',
      version: '0.2.0',
      paused: SJPlayer.state((id) => findCart(id)?.cart).paused,
      selectedCartId: SJPlayer.getSelected(),
      activePlaylistId: pl ? pl.id : null,
      playlistLoop: !!data.ui.playlistLoop,
      playing: SJPlayer.state((id) => findCart(id)?.cart).playing,
      playlists: data.playlists.map((p) => ({ id: p.id, name: p.name, carts: p.carts.length })),
      carts: data.playlists.flatMap((p) =>
        p.carts.map((c) => ({
          id: c.id,
          cid: c.cid || c.id,
          name: c.name,
          playlistId: p.id,
          playlistName: p.name,
          color: c.color,
          in: c.in,
          out: c.out,
          volume: c.volume,
          mode: c.mode || 'once',
          hotkey: c.hotkey || null,
          fadeIn: c.fadeIn || 0,
          fadeOut: c.fadeOut || 0,
          lock: !!c.lock,
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
        SJPlayer.go((id) => findCart(id)?.cart, () => (activePlaylist() ? activePlaylist().carts.map((c) => c.id) : []));
        updateSelectionUI();
        break;
      case 'pause':
        SJPlayer.togglePause();
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
      case 'loop-playlist':
        togglePlaylistLoop();
        break;
      case 'activate-playlist': {
        if (data.playlists.some((p) => p.id === cmd.playlistId)) {
          data.ui.activePlaylistId = cmd.playlistId;
          window.sjapi.setUI({ activePlaylistId: cmd.playlistId });
          renderPlaylists();
          renderCarts();
          pushState(true);
          window.sjapi.notifyHotkeys();
        }
        break;
      }
      case 'add-files':
        addFiles();
        break;
      case 'new-playlist':
        addPlaylist();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 'set-device':
        SJPlayer.setOutputDevice(cmd.deviceId);
        break;
      case 'global-hotkey': {
        const pl = activePlaylist();
        if (pl) {
          const cart = pl.carts.find((c) => c.hotkey === cmd.hotkey);
          if (cart) {
            SJPlayer.play(cart.id, (id) => findCart(id)?.cart);
            updateSelectionUI();
            updatePauseButton();
            pushState(true);
          }
        }
        break;
      }
      case 'edit-cart': {
        const sel = SJPlayer.getSelected();
        if (sel) openEditor(sel);
        break;
      }
      case 'language-changed':
        data.settings.language = cmd.language || 'en';
        SJI18NApply();
        renderPlaylists();
        renderCarts();
        drawWavebar();
        pushState(true);
        break;
      case 'project-loaded':
        (async () => {
          await refreshData();
          SJPlayer.reset();
          SJPlayer.setMasterVolume(data.settings.masterVolume ?? 1);
          SJPlayer.setOutputDevice(data.settings.outputDeviceId || 'default');
          const mvv = $('#master-vol');
          mvv.value = String(Math.round((data.settings.masterVolume ?? 1) * 100));
          $('#master-vol-val').textContent = mvv.value + '%';
          waveCache.clear();
          wavebarView = null;
          lastWbSel = null;
          $('#btn-loop-pl').classList.toggle('on', !!data.ui.playlistLoop);
          $('#btn-view').textContent = data.ui.cartView === 'rows' ? '\u229E ' + t('grid') : '\u2630 ' + t('rows');
          $('#sel-cols').value = String(data.ui.cartColumns || 8);
          renderPlaylists();
          renderCarts();
          drawWavebar();
          pushState(true);
          showToast(t('project_loaded'));
        })();
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
    window.sjapi.notifyHotkeys();
  }

  async function addPlaylist() {
    const name = await promptModal(t('new_playlist'), '', t('playlist_name'));
    if (name) {
      await window.sjapi.addPlaylist(name);
      await refreshData();
      renderPlaylists();
      renderCarts();
      pushState(true);
    }
  }

  async function togglePlaylistLoop() {
    data.ui.playlistLoop = !data.ui.playlistLoop;
    await window.sjapi.setUI({ playlistLoop: data.ui.playlistLoop });
    $('#btn-loop-pl').classList.toggle('on', !!data.ui.playlistLoop);
    pushState(true);
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
  }

  function SJI18NApply() {
    window.SJI18N.apply(data.settings.language || 'en');
    $('#btn-view').textContent = data.ui.cartView === 'rows' ? '\u229E ' + t('grid') : '\u2630 ' + t('rows');
  }

  /* ---------------- main loop ---------------- */

  function tick() {
    const st = SJPlayer.state((id) => findCart(id)?.cart);
    for (const el of document.querySelectorAll('.cart, .cart-row')) {
      const p = st.playing.find((x) => x.cartId === el.dataset.id);
      const bar = el.querySelector('.cart-progress, .row-progress');
      if (bar) bar.style.width = (p ? p.progress * 100 : 0) + '%';
      const meta = el.querySelector('.cart-meta');
      if (meta) {
        if (p) {
          const cid = (meta.dataset.base || '').split(' · ')[0];
          meta.textContent = cid + ' · ' + t('rem') + ' ' + SJPlayer.fmt(Math.max(0, p.duration - p.currentTime)) + (meta.dataset.loop === '1' ? ' · ∞' : '');
        } else if (meta.dataset.base) {
          meta.textContent = meta.dataset.base;
        }
      }
    }

    const selPlaying = st.playing.find((x) => x.cartId === SJPlayer.getSelected());
    const live = selPlaying || st.playing[0] || null;
    const hr = $('#header-remain-time');
    if (hr) {
      if (live) {
        hr.textContent = SJPlayer.fmt(Math.max(0, live.duration - live.currentTime));
        hr.style.color = '#ffffff';
      } else {
        hr.textContent = '–:––';
        hr.style.color = '#6b7691';
      }
    }

    const onair = $('#onair');
    onair.classList.toggle('on', st.playing.length > 0);
    const vu = $('#vu-meter');
    if (vu && vu.children.length) {
      let peak = 0;
      const lvls = SJPlayer.readLevels();
      for (const id of Object.keys(lvls)) {
        if (lvls[id] > peak) peak = lvls[id];
      }
      if (!st.playing.length) peak = 0;
      const lit = Math.min(vu.children.length, Math.round(peak * vu.children.length * 1.15));
      for (let i = 0; i < vu.children.length; i++) {
        const seg = vu.children[i];
        seg.classList.toggle('lit', i < lit);
        seg.classList.toggle('warn', i < lit && i >= vu.children.length - 4);
        seg.classList.toggle('hot', i < lit && i >= vu.children.length - 1);
      }
    }

    pushState(false);
    requestAnimationFrame(tick);
  }

  /* ---------------- init ---------------- */

  async function init() {
    await refreshData();

    $('#sel-cols').value = String(data.ui.cartColumns || 8);
    SJI18NApply();
    renderPlaylists();
    renderCarts();
    drawWavebar();

    const vu = $('#vu-meter');
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.className = 'vu-seg';
      vu.appendChild(s);
    }

    SJPlayer.setMasterVolume(data.settings.masterVolume ?? 1);
    SJPlayer.setOutputDevice(data.settings.outputDeviceId || 'default');
    const mv = $('#master-vol');
    mv.value = String(Math.round((data.settings.masterVolume ?? 1) * 100));
    $('#master-vol-val').textContent = mv.value + '%';
    mv.addEventListener('input', () => {
      SJPlayer.setMasterVolume(parseInt(mv.value, 10) / 100);
      $('#master-vol-val').textContent = mv.value + '%';
    });
    mv.addEventListener('change', async () => {
      data.settings.masterVolume = parseInt(mv.value, 10) / 100;
      await window.sjapi.setSettings({ masterVolume: data.settings.masterVolume });
    });

    $('#btn-add-playlist').addEventListener('click', addPlaylist);
    $('#btn-add-files').addEventListener('click', async () => {
      const files = await window.sjapi.pickAudio();
      if (files && files.length) addFiles(files);
    });

    $('#btn-go').addEventListener('click', () => {
      SJPlayer.go((id) => findCart(id)?.cart, () => (activePlaylist() ? activePlaylist().carts.map((c) => c.id) : []));
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

    const wavebarCanvas = $('#wavebar-canvas');
    wavebarCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      wavebarZoom(e);
    }, { passive: false });
    wavebarCanvas.addEventListener('dblclick', () => {
      wavebarView = null;
      drawWavebar();
    });

    $('#sel-cols').addEventListener('change', async (e) => {
      const v = parseInt(e.target.value, 10);
      data.ui.cartColumns = v;
      await window.sjapi.setUI({ cartColumns: v });
      renderCarts();
    });

    const sizeSeg = $('#size-seg');
    const setSizeSeg = () => {
      for (const b of sizeSeg.querySelectorAll('.seg-btn')) {
        b.classList.toggle('active', b.dataset.v === (data.ui.cartSize || 'normal'));
      }
    };
    setSizeSeg();
    sizeSeg.addEventListener('click', async (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      data.ui.cartSize = b.dataset.v;
      await window.sjapi.setUI({ cartSize: data.ui.cartSize });
      setSizeSeg();
      renderCarts();
    });

    window.sjapi.onRemoteCommand(handleRemote);
    window.sjapi.onDropPaths((paths) => addFiles(paths));

    window.sjapi.getVersion().then((v) => {
      const el = $('#footer-version');
      if (el && v) el.textContent = ' · v' + v;
    }).catch(() => {});

    $('#btn-loop-pl').classList.toggle('on', !!data.ui.playlistLoop);
    $('#btn-loop-pl').addEventListener('click', togglePlaylistLoop);

    $('#btn-view').textContent = data.ui.cartView === 'rows' ? '\u229E ' + t('grid') : '\u2630 ' + t('rows');
    $('#btn-view').addEventListener('click', async () => {
      data.ui.cartView = data.ui.cartView === 'rows' ? 'grid' : 'rows';
      await window.sjapi.setUI({ cartView: data.ui.cartView });
      $('#btn-view').textContent = data.ui.cartView === 'rows' ? '\u229E ' + t('grid') : '\u2630 ' + t('rows');
      renderCarts();
    });
    $('#cart-search').addEventListener('input', () => renderCarts());

    listOutputDevices().then((devices) => window.sjapi.sendDevices(devices)).catch(() => {});

    SJPlayer.setEndedHandler((cartId) => {
      if (!data.ui.playlistLoop) return;
      const pl = activePlaylist();
      if (!pl || pl.carts.length < 1) return;
      const idx = pl.carts.findIndex((c) => c.id === cartId || c.cid === cartId);
      if (idx === -1) return;
      const next = pl.carts[(idx + 1) % pl.carts.length];
      SJPlayer.play(next.id, (id) => findCart(id)?.cart);
      SJPlayer.setSelected(pl.carts[(idx + 2) % pl.carts.length].id);
      updateSelectionUI();
      updatePauseButton();
      pushState(true);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!$('#modal-overlay').classList.contains('hidden')) return;
      const k = normalizeKey(e.key);
      if (!k) return;
      const pl = activePlaylist();
      if (!pl) return;
      const cart = pl.carts.find((c) => c.hotkey === k);
      if (cart) {
        e.preventDefault();
        SJPlayer.play(cart.id, (id) => findCart(id)?.cart);
        updateSelectionUI();
        updatePauseButton();
        pushState(true);
      }
    });

    window.sjapi.onUpdateAvailable((info) => {
      $('#upd-text').textContent = t('update_available', { version: info.version });
      $('#update-banner').classList.remove('hidden');
      $('#upd-download').textContent = t('download');
      $('#upd-download').onclick = () => window.sjapi.openExternal(info.url);
    });
    window.sjapi.onUpdateNone(() => showToast(t('up_to_date')));
    $('#upd-close').addEventListener('click', () => $('#update-banner').classList.add('hidden'));

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
