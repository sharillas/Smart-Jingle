(function () {
  'use strict';

  let audioCtx = null;
  const cache = new Map();

  function ctx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  async function decode(buffer) {
    const ac = ctx();
    return await ac.decodeAudioData(buffer);
  }

  function buildPeaks(audioBuffer, buckets) {
    const ch = audioBuffer.getChannelData(0);
    const n = Math.min(buckets || 3600, Math.max(100, ch.length >> 3));
    const peaks = new Float32Array(n * 2);
    const step = ch.length / n;
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * step);
      const end = Math.max(start + 1, Math.floor((i + 1) * step));
      let min = 0;
      let max = 0;
      for (let j = start; j < end; j += 4) {
        const v = ch[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }
    return peaks;
  }

  async function getWave(cartId, readFn) {
    if (cache.has(cartId)) return cache.get(cartId);
    const res = await readFn(cartId);
    if (res && res.error) throw new Error(res.error);
    const buf = res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength);
    const audioBuffer = await decode(buf);
    const wave = {
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      peaks: buildPeaks(audioBuffer),
    };
    cache.set(cartId, wave);
    return wave;
  }

  function drawWave(canvas, wave, opts) {
    const w = canvas.width;
    const h = canvas.height;
    const g = canvas.getContext('2d');
    const { inS = 0, outS = null, playhead = null, selected = false, colors } = opts || {};

    const dur = wave.duration || 1;
    const out = outS === null || outS === undefined ? dur : outS;
    const peaks = wave.peaks;
    const n = peaks.length / 2;

    g.clearRect(0, 0, w, h);

    const drawSlice = (x0, x1, color) => {
      if (x1 <= x0) return;
      const i0 = Math.max(0, Math.floor((x0 / w) * n));
      const i1 = Math.min(n - 1, Math.ceil((x1 / w) * n));
      if (i1 < i0) return;
      const pxs = x1 - x0;
      const buckets = Math.max(2, Math.min(i1 - i0 + 1, Math.ceil(pxs / 2)));
      const step = (i1 - i0 + 1) / buckets;
      g.fillStyle = color;
      for (let b = 0; b < buckets; b++) {
        const s = i0 + Math.floor(b * step);
        const e = Math.min(i1, i0 + Math.floor((b + 1) * step) - 1);
        let min = 0;
        let max = 0;
        for (let i = s; i <= e; i++) {
          if (peaks[i * 2] < min) min = peaks[i * 2];
          if (peaks[i * 2 + 1] > max) max = peaks[i * 2 + 1];
        }
        const bw = Math.max(1, pxs / buckets);
        const x = x0 + b * bw;
        const mid = h / 2;
        const amp = (h / 2) - 3;
        g.fillRect(x, mid - max * amp, bw, Math.max(1, (max - min) * amp));
      }
    };

    const inX = (inS / dur) * w;
    const outX = (out / dur) * w;

    if (colors) {
      drawSlice(0, inX, colors.outside || 'rgba(120,130,150,0.25)');
      drawSlice(inX, outX, colors.inside || (selected ? '#2f81f7' : '#3f8cff'));
      drawSlice(outX, w, colors.outside || 'rgba(120,130,150,0.25)');
    } else {
      drawSlice(inX, outX, '#3f8cff');
      drawSlice(0, inX, 'rgba(120,130,150,0.25)');
      drawSlice(outX, w, 'rgba(120,130,150,0.25)');
    }

    const marker = (x, color, label) => {
      g.fillStyle = color;
      g.fillRect(x - 1, 0, 2, h);
      g.font = '9px "Segoe UI", sans-serif';
      g.fillText(label, Math.min(Math.max(x + 4, 4), w - 34), h - 5);
    };
    if (inS > 0.0005) marker(inX, '#4ade80', 'IN');
    if (out < dur - 0.0005) marker(outX, '#f87171', 'OUT');

    if (playhead !== null && playhead !== undefined) {
      const px = (playhead / dur) * w;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(px - 0.5, 0, 1, h);
    }
  }

  function fitCanvas(canvas, container) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, container.clientWidth);
    const h = canvas.height || container.clientHeight || 72;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  window.SJWave = { getWave, drawWave, fitCanvas, invalidate: () => cache.clear() };
})();
