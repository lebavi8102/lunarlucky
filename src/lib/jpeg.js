/**
 * Ảnh giỏ gửi vào Messenger: Facebook chỉ chắc chắn nhận JPEG/PNG, còn ảnh trên web lưu dạng WebP.
 * Dùng bộ giải/mã hóa WASM (@jsquash) thay vì sharp: Render cài bằng `npm ci --omit=optional` nên các gói
 * nhị phân theo hệ điều hành (sharp, better-sqlite3) không có.
 */
const fs = require('fs');

const MAX_SIDE = 1200;
const wasm = (p) => WebAssembly.compile(fs.readFileSync(require.resolve(p)));

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const [dec, enc, rs] = await Promise.all([import('@jsquash/webp/decode.js'), import('@jsquash/jpeg/encode.js'), import('@jsquash/resize')]);
      await dec.init(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm'));
      await enc.init(await wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'));
      await rs.initResize(await wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'));
      return { decode: dec.default, encode: enc.default, resize: rs.default };
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG';
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

/** Trả { data, mime }: JPEG/PNG giữ nguyên, WebP đổi sang JPEG (nền trong suốt → nền trắng, cạnh dài tối đa 1200px). */
async function forMessenger(buf) {
  if (isJpeg(buf)) return { data: buf, mime: 'image/jpeg' };
  if (isPng(buf)) return { data: buf, mime: 'image/png' };
  if (!isWebp(buf)) throw new Error('định dạng ảnh không hỗ trợ');
  const { decode, encode, resize } = await init();
  let img = await decode(buf);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 255) {
      d[i] = (d[i] * a + 255 * (255 - a)) / 255;
      d[i + 1] = (d[i + 1] * a + 255 * (255 - a)) / 255;
      d[i + 2] = (d[i + 2] * a + 255 * (255 - a)) / 255;
      d[i + 3] = 255;
    }
  }
  const side = Math.max(img.width, img.height);
  if (side > MAX_SIDE) {
    const r = MAX_SIDE / side;
    img = await resize(img, { width: Math.round(img.width * r), height: Math.round(img.height * r) });
  }
  return { data: Buffer.from(await encode(img, { quality: 84 })), mime: 'image/jpeg' };
}

module.exports = { forMessenger };
