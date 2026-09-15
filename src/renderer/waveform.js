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

  const TICK_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

  function fmtTick(t, step) {
    if (step >= 1) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t - m * 60);
      return m + ':' + String(s).padStart(2, '0');
    }
    return t.toFixed(1) + 's';
  }

  function drawWave(canvas, wave, opts) {
    const w = canvas.width;
    const h = canvas.height;
    const g = canvas.getContext('2d');
    const { inS = 0, outS = null, playhead = null, selected = false, colors, view = null, ruler = false, gainScale = 1 } = opts || {};

    const dur = wave.duration || 1;
    const out = outS === null || outS === undefined ? dur : outS;
    const peaks = wave.peaks;
    const n = peaks.length / 2;
    const gs = isFinite(gainScale) ? Math.max(0, gainScale) : 1;

    const rulerH = ruler ? 20 : 0;
    const waveH = h - rulerH;
    const mid = rulerH + waveH / 2;

    const vStart = view ? Math.max(0, Math.min(view.start, dur - 0.01)) : 0;
    const vDur = view ? Math.max(0.5, Math.min(view.dur, dur)) : dur;

    const t2x = (t) => ((t - vStart) / vDur) * w;
    const x2t = (x) => vStart + (x / w) * vDur;

    g.clearRect(0, 0, w, h);

    let globalMax = 0.0001;
    for (let i = 0; i < peaks.length; i++) {
      const a = Math.abs(peaks[i]);
      if (a > globalMax) globalMax = a;
    }
    const amp = (waveH / 2 - 6) / globalMax;

    const drawSlice = (x0, x1, color) => {
      if (x1 <= x0) return;
      const t0 = x2t(x0);
      const t1 = x2t(x1);
      const i0 = Math.max(0, Math.floor((t0 / dur) * n));
      const i1 = Math.min(n - 1, Math.ceil((t1 / dur) * n));
      if (i1 < i0) return;
      const pxs = x1 - x0;
      const buckets = Math.max(2, Math.min(i1 - i0 + 1, Math.ceil(pxs / 1.6)));
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
        const bw = Math.max(1.5, pxs / buckets);
        const x = x0 + b * bw;
        const y0 = mid - max * amp * gs;
        const y1 = mid - min * amp * gs;
        g.fillRect(x, y0, bw, Math.max(1.5, y1 - y0));
      }
    };

    const inX = t2x(inS);
    const outX = t2x(out);

    if (colors) {
      drawSlice(0, inX, colors.outside || 'rgba(120,130,150,0.25)');
      drawSlice(inX, outX, colors.inside || (selected ? '#2f81f7' : '#3f8cff'));
      drawSlice(outX, w, colors.outside || 'rgba(120,130,150,0.25)');
    } else {
      drawSlice(inX, outX, '#3f8cff');
      drawSlice(0, inX, 'rgba(120,130,150,0.25)');
      drawSlice(outX, w, 'rgba(120,130,150,0.25)');
    }

    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, mid - 0.5, w, 1);

    if (ruler) {
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fillRect(0, 0, w, rulerH);
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, rulerH - 0.5);
      g.lineTo(w, rulerH - 0.5);
      g.stroke();

      let step = TICK_STEPS[TICK_STEPS.length - 1];
      for (const s of TICK_STEPS) {
        if ((s / vDur) * w >= 48) {
          step = s;
          break;
        }
      }
      g.fillStyle = 'rgba(160,175,200,0.9)';
      g.font = '9px "Segoe UI", monospace';
      g.textBaseline = 'top';
      const startTick = Math.ceil(vStart / step) * step;
      for (let t = startTick; t <= vStart + vDur + 0.0001; t += step) {
        const x = t2x(t);
        if (x < -2 || x > w + 2) continue;
        g.fillRect(x - 0.5, rulerH - 6, 1, 6);
        g.fillText(fmtTick(t, step), x + 3, 2);
      }
    }

    const marker = (x, color, label) => {
      if (x < -1 || x > w + 1) return;
      g.fillStyle = color;
      g.fillRect(x - 1, rulerH, 2, waveH);
      g.font = 'bold 9px "Segoe UI", sans-serif';
      g.textBaseline = 'bottom';
      g.fillText(label, Math.min(Math.max(x + 4, 4), w - 34), h - 3);
    };
    if (inS > 0.0005) marker(inX, '#4ade80', 'IN');
    if (out < dur - 0.0005) marker(outX, '#f87171', 'OUT');

    if (playhead !== null && playhead !== undefined) {
      const px = t2x(playhead);
      if (px >= -1 && px <= w + 1) {
        g.fillStyle = 'rgba(255,255,255,0.95)';
        g.fillRect(px - 0.5, rulerH, 1, waveH);
      }
    }
  }

  function pickNiceStep(vDur, w) {
    for (const s of TICK_STEPS) {
      if ((s / vDur) * w >= 48) return s;
    }
    return TICK_STEPS[TICK_STEPS.length - 1];
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

  window.SJWave = { getWave, drawWave, fitCanvas, pickNiceStep, invalidate: () => cache.clear() };
})();
