const multer = require('multer');
const db = require('../db');
const config = require('../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxBytes, files: 12 },
});

/** Nhận diện định dạng ảnh qua magic bytes, không tin mimetype từ trình duyệt. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /avi[fs]/.test(buf.toString('ascii', 8, 12))) return 'image/avif';
  return null;
}

async function saveFile(file, alt) {
  if (!file || !file.buffer || !file.size) return null;
  const mime = sniff(file.buffer);
  if (!mime) {
    const err = new Error(`Tệp "${file.originalname}" không phải ảnh JPG/PNG/WebP/AVIF hợp lệ.`);
    err.status = 400;
    throw err;
  }
  const [id] = await db('media').insert({
    filename: String(file.originalname || '').slice(0, 255),
    mime,
    size: file.size,
    alt: alt ? String(alt).slice(0, 255) : null,
    data: file.buffer,
  });
  return typeof id === 'object' ? id.id : id;
}

async function saveBuffer(buffer, mime, filename, alt) {
  const [id] = await db('media').insert({ filename, mime, size: buffer.length, alt, data: buffer });
  return typeof id === 'object' ? id.id : id;
}

module.exports = { upload, saveFile, saveBuffer, sniff };
