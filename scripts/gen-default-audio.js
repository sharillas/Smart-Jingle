const fs = require('node:fs');
const path = require('node:path');

const SR = 44100;

function writeWav(filePath, samples) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

function sweeper() {
  const dur = 4.5;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 300 * Math.pow(3000 / 300, t / dur);
    const phase = 2 * Math.PI * (300 * (Math.pow(3000 / 300, t / dur) - 1) / Math.log(3000 / 300));
    const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.6);
    out[i] = Math.sin(phase) * 0.65 * env;
  }
  return out;
}

function transition() {
  const notes = [
    [261.63, 0], [329.63, 0.35], [392.0, 0.7], [523.25, 1.05],
    [392.0, 1.4], [523.25, 1.75], [659.25, 2.1], [783.99, 2.45],
  ];
  const dur = 3.4;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [f, start] of notes) {
      const tt = t - start;
      if (tt >= 0 && tt < 0.32) {
        const env = Math.min(1, tt / 0.01) * Math.min(1, (0.32 - tt) / 0.05);
        v += Math.sin(2 * Math.PI * f * tt) * 0.5 * env;
      }
    }
    const glow = Math.sin(2 * Math.PI * 65.4 * t) * 0.08;
    out[i] = Math.max(-1, Math.min(1, v + glow));
  }
  return out;
}

function bed() {
  const dur = 6;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 1.2) * Math.min(1, (dur - t) / 2.5);
    const v =
      Math.sin(2 * Math.PI * 220 * t) * 0.22 +
      Math.sin(2 * Math.PI * 277.18 * t) * 0.15 +
      Math.sin(2 * Math.PI * 329.63 * t) * 0.08;
    out[i] = v * env;
  }
  return out;
}

const dir = path.join(__dirname, '..', 'assets', 'default-audio');
fs.mkdirSync(dir, { recursive: true });
writeWav(path.join(dir, 'sweeper.wav'), sweeper());
writeWav(path.join(dir, 'transition.wav'), transition());
writeWav(path.join(dir, 'bed.wav'), bed());
console.log('Default jingle audio written to', dir);
