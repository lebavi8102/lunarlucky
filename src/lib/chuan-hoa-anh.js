/**
 * Chuẩn hóa ảnh sản phẩm về một kích thước: 1080×1350 (4:5, đúng khung ảnh trên web), JPEG.
 * - Ảnh gần đúng tỉ lệ (lệch ≤ 10%): cắt nhẹ phần giữa cho vừa khung.
 * - Ảnh lệch nhiều (rất dọc 9:16, ảnh ngang): giữ TRỌN ảnh, chỗ trống lấp bằng chính ảnh đó phóng to + làm mờ.
 * Dùng bộ mã WASM @jsquash có sẵn (Render không cài được sharp). PNG giải bằng zlib của Node, không thêm thư viện.
 * Lỗi bất kỳ → ném lỗi, nơi gọi giữ ảnh gốc (không bao giờ chặn việc tải ảnh lên).
 */
const fs = require('fs');
const zlib = require('zlib');

const W = 1080;
const H = 1350;
const TI_LE = W / H;            // 0.8
const LECH_CAT = 0.10;          // lệch ≤ 10% so với 4:5 → cắt; hơn → nền mờ
const CHAT_LUONG = 85;

// @jsquash/resize tạo `new ImageData(...)`; Node không có sẵn
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      if (typeof data === 'number') { height = width; width = data; data = new Uint8ClampedArray(width * height * 4); }
      this.data = data; this.width = width; this.height = height; this.colorSpace = 'srgb';
    }
  };
}

