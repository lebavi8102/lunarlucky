const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const { todayVN } = require('./format');

const MAX_QTY = 500;
const MIN_CUSTOM_ITEMS = 2;

function getCart(req) {
  if (!req.session.cart) req.session.cart = { lines: [], coupon: null };
  return req.session.cart;
}

function clampQty(n, max = MAX_QTY) {
  n = Math.floor(Number(n) || 1);
  return Math.max(1, Math.min(max, n));
}

function addProduct(cart, productId, qty) {
  const id = Number(productId);
  const existing = cart.lines.find((l) => l.type === 'product' && l.productId === id);
  if (existing) existing.qty = clampQty(existing.qty + clampQty(qty));
  else cart.lines.push({ key: crypto.randomUUID(), type: 'product', productId: id, qty: clampQty(qty) });
}

function addCustom(cart, { boxId, items, qty }) {
  cart.lines.push({
    key: crypto.randomUUID(),
    type: 'custom',
    boxId: Number(boxId),
    items: items.map((i) => ({ id: Number(i.id), qty: clampQty(i.qty, 50) })),
    qty: clampQty(qty),
  });
}

function updateQty(cart, key, qty) {
  const line = cart.lines.find((l) => l.key === key);
  if (!line) return;
  if (Number(qty) <= 0) cart.lines = cart.lines.filter((l) => l.key !== key);
  else line.qty = clampQty(qty);
}

function removeLine(cart, key) {
  cart.lines = cart.lines.filter((l) => l.key !== key);
}

/** Kiểm tra giỏ tự tạo, trả về { box, items, unitPrice } hoặc { error } */
async function resolveCustom({ boxId, items }) {
  const box = await db('builder_boxes').where({ id: Number(boxId), is_active: true }).first();
  if (!box) return { error: 'Vui lòng chọn hộp quà.' };
  const ids = [...new Set((items || []).map((i) => Number(i.id)).filter(Boolean))];
  if (!ids.length) return { error: 'Vui lòng chọn ít nhất một món.' };
  const rows = await db('builder_items').whereIn('id', ids).andWhere({ is_active: true });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const picked = [];
  let count = 0;
  let price = box.price;
  for (const i of items) {
    const row = byId.get(Number(i.id));
    if (!row) continue;
    const qty = clampQty(i.qty, 50);
    count += qty;
    price += row.price * qty;
    picked.push({ id: row.id, name: row.name, price: row.price, qty, image_id: row.image_id });
  }
  if (count < MIN_CUSTOM_ITEMS) return { error: `Giỏ quà cần ít nhất ${MIN_CUSTOM_ITEMS} món.` };
  if (count > box.capacity) return { error: `${box.name} chứa tối đa ${box.capacity} món.` };
  return { box, items: picked, count, unitPrice: price };
}

async function validateCoupon(code, subtotal) {
  if (!code) return { discount: 0 };
  const c = await db('coupons').whereRaw('UPPER(code) = ?', [String(code).trim().toUpperCase()]).first();
  if (!c || !c.is_active) return { error: 'Mã giảm giá không tồn tại hoặc đã ngừng áp dụng.' };
  const today = todayVN();
  if (c.starts_at && today < c.starts_at) return { error: 'Mã giảm giá chưa đến thời gian áp dụng.' };
  if (c.ends_at && today > c.ends_at) return { error: 'Mã giảm giá đã hết hạn.' };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { error: 'Mã giảm giá đã hết lượt sử dụng.' };
  if (subtotal < c.min_order) {
    return {
      error: `Mã ${c.code} áp dụng cho đơn từ ${new Intl.NumberFormat('vi-VN').format(c.min_order)}₫.`,
    };
  }
  let discount = c.type === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.max_discount) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, subtotal);
  return { coupon: c, discount };
}

/**
 * Tính lại toàn bộ giỏ hàng từ DB (không tin giá phía client).
 * Đồng thời dọn các dòng không còn hợp lệ.
 */
async function priceCart(cart) {
  const s = await settings.all();
  const productIds = cart.lines.filter((l) => l.type === 'product').map((l) => l.productId);
  const products = productIds.length
    ? await db('products').whereIn('id', productIds).andWhere({ is_active: true })
    : [];
  const pById = new Map(products.map((p) => [p.id, p]));

  const lines = [];
  const notices = [];
  const keep = [];
  for (const l of cart.lines) {
    if (l.type === 'product') {
      const p = pById.get(l.productId);
      if (!p) {
        notices.push('Một sản phẩm trong giỏ đã ngừng kinh doanh và được bỏ ra.');
        continue;
      }
      if (p.stock <= 0) {
        notices.push(`${p.name} vừa hết hàng và được bỏ khỏi giỏ.`);
        continue;
      }
      if (l.qty > p.stock) {
        l.qty = p.stock;
        notices.push(`${p.name} chỉ còn ${p.stock} giỏ, số lượng đã được điều chỉnh.`);
      }
      keep.push(l);
      lines.push({
        key: l.key, type: 'product', productId: p.id, name: p.name, url: `/san-pham/${p.slug}`,
        image_id: p.image_id, unitPrice: p.price, comparePrice: p.compare_price, qty: l.qty,
        lineTotal: p.price * l.qty, maxQty: Math.min(p.stock, MAX_QTY),
      });
    } else if (l.type === 'custom') {
      const r = await resolveCustom(l);
      if (r.error) {
        notices.push('Một giỏ quà tự tạo không còn hợp lệ và được bỏ ra.');
        continue;
      }
      keep.push(l);
      lines.push({
        key: l.key, type: 'custom', name: `Giỏ quà tự tạo · ${r.box.name}`, url: '/tu-tao-gio-qua',
        image_id: r.box.image_id, unitPrice: r.unitPrice, qty: l.qty, lineTotal: r.unitPrice * l.qty,
        maxQty: MAX_QTY,
        details: { box: { id: r.box.id, name: r.box.name, price: r.box.price }, items: r.items },
      });
    }
  }
  cart.lines = keep;

  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  let discount = 0;
  let couponError = null;
  let coupon = null;
  if (cart.coupon) {
    const r = await validateCoupon(cart.coupon, subtotal);
    if (r.error) couponError = r.error;
    else {
      coupon = r.coupon;
      discount = r.discount;
    }
  }
  const threshold = Number(s.free_ship_threshold) || 0;
  const fee = Number(s.shipping_fee) || 0;
  const afterDiscount = subtotal - discount;
  const shippingFee = !lines.length || (threshold && afterDiscount >= threshold) ? 0 : fee;
  const count = lines.reduce((a, l) => a + l.qty, 0);

  return {
    lines, notices, subtotal, discount, coupon, couponCode: cart.coupon, couponError,
    shippingFee, total: afterDiscount + shippingFee, count,
    freeShipRemaining: threshold && afterDiscount < threshold ? threshold - afterDiscount : 0,
    freeShipThreshold: threshold,
  };
}

function cartCount(req) {
  const c = req.session && req.session.cart;
  return c ? c.lines.reduce((a, l) => a + l.qty, 0) : 0;
}

module.exports = {
  getCart, addProduct, addCustom, updateQty, removeLine, priceCart, resolveCustom, validateCoupon,
  cartCount, MIN_CUSTOM_ITEMS,
};
