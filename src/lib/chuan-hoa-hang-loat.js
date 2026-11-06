const db = require('../db');
const { chuanHoa, kichThuoc, cachXuLy } = require('./chuan-hoa-anh');

/**
 * Chuẩn hóa ảnh sản phẩm ĐANG CÓ trên web (chạy tay từ /admin/chuan-hoa-anh).
 * - Tạo dòng media MỚI (ảnh cũ đang được trình duyệt lưu đệm 1 năm theo /media/:id), giữ tên tệp để Excel vẫn khớp ảnh.
 * - Ghi bảng anh_chuan_hoa (goc → moi) rồi đổi image_id/gallery của sản phẩm.
 * - Khôi phục = trỏ sản phẩm về ảnh gốc. Không xóa ảnh nào.
 */
const parseGallery = (g) => { try { const a = JSON.parse(g || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch { return []; } };

async function anhSanPham() {
  const products = await db('products').select('id', 'name', 'image_id', 'gallery', 'is_active');
  const dung = new Map(); // media id → [tên sản phẩm]
  for (const p of products) {
    for (const id of [p.image_id, ...parseGallery(p.gallery)].filter(Boolean)) {
      if (!dung.has(id)) dung.set(id, []);
      if (!dung.get(id).includes(p.name)) dung.get(id).push(p.name);
    }
  }
  return { products, dung };
}

async function danhSach() {
  const { dung } = await anhSanPham();
  const ids = [...dung.keys()];
  if (!ids.length) return [];
  const daLam = new Set((await db('anh_chuan_hoa').whereIn('moi_id', ids).select('moi_id')).map((r) => r.moi_id));
  const out = [];
  for (const id of ids) {
    const m = await db('media').where({ id }).select('id', 'filename', 'size', 'data').first();
    if (!m) continue;
    const k = kichThuoc(m.data);
    out.push({
      id, filename: m.filename, size: m.size, sanPham: dung.get(id),
      w: k && k.w, h: k && k.h,
      cach: daLam.has(id) ? 'da-lam' : k ? cachXuLy(k.w, k.h) : 'khong-doc',
    });
  }
  out.sort((a, b) => a.sanPham[0].localeCompare(b.sanPham[0], 'vi') || a.id - b.id);
  return out;
}

// bản xem trước, chỉ trong RAM (≈30 ảnh × 250KB)
const xemTruoc = new Map();
async function banXemTruoc(id) {
  if (xemTruoc.has(id)) return xemTruoc.get(id);
  const m = await db('media').where({ id }).select('data').first();
  if (!m) return null;
  const r = await chuanHoa(m.data);
  if (xemTruoc.size > 60) xemTruoc.delete(xemTruoc.keys().next().value);
  xemTruoc.set(id, r);
  return r;
}

function doiId(products, map) {
  const doi = [];
  for (const p of products) {
    const img = p.image_id && map.has(p.image_id) ? map.get(p.image_id) : p.image_id;
    const g0 = parseGallery(p.gallery);
    const g = g0.map((x) => (map.has(x) ? map.get(x) : x));
    if (img !== p.image_id || g.some((x, i) => x !== g0[i])) doi.push({ id: p.id, image_id: img, gallery: JSON.stringify(g) });
  }
  return doi;
}

/** Áp dụng cho các ảnh được chọn (id ảnh đang dùng). Trả { lam, boQua, sanPham }. */
async function apDung(chon) {
  const { products, dung } = await anhSanPham();
  const map = new Map();
  let boQua = 0;
  for (const id of chon.map(Number)) {
    if (!dung.has(id) || map.has(id)) { boQua++; continue; }
    if (await db('anh_chuan_hoa').where({ moi_id: id }).first()) { boQua++; continue; } // đã là bản chuẩn hóa
    const cu = await db('anh_chuan_hoa').where({ goc_id: id }).first();
    if (cu && (await db('media').where({ id: cu.moi_id }).first('id'))) { map.set(id, cu.moi_id); continue; } // làm rồi, đã khôi phục → dùng lại
    const m = await db('media').where({ id }).first();
    const k = kichThuoc(m.data);
    if (!k) { boQua++; continue; }
    const r = await banXemTruoc(id);
    if (!r || r.cach === 'da-chuan') { boQua++; continue; }
    await db.transaction(async (trx) => {
      const [x] = await trx('media').insert({ filename: m.filename, mime: r.mime, size: r.data.length, alt: m.alt, data: r.data });
      const moi = typeof x === 'object' ? x.id : x;
      if (cu) await trx('anh_chuan_hoa').where({ goc_id: id }).update({ moi_id: moi, cach: r.cach, goc_kich: `${k.w}x${k.h}` });
      else await trx('anh_chuan_hoa').insert({ goc_id: id, moi_id: moi, cach: r.cach, goc_kich: `${k.w}x${k.h}` });
      map.set(id, moi);
    });
  }
  const doi = doiId(products, map);
  await db.transaction(async (trx) => {
    for (const d of doi) await trx('products').where({ id: d.id }).update({ image_id: d.image_id, gallery: d.gallery });
  });
  return { lam: map.size, boQua, sanPham: doi.length };
}

/** Trỏ mọi sản phẩm về ảnh gốc. */
async function khoiPhuc() {
  const { products } = await anhSanPham();
  const rows = await db('anh_chuan_hoa').select('goc_id', 'moi_id');
  const goc = new Set((await db('media').whereIn('id', rows.map((r) => r.goc_id).concat(0)).select('id')).map((r) => r.id));
  const map = new Map(rows.filter((r) => goc.has(r.goc_id)).map((r) => [r.moi_id, r.goc_id]));
  const doi = doiId(products, map);
  await db.transaction(async (trx) => {
    for (const d of doi) await trx('products').where({ id: d.id }).update({ image_id: d.image_id, gallery: d.gallery });
  });
  return { sanPham: doi.length };
}

module.exports = { danhSach, banXemTruoc, apDung, khoiPhuc };
