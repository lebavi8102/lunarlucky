/**
 * Tìm giỏ quà kiểu "khách gõ sao cũng ra": không dấu, sai hoa thường, kèm giá ("dưới 1tr", "500k", "rẻ").
 * Danh mục chỉ vài chục sản phẩm → lọc trong bộ nhớ, không cần full-text.
 */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Từ chung chung: có cũng được, không bắt buộc khớp
const FILLER = new Set(['gio', 'qua', 'tet', 'hop', 'cho', 'mua', 'tang', 'bieu', 'loai', 'mau', 'dep', 'xin', 'sang', 'cao', 'cap', 'nam', 'moi', 'can', 'tim',
  'duoi', 'tren', 'khoang', 'tam', 'tu', 'den', 'gia', 're', 'mac', 'dat', 'trieu', 'tr', 'k', 'nghin', 'ngan', 'va', 'cua', 'nguoi', 'the', 'nao', 'co', 'khong', 'trong', 'tien']);

/** "dưới 1tr5" → { max: 1500000 }; "trên 2 triệu" → { min }; "800k" → khoảng ±25%. */
function parsePrice(f) {
  const m = /(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan)\s*(\d)?/.exec(f);
  if (!m) return null;
  let v = parseFloat(m[1].replace(',', '.'));
  v *= /^(k|nghin|ngan)$/.test(m[2]) ? 1000 : 1000000;
  if (m[3] && m[2] !== 'k') v += Number(m[3]) * 100000; // 1tr5
  if (/(duoi|toi da|khong qua|max)\s*$/.test(f.slice(0, m.index))) return { max: v, text: m[0] };
  if (/(tren|tu|hon|min)\s*$/.test(f.slice(0, m.index))) return { min: v, text: m[0] };
  return { min: v * 0.75, max: v * 1.25, text: m[0] };
}

function search(products, q, categories = []) {
  const f = fold(q).replace(/[^\w\s.,]/g, ' ');
  const price = parsePrice(f);
  const cheap = /\b(re|binh dan|tiet kiem)\b/.test(f);
  const pricey = /\b(sang|cao cap|dat tien|vip|luxury)\b/.test(f);
  const words = f.replace(price ? price.text : '', ' ').split(/[\s.,]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const keys = words.filter((w) => !FILLER.has(w));
  const catName = Object.fromEntries(categories.map((c) => [c.id, fold(c.name)]));

  let list = products.map((p) => {
    const hay = fold([p.name, p.code, p.short_desc, p.contents, p.badge, catName[p.category_id]].join(' '));
    const name = fold(p.name);
    const hits = keys.filter((w) => hay.includes(w)).length;
    const score = hits * 10 + keys.filter((w) => name.includes(w)).length * 5 + (hay.includes(fold(q).trim()) ? 20 : 0);
    return { p, hits, score };
  });
  if (keys.length) {
    // Khớp hết từ khóa trước; nếu không có thì chấp nhận khớp một phần
    const all = list.filter((x) => x.hits === keys.length);
    list = all.length ? all : list.filter((x) => x.hits > 0);
  } else if (!price && !cheap && !pricey && !words.some((w) => ['gio', 'qua', 'tet', 'hop'].includes(w))) {
    list = [];
  }
  if (price) list = list.filter(({ p }) => (price.min == null || p.price >= price.min) && (price.max == null || p.price <= price.max));
  list.sort((a, b) => (cheap ? a.p.price - b.p.price : pricey ? b.p.price - a.p.price : 0) || b.score - a.score || (b.p.sold || 0) - (a.p.sold || 0));
  return list.map((x) => x.p);
}

module.exports = { search, fold, parsePrice };
