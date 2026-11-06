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

/** Ảnh sản phẩm → 1080×1350 (4:5) khi bật cài đặt anh_chuan_hoa. Lỗi → giữ ảnh gốc, không chặn việc tải ảnh. */
async function chuanHoaAnhSanPham(buffer, mime) {
  try {
    const s = await require('./settings').all();
    if (String(s.anh_chuan_hoa) === '0') return { buffer, mime };
    const r = await require('./chuan-hoa-anh').chuanHoa(buffer);
    return { buffer: r.data, mime: r.mime };
  } catch (err) {
    console.error('[media] không chuẩn hóa được ảnh sản phẩm, giữ ảnh gốc:', err.message);
    return { buffer, mime };
  }
}

async function saveFile(file, alt, opts = {}) {
  if (!file || !file.buffer || !file.size) return null;
  let mime = sniff(file.buffer);
  if (!mime) {
    const heic = file.buffer.toString('ascii', 4, 8) === 'ftyp' && /hei[cfsx]|mif1|msf1/.test(file.buffer.toString('ascii', 8, 12));
    const err = new Error(
      heic
        ? `Ảnh "${file.originalname}" là định dạng HEIC của iPhone. Vào Cài đặt → Camera → Định dạng → chọn "Tương thích nhất", hoặc gửi ảnh qua Zalo/Telegram rồi tải lại.`
        : `Tệp "${file.originalname}" không phải ảnh JPG/PNG/WebP/AVIF hợp lệ.`,
    );
    err.status = 400;
    throw err;
  }
  let data = file.buffer;
  if (opts.chuanHoa) ({ buffer: data, mime } = await chuanHoaAnhSanPham(data, mime));
  const [id] = await db('media').insert({
    filename: String(file.originalname || '').slice(0, 255),
    mime,
    size: data.length,
    alt: alt ? String(alt).slice(0, 255) : null,
    data,
  });
  return typeof id === 'object' ? id.id : id;
}

async function saveBuffer(buffer, mime, filename, alt) {
  const [id] = await db('media').insert({ filename, mime, size: buffer.length, alt, data: buffer });
  return typeof id === 'object' ? id.id : id;
}

module.exports = { upload, saveFile, saveBuffer, sniff, chuanHoaAnhSanPham };