const wasm = (p) => WebAssembly.compile(fs.readFileSync(require.resolve(p)));
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const [jd, wd, je, rs] = await Promise.all([
        import('@jsquash/jpeg/decode.js'), import('@jsquash/webp/decode.js'), import('@jsquash/jpeg/encode.js'), import('@jsquash/resize'),
      ]);
      await jd.init(await wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'));
      await wd.init(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm'));
      await je.init(await wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'));
      await rs.initResize(await wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'));
      return { decJpeg: jd.default, decWebp: wd.default, encode: je.default, resize: rs.default };
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// ---------------------------------------------------------------- PNG (8 bit, không xen kẽ) bằng zlib
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (kind === 'PLTE') plte = d;
    else if (kind === 'tRNS') trns = d;
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const kenh = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || interlace || !kenh || !w || !h) throw new Error(`PNG chưa hỗ trợ (bit ${depth}, kiểu ${type}, xen kẽ ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * kenh;
  const px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= kenh ? out[i - kenh] : 0, b = prev[i], c = i >= kenh ? prev[i - kenh] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += kenh) {
    let r, g, b, al = 255;
    if (type === 0) { r = g = b = px[j]; }
    else if (type === 4) { r = g = b = px[j]; al = px[j + 1]; }
    else if (type === 2) { r = px[j]; g = px[j + 1]; b = px[j + 2]; }
    else if (type === 6) { r = px[j]; g = px[j + 1]; b = px[j + 2]; al = px[j + 3]; }
    else { const k = px[j] * 3; r = plte[k]; g = plte[k + 1]; b = plte[k + 2]; al = trns && px[j] < trns.length ? trns[px[j]] : 255; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = al;
  }
  return new ImageData(data, w, h);
}

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG';
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

function nenTrang(img) {     // nền trong suốt → nền trắng (JPEG không có kênh trong suốt)
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
  return img;
}

function cat(img, x, y, w, h) {   // cắt một vùng chữ nhật
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return new ImageData(out, w, h);
}

const CAT_TREN = 0.25;              // ảnh dọc thừa chiều cao: cắt 1/4 phần thừa ở trên, 3/4 ở dưới (logo thường nằm trên đầu ảnh)
function catGiua45(img) {          // vùng 4:5 lớn nhất: giữa theo chiều ngang, lệch lên trên theo chiều dọc
  const r = img.width / img.height;
  if (r > TI_LE) { const w = Math.round(img.height * TI_LE); return cat(img, Math.floor((img.width - w) / 2), 0, w, img.height); }
  const h = Math.round(img.width / TI_LE);
  return cat(img, 0, Math.floor((img.height - h) * CAT_TREN), img.width, h);
}

// Vùng 4:5 chứa nhiều chi tiết nhất (giỏ quà nhiều chi tiết, tường/nền trơn ít) → giỏ không bị cắt mất.
// Chỉ dùng cho ảnh lệch nhiều; ảnh lệch nhẹ vẫn cắt lệch trên để giữ logo ở đầu ảnh studio.
function catTheoGio(img) {
  const w0 = img.width, h0 = img.height, d = img.data;
  const sang = (i, j) => { const a = (j * w0 + i) * 4; return d[a] + d[a + 1] + d[a + 2]; };
  const chon = (arr, n) => { let s = 0; for (let i = 0; i < n; i++) s += arr[i]; let best = s, at = 0; for (let i = n; i < arr.length; i++) { s += arr[i] - arr[i - n]; if (s > best) { best = s; at = i - n + 1; } } return at; };
  if (w0 / h0 > TI_LE) {
    const w = Math.round(h0 * TI_LE), cot = new Float64Array(w0);
    for (let j = 0; j < h0; j += 2) for (let i = 1; i < w0; i++) cot[i] += Math.abs(sang(i, j) - sang(i - 1, j));
    return cat(img, chon(cot, w), 0, w, h0);
  }
  const h = Math.round(w0 / TI_LE), hang = new Float64Array(h0);
  for (let j = 1; j < h0; j++) for (let i = 0; i < w0; i += 2) hang[j] += Math.abs(sang(i, j) - sang(i, j - 1));
  return cat(img, 0, chon(hang, h), w0, h);
}

const MEP_MO = 28;                  // px: mép ảnh chính hòa dần vào nền mờ, không để đường ranh sắc
function dan(nen, fg, ox, oy) {     // dán ảnh chính lên nền, làm mềm các mép giáp nền
  const d = nen.data, f = fg.data, fw = fg.width, fh = fg.height;
  const mL = ox > 0, mR = ox + fw < W, mT = oy > 0, mB = oy + fh < H;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let t = 1;
      if (mL) t = Math.min(t, (x + 1) / MEP_MO);
      if (mR) t = Math.min(t, (fw - x) / MEP_MO);
      if (mT) t = Math.min(t, (y + 1) / MEP_MO);
      if (mB) t = Math.min(t, (fh - y) / MEP_MO);
      const i = (y * fw + x) * 4, j = ((oy + y) * W + ox + x) * 4;
      if (t >= 1) { d[j] = f[i]; d[j + 1] = f[i + 1]; d[j + 2] = f[i + 2]; }
      else { d[j] = d[j] * (1 - t) + f[i] * t; d[j + 1] = d[j + 1] * (1 - t) + f[i + 1] * t; d[j + 2] = d[j + 2] * (1 - t) + f[i + 2] * t; }
    }
  }
}

/** Đọc kích thước + định dạng, không giải mã toàn ảnh (dùng cho trang xem trước). */
function kichThuoc(buf) {
  if (isPng(buf)) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' };
  if (isJpeg(buf)) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p++; continue; }
      const m = buf[p + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7), mime: 'image/jpeg' };
      p += 2 + buf.readUInt16BE(p + 2);
    }
  }
  if (isWebp(buf)) {
    const t = buf.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), mime: 'image/webp' };
    if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, mime: 'image/webp' };
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, mime: 'image/webp' }; }
  }
  return null;
}

/** Cách sẽ dùng cho ảnh kích thước w×h. */
const LECH_CAT_GIO = 0.40;          // lệch nhiều hơn LECH_CAT nhưng ≤ 40%: cắt kín khung quanh chỗ có giỏ
function cachXuLy(w, h) {
  if (w === W && h === H) return 'da-chuan';
  const lech = Math.abs(w / h / TI_LE - 1);
  return lech <= LECH_CAT ? 'cat' : lech <= LECH_CAT_GIO ? 'cat-gio' : 'nen-mo';
}

/** buf (JPEG/PNG/WebP) → { data: JPEG 1080×1350, mime, cach, goc: 'w×h' }. Ảnh đã đúng chuẩn và là JPEG → trả nguyên. */
async function chuanHoa(buf) {
  const kt = kichThuoc(buf);
  if (kt && kt.mime === 'image/jpeg' && cachXuLy(kt.w, kt.h) === 'da-chuan') return { data: buf, mime: 'image/jpeg', cach: 'da-chuan', goc: `${kt.w}×${kt.h}` };
  const { decJpeg, decWebp, encode, resize } = await init();
  let img;
  if (isJpeg(buf)) img = await decJpeg(buf);
  else if (isPng(buf)) img = decodePng(buf);
  else if (isWebp(buf)) img = await decWebp(buf);
  else throw new Error('định dạng ảnh không hỗ trợ');
  img = nenTrang(img);
  const goc = `${img.width}×${img.height}`;
  const cach = cachXuLy(img.width, img.height);
  let out;
  if (cach === 'cat' || cach === 'da-chuan') {
    out = await resize(catGiua45(img), { width: W, height: H });
  } else if (cach === 'cat-gio') {
    out = await resize(catTheoGio(img), { width: W, height: H });
  } else {
    // nền: chính ảnh đó lấp kín khung, thu rất nhỏ rồi phóng lại = mờ mịn; làm sáng nhẹ để ảnh chính nổi lên
    const nho = await resize(catGiua45(img), { width: 27, height: 34 });
    const nen = await resize(nho, { width: W, height: H });
    const d = nen.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * 0.82 + 255 * 0.18; d[i + 1] = d[i + 1] * 0.82 + 255 * 0.18; d[i + 2] = d[i + 2] * 0.82 + 255 * 0.18; }
    const k = Math.min(W / img.width, H / img.height);
    const fw = Math.max(1, Math.round(img.width * k)), fh = Math.max(1, Math.round(img.height * k));
    const fg = await resize(img, { width: fw, height: fh });
    dan(nen, fg, Math.floor((W - fw) / 2), Math.floor((H - fh) / 2));
    out = nen;
  }
  return { data: Buffer.from(await encode(out, { quality: CHAT_LUONG })), mime: 'image/jpeg', cach, goc };
}

module.exports = { chuanHoa, kichThuoc, cachXuLy, decodePng, init, W, H };
