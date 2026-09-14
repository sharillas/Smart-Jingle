const { protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
};

function register() {
  protocol.handle('sj', async (request) => {
    try {
      const u = new URL(request.url);
      const filePath = decodeURIComponent(u.pathname.replace(/^\//, ''));
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const range = request.headers.get('range');

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (!m) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (!m[1]) {
          start = Math.max(0, stat.size - end);
          end = stat.size - 1;
        }
        if (start > end || start >= stat.size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { register };
