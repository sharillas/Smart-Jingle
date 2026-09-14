(function () {
  'use strict';

  const active = new Map();
  let paused = false;
  let selectedCartId = null;
  let lastPlayedId = null;

  function audioUrl(file) {
    return 'sj://media/' + encodeURIComponent(file);
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + String(s.toFixed(1)).padStart(4, '0');
  }

  function cartEnd(cart) {
    return cart.out !== null && cart.out !== undefined && cart.out > 0 ? cart.out : Infinity;
  }

  function play(cartId, getCart) {
    const cart = getCart(cartId);
    if (!cart) return false;

    stopCart(cartId);

    const audio = new Audio(audioUrl(cart.file));
    audio.volume = Math.min(1, Math.max(0, cart.volume ?? 1));
    const inS = cart.in || 0;
    const outS = cartEnd(cart);
    const inst = { id: cartId, audio, inS, outS, startedAt: Date.now() - inS * 1000, stopped: false };
    active.set(cartId, inst);

    audio.addEventListener('loadedmetadata', () => {
      if (inst.stopped || inst.audio !== audio) return;
      try {
        audio.currentTime = Math.min(inS, (audio.duration || 0) - 0.05);
      } catch (e) {
        /* ignore */
      }
    });
    audio.addEventListener('timeupdate', () => {
      if (inst.stopped || inst.audio !== audio) return;
      if (outS !== Infinity && audio.currentTime >= outS) {
        stopCart(cartId);
      }
    });
    audio.addEventListener('ended', () => {
      if (inst.stopped) return;
      stopCart(cartId);
    });
    audio.addEventListener('error', () => {
      if (inst.stopped) return;
      console.error('PLAYER: audio error', cartId, audio.error ? audio.error.code : '?');
      stopCart(cartId);
    });
    audio.play().catch(() => stopCart(cartId));

    selectedCartId = cartId;
    lastPlayedId = cartId;
    if (paused) paused = false;
    return true;
  }

  function stopCart(cartId) {
    const inst = active.get(cartId);
    if (!inst) return false;
    inst.stopped = true;
    active.delete(cartId);
    try {
      inst.audio.pause();
      inst.audio.src = '';
      inst.audio.load();
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function stopAll() {
    for (const id of [...active.keys()]) stopCart(id);
  }

  function reset() {
    stopAll();
    paused = false;
    selectedCartId = null;
  }

  function togglePause() {
    if (active.size === 0) {
      paused = false;
      return false;
    }
    paused = !paused;
    for (const inst of active.values()) {
      if (paused) inst.audio.pause();
      else inst.audio.play().catch(() => {});
    }
    return paused;
  }

  function go(getCart) {
    const target = selectedCartId || lastPlayedId;
    if (!target) return false;
    return play(target, getCart);
  }

  function state(getCart) {
    const playing = [];
    for (const inst of active.values()) {
      const cart = getCart(inst.id);
      if (!cart) continue;
      const end = inst.outS === Infinity ? inst.audio.duration || 0 : inst.outS;
      const current = inst.audio.currentTime || 0;
      const duration = Math.max(0.01, (end || 0) - (inst.inS || 0));
      playing.push({
        cartId: inst.id,
        name: cart.name,
        playlistId: cart.playlistId || null,
        currentTime: Math.max(0, current - (inst.inS || 0)),
        duration: isFinite(duration) ? duration : 0,
        progress: Math.min(1, Math.max(0, (current - (inst.inS || 0)) / (duration || 1))),
        in: inst.inS,
        out: inst.outS === Infinity ? null : inst.outS,
      });
    }
    return { playing, paused, selectedCartId };
  }

  window.SJPlayer = {
    play,
    stopCart,
    stopAll,
    reset,
    togglePause,
    go,
    state,
    fmt,
    isActive: (id) => active.has(id),
    getSelected: () => selectedCartId,
    setSelected: (id) => (selectedCartId = id),
  };
})();
