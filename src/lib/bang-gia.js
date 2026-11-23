/**
 * Bảng giá theo số lượng (catalogue Quà Tết doanh nghiệp 2027) cho trang /bo-suu-tap/qua-doanh-nghiep.
 * Nguồn: src/lib/bang-gia-catalogue-2027.json (cùng file bot dùng để báo giá) → web, catalogue, bot luôn khớp giá.
 */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
// "Giỏ Đại Cát" → "dai-cat"; slug "gio-dai-cat" / "hop-qua-xuan-phuc" → "dai-cat" / "xuan-phuc"
const keyOfName = (ten) => fold(ten).replace(/^(gio|hop)( qua)?\s+/, '').trim().replace(/\s+/g, '-');
const keyOfSlug = (slug) => String(slug || '').replace(/^(gio|hop)(-qua)?-/, '');

function load() {
  try {
    delete require.cache[require.resolve('./bang-gia-catalogue-2027.json')];
    return require('./bang-gia-catalogue-2027.json');
  } catch (_) {
    return null;
  }
}

/**
 * @param {{slug:string,name:string}[]} products sản phẩm đang bán (để gắn link)
 * @returns {{ nhom: {ten:string, mau:object[]}[], soMau: number } | null}
 */
function bangGia(products = []) {
  const d = load();
  if (!d || !Array.isArray(d.mau) || !d.mau.length) return null;
  const bySlug = new Map(products.map((p) => [keyOfSlug(p.slug), p.slug]));
  const nhom = [];
  for (const m of d.mau) {
    let g = nhom.find((x) => x.ten === m.phan_khuc);
    if (!g) nhom.push((g = { ten: m.phan_khuc, mau: [] }));
    g.mau.push({ ...m, slug: bySlug.get(keyOfName(m.ten)) || null });
  }
  return { nhom, soMau: d.mau.length };
}


/**
 * Chuẩn hóa tên món giống catalogue (build_v3.py → chuan): "Cafe Mallorie 8x20gram" → "Cà phê Mallorie 8×20g".
 * Chỉ đổi lúc hiển thị, dữ liệu gốc (Excel/admin) giữ nguyên.
 */
function chuanTenMon(c) {
  let s = String(c || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^Cafe\b/i, 'Cà phê');
  s = s.replace(/(\d+)\s*[x×]\s*(\d+)\s*(g|gram|ml)\b/gi, (_, a, b, u) => `${a}×${b}${/^g/i.test(u) ? 'g' : 'ml'}`);
  s = s.replace(/(\d+)\s*(hũ|hộp|gói)\s*[x×]\s*(\d+)\s*(ml|g)\b/g, '$1 $2 × $3$4');
  s = s.replace(/(\d)\s+(g|ml|gram)\b/g, '$1$2');
  s = s.replace(/(\d)gram\b/g, '$1g');
  s = s.replace(/\s*:\s*/g, ' ');
  s = s.replace(/\bCapella\b/g, 'Capela').replace(/\bCashews\b/g, 'Cashew');
  s = s.replace(/^Vang Úc/, 'Rượu vang Úc').replace(/^Bánh lưng (\d)/, 'Bánh lưng Capela $1');
  s = s.replace(/\s*[x×]\s*1$/i, ''); // "Trà Lamour x1" → "Trà Lamour" (1 món thì không ghi số lượng)
  s = s.replace(/(\d+)v\b/g, '$1 viên').replace(/\bBánh Rocky\b/g, 'Bánh Pocky');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Giá theo số lượng của 1 mẫu (theo slug sản phẩm), null nếu mẫu không có trong catalogue */
function giaSoLuong(slug) {
  const d = load();
  if (!d || !Array.isArray(d.mau)) return null;
  const k = keyOfSlug(slug);
  return d.mau.find((m) => keyOfName(m.ten) === k) || null;
}

module.exports = { bangGia, keyOfName, keyOfSlug, chuanTenMon, giaSoLuong };
