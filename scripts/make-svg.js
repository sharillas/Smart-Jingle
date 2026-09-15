const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const potrace = require('potrace');

const src = path.join(__dirname, '..', 'assets', 'icon.png');
const out = path.join(__dirname, '..', 'assets', 'icon.svg');

function readPngAlpha(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const alpha = Buffer.alloc(width * height);
  let prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = Buffer.alloc(stride);
    raw.copy(line, 0, rp, rp + stride);
    rp += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: break;
      }
      line[x] = v;
    }
    for (let x = 0; x < width; x++) alpha[y * width + x] = line[x * bpp + 3];
    prev = line;
  }
  return { width, height, alpha };
}

function makeMaskPng(file, { width, height, alpha }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  let wp = 0;
  for (let y = 0; y < height; y++) {
    raw[wp++] = 0;
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      const v = a > 100 ? 0 : 255;
      raw[wp++] = v;
      raw[wp++] = v;
      raw[wp++] = v;
      raw[wp++] = 255;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

try {
  const img = readPngAlpha(src);
  const mask = makeMaskPng(src, img);
  const maskFile = path.join(__dirname, '..', 'assets', 'icon-mask.png');
  fs.writeFileSync(maskFile, mask);

  potrace.trace(maskFile, { threshold: 128, turdSize: 2, optCurve: true }, (err, svg) => {
    if (err) {
      console.error('potrace failed:', err);
      process.exit(1);
    }
    svg = svg.replace('fill="black"', 'fill="#2790FF"');
    fs.writeFileSync(out, svg, 'utf8');
    fs.unlinkSync(maskFile);
    console.log('SVG written:', out, svg.length, 'bytes');
  });
} catch (e) {
  console.error('make-svg failed:', e);
  process.exit(1);
}
