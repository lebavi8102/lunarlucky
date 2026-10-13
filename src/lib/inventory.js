/**
 * Tồn kho đơn giản: một con số cho mỗi sản phẩm, dùng chung cho web, admin và bot Telegram.
 */
const db = require('../db');
const settings = require('./settings');
const { slugify } = require('./format');

async function threshold() {
  const n = Number((await settings.all()).low_stock_threshold);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Mã SP tiếp theo dạng LL001, LL002… */
async function nextSku() {
  const rows = await db('products').whereNotNull('sku').select('sku');
  let max = 0;
  for (const r of rows) {
    const m = /^LL(\d+)$/.exec(r.sku || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LL${String(max + 1).padStart(3, '0')}`;
}

/** Tìm sản phẩm theo mã SP (chính xác) hoặc một phần tên (không cần dấu). */
async function findProducts(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const exact = await db('products').whereRaw('UPPER(sku) = ?', [q.toUpperCase()]).first();
  if (exact) return [exact];
  const key = slugify(q);
  if (!key) return [];
  const all = await db('products').select('id', 'sku', 'name', 'slug', 'stock', 'is_active');
  return all.filter((p) => p.slug.includes(key) || slugify(p.name).includes(key));
}

/**
 * Đổi tồn kho. mode: 'add' (cộng), 'sub' (trừ), 'set' (đặt lại).
 * Trả về { product, before, after }. Không cho tồn kho âm.
 */
async function adjust(productId, mode, qty) {
  return db.transaction(async (trx) => {
    const p = await trx('products').where({ id: productId }).modify((q) => db.isMysql && q.forUpdate()).first();
    if (!p) throw new Error('Không tìm thấy sản phẩm.');
    const before = Number(p.stock) || 0;
    let after = mode === 'add' ? before + qty : mode === 'sub' ? before - qty : qty;
    after = Math.max(0, Math.min(1000000, Math.floor(after)));
    await trx('products').where({ id: p.id }).update({ stock: after, updated_at: new Date() });
    return { product: { ...p, stock: after }, before, after };
  });
}

/**
 * Cảnh báo khi tồn kho vừa chạm ngưỡng (trước > ngưỡng, sau ≤ ngưỡng) hoặc vừa hết hàng.
 * Trả về chuỗi HTML cho Telegram hoặc null.
 */
async function lowStockMessage(product, before, after) {
  const limit = await threshold();
  const e = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  if (after === 0 && before > 0) {
    return `⛔ <b>HẾT HÀNG:</b> ${e(product.name)} (${e(product.sku)})\nWeb đã hiện "Hết hàng". Nhập thêm: <code>/nhap ${e(product.sku)} 20</code>`;
  }
  if (after > 0 && after <= limit && before > limit) {
    return `⚠️ <b>Sắp hết:</b> ${e(product.name)} (${e(product.sku)}) chỉ còn <b>${after}</b> giỏ\nNhập thêm: <code>/nhap ${e(product.sku)} 20</code>`;
  }
  return null;
}

module.exports = { threshold, nextSku, findProducts, adjust, lowStockMessage };
