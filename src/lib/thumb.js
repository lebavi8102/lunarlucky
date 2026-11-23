/**
 * Ảnh thu nhỏ cho thẻ sản phẩm: ảnh gốc 1080px (~250–290KB) nhưng trên điện thoại ô ảnh chỉ ~210px.
 * /media/:id?w=480 → JPEG rộng 480px (~40KB). Dùng lại bộ WASM @jsquash của chuan-hoa-anh (Render không có sharp).
 * Lỗi bất kỳ → trả null, nơi gọi gửi ảnh gốc (không bao giờ làm hỏng ảnh trên web).
 */
const { init, decodePng } = require('./chuan-hoa-anh');

const WIDTHS = [360, 480, 720];
const CHAT_LUONG = 78;

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG';
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

// Bộ nhớ đệm ảnh nhỏ (tối đa ~24MB), khóa "id:w"
const cache = new Map();
let bytes = 0;
const MAX = 24 * 1024 * 1024;
const pending = new Map(); // cùng ảnh nhiều người xem một lúc → chỉ thu nhỏ 1 lần

/** Chiều rộng hợp lệ gần nhất (chặn người lạ bắt server thu nhỏ mọi kích thước) */
function pickWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return null;
  return WIDTHS.find((x) => x >= n) || WIDTHS[WIDTHS.length - 1];
}

async function make(buf, w) {
  if (!isJpeg(buf) && !isWebp(buf) && !isPng(buf)) return null;
  const { decJpeg, decWebp, encode, resize } = await init();
  let img = isJpeg(buf) ? await decJpeg(buf) : isWebp(buf) ? await decWebp(buf) : decodePng(buf);
  if (img.width <= w) return null; // ảnh đã nhỏ sẵn → dùng ảnh gốc
  // Nền trong suốt (PNG/WebP) → trắng, vì JPEG không có lớp trong suốt
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a < 255) {
      d[i - 3] = (d[i - 3] * a + 255 * (255 - a)) / 255;
      d[i - 2] = (d[i - 2] * a + 255 * (255 - a)) / 255;
      d[i - 1] = (d[i - 1] * a + 255 * (255 - a)) / 255;
      d[i] = 255;
    }
  }
  img = await resize(img, { width: w, height: Math.round((img.height * w) / img.width) });
  return Buffer.from(await encode(img, { quality: CHAT_LUONG }));
}

/** @returns {Promise<Buffer|null>} JPEG đã thu nhỏ, hoặc null (dùng ảnh gốc) */
async function thumb(id, buf, width) {
  const w = pickWidth(width);
  if (!w) return null;
  const key = `${id}:${w}`;
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  if (!pending.has(key)) {
    pending.set(key, make(buf, w)
      .catch((err) => { console.error('[thumb] không thu nhỏ được ảnh', id, err.message); return null; })
      .then((out) => {
        pending.delete(key);
        if (out) {
          cache.set(key, out);
          bytes += out.length;
          while (bytes > MAX && cache.size) {
            const [k, v] = cache.entries().next().value;
            cache.delete(k);
            bytes -= v.length;
          }
        }
        return out;
      }));
  }
  return pending.get(key);
}

module.exports = { thumb, pickWidth, WIDTHS };
