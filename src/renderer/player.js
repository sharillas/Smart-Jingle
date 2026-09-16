(function () {
  'use strict';

  const active = new Map();
  let paused = false;
  let selectedCartId = null;
  let lastPlayedId = null;
  let endedHandler = null;
  let masterVolume = 1;
  let outputDeviceId = 'default';

  let vuCtx = null;
  let levels = {};

  const PAUSE_FADE_S = 0.12;
  const LOOP_XFADE_S = 0.05;
  const MIN_FADE_S = 0.06;

  function setEndedHandler(fn) {
    endedHandler = fn;
  }

  function setMasterVolume(v) {
    masterVolume = Math.min(1, Math.max(0, Number(v) || 0));
    for (const inst of active.values()) {
      try {
        inst.baseTarget = (inst.baseVolume || 1) * masterVolume;
        if (!inst.fading && !inst.fadeInProgress) {
          inst.audio.volume = inst.baseTarget;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  function setOutputDevice(id) {
    outputDeviceId = id || 'default';
    for (const inst of active.values()) {
      applySink(inst.audio);
    }
  }

  function applySink(audio) {
    try {
      if (audio.setSinkId && outputDeviceId && outputDeviceId !== 'default') {
        audio.setSinkId(outputDeviceId).catch(() => {});
      }
    } catch (e) {
      /* ignore */
    }
  }

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

  function connectVU(inst) {
    if (outputDeviceId && outputDeviceId !== 'default') return;
    try {
      if (!vuCtx) {
        vuCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (vuCtx.state === 'suspended') vuCtx.resume().catch(() => {});
      const src = vuCtx.createMediaElementSource(inst.audio);
      const analyser = vuCtx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyser.connect(vuCtx.destination);
      inst.analyser = analyser;
      inst.level = 0;
    } catch (e) {
      /* VU unavailable */
    }
  }

  function rampVolume(inst, from, to, seconds, done) {
    if (inst.stopped) return;
    inst.fading = true;
    const start = performance.now();
    const dur = Math.max(1, (seconds || 0) * 1000);
    const step = () => {
      if (inst.stopped) return;
      const t = Math.min(1, (performance.now() - start) / dur);
      try {
        inst.audio.volume = from + (to - from) * t;
      } catch (e) {
        /* ignore */
      }
      if (t < 1) {
        inst.rampTimer = requestAnimationFrame(step);
      } else {
        inst.fading = false;
        if (done) done();
      }
    };
    inst.rampTimer = requestAnimationFrame(step);
  }

  function finishStop(inst, cartId) {
    if (inst.stopped) return;
    inst.stopped = true;
    if (active.get(cartId) === inst) active.delete(cartId);
    if (levels[cartId]) delete levels[cartId];
    try {
      if (inst.rampTimer) cancelAnimationFrame(inst.rampTimer);
      inst.audio.pause();
      inst.audio.src = '';
      inst.audio.load();
    } catch (e) {
      /* ignore */
    }
  }

  function stopCart(cartId, opts) {
    const inst = active.get(cartId);
    if (!inst || inst.stopped) return false;
    const instant = !!(opts && opts.instant);
    if (instant || inst.fading) {
      finishStop(inst, cartId);
      return true;
    }
    const dur = Math.max(MIN_FADE_S, inst.fadeOut || 0);
    rampVolume(inst, inst.audio.volume, 0, dur, () => {
      if (!inst.stopped && active.get(cartId) === inst) {
        finishStop(inst, cartId);
      }
    });
    return true;
  }

  function stopAll(opts) {
    for (const id of [...active.keys()]) stopCart(id, opts);
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
      if (inst.stopped) continue;
      if (paused) {
        if (inst.fading) continue;
        rampVolume(inst, inst.audio.volume, 0, PAUSE_FADE_S, () => {
          if (!inst.stopped && paused && !inst.fading) {
            try {
              inst.audio.pause();
            } catch (e) {
              /* ignore */
            }
          }
        });
      } else {
        try {
          inst.audio.play().catch(() => {});
        } catch (e) {
          /* ignore */
        }
        if (!inst.fading) {
          rampVolume(inst, 0, inst.baseTarget, PAUSE_FADE_S);
        }
      }
    }
    return paused;
  }

  function loopJump(inst, resolvedId) {
    if (inst.stopped || inst.fading) return;
    inst.fading = true;
    rampVolume(inst, inst.audio.volume, 0, LOOP_XFADE_S, () => {
      if (inst.stopped) return;
      try {
        inst.audio.currentTime = inst.inS;
      } catch (e) {
        /* ignore */
      }
      inst.fading = false;
      rampVolume(inst, 0, inst.baseTarget, LOOP_XFADE_S);
    });
  }

  function play(cartId, getCart) {
    const cart = getCart(cartId);
    if (!cart) return false;
    const resolvedId = cart.id || cartId;
    if (cart.lock && active.has(resolvedId)) return false;

    stopCart(resolvedId);

    const audio = new Audio(audioUrl(cart.file));
    const inS = cart.in || 0;
    const outS = cartEnd(cart);
    const loop = cart.mode === 'loop';
    const inst = {
      id: resolvedId,
      audio,
      inS,
      outS,
      loop,
      baseVolume: cart.volume ?? 1,
      baseTarget: (cart.volume ?? 1) * masterVolume,
      fadeIn: Math.max(MIN_FADE_S, cart.fadeIn || 0),
      fadeOut: Math.max(MIN_FADE_S, cart.fadeOut || 0),
      startedAt: Date.now() - inS * 1000,
      stopped: false,
      fading: false,
      fadeInProgress: false,
      rampTimer: null,
      analyser: null,
      level: 0,
    };
    active.set(resolvedId, inst);
    levels[resolvedId] = 0;

    audio.volume = inst.fadeIn > 0 ? 0 : inst.baseTarget;
    applySink(audio);
    if (!(outputDeviceId && outputDeviceId !== 'default')) connectVU(inst);

    audio.addEventListener('loadedmetadata', () => {
      if (inst.stopped || inst.audio !== audio) return;
      try {
        audio.currentTime = Math.min(inS, (audio.duration || 0) - 0.05);
      } catch (e) {
        /* ignore */
      }
    });
    audio.addEventListener('timeupdate', () => {
      if (inst.stopped || inst.audio !== audio || inst.fading) return;
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      const endT = outS !== Infinity && dur > 0 ? Math.min(outS, dur) : outS !== Infinity ? outS : dur;
      if (endT <= 0) return;

      const region = Math.max(0.1, endT - inst.inS);
      const fadeOutS = Math.min(inst.fadeOut, region * 0.9);
      const fadeStart = endT - fadeOutS;

      if (audio.currentTime >= fadeStart) {
        if (loop) {
          loopJump(inst, resolvedId);
        } else {
          rampVolume(inst, inst.audio.volume, 0, Math.max(0.04, endT - audio.currentTime), () => {
            if (!inst.stopped && active.get(resolvedId) === inst) {
              finishStop(inst, resolvedId);
              if (endedHandler) {
                try {
                  endedHandler(resolvedId);
                } catch (e) {
                  /* ignore */
                }
              }
            }
          });
        }
      }
    });
    audio.addEventListener('ended', () => {
      if (inst.stopped) return;
      if (loop) {
        loopJump(inst, resolvedId);
        return;
      }
      finishStop(inst, resolvedId);
      if (endedHandler) {
        try {
          endedHandler(resolvedId);
        } catch (e) {
          /* ignore */
        }
      }
    });
    audio.addEventListener('error', () => {
      if (inst.stopped) return;
      console.error('PLAYER: audio error', resolvedId, audio.error ? audio.error.code : '?');
      finishStop(inst, resolvedId);
    });
    audio.play().catch(() => finishStop(inst, resolvedId));

    if (inst.fadeIn > 0) {
      inst.fadeInProgress = true;
      rampVolume(inst, 0, inst.baseTarget, inst.fadeIn, () => {
        inst.fadeInProgress = false;
      });
    }

    selectedCartId = resolvedId;
    lastPlayedId = resolvedId;
    if (paused) paused = false;
    return true;
  }

  function go(getCart, getCarts) {
    const list = getCarts ? getCarts() : [];
    if (!list.length) return false;
    let idx = list.findIndex((id) => id === selectedCartId);
    if (idx === -1) idx = 0;
    const ok = play(list[idx], getCart);
    selectedCartId = list[(idx + 1) % list.length];
    return ok;
  }

  function readLevels() {
    const out = {};
    if (vuCtx) {
      const buf = new Uint8Array(1024);
      for (const inst of active.values()) {
        if (!inst.analyser || inst.stopped) continue;
        try {
          inst.analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i += 4) {
            const v = Math.abs((buf[i] - 128) / 128);
            if (v > peak) peak = v;
          }
          inst.level = Math.max(inst.level * 0.7, peak);
          out[inst.id] = inst.level;
        } catch (e) {
          /* ignore */
        }
      }
    }
    return out;
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
        cid: cart.cid || cart.id,
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
    setEndedHandler,
    setMasterVolume,
    setOutputDevice,
    readLevels,
    isActive: (id) => active.has(id),
    getSelected: () => selectedCartId,
    setSelected: (id) => (selectedCartId = id),
  };
})();
