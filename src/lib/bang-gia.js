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

module.exports = { bangGia, keyOfName, keyOfSlug };
