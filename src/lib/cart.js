const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const { todayVN, money } = require('./format');

const MAX_QTY = 500;

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

function updateQty(cart, key, qty) {
  const line = cart.lines.find((l) => l.key === key);
  if (!line) return;
  if (Number(qty) <= 0) cart.lines = cart.lines.filter((l) => l.key !== key);
  else line.qty = clampQty(qty);
}

function removeLine(cart, key) {
  cart.lines = cart.lines.filter((l) => l.key !== key);
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
const isHanoi = (province) => /hà nội/i.test(String(province || '').normalize('NFC'));

/**
 * Phí giao theo vùng: Hà Nội (shipping_fee, free_ship_threshold) và tỉnh khác
 * (province_shipping_fee, province_free_ship_threshold — để trống = giống Hà Nội; ngưỡng 0 = không miễn phí).
 * Chưa chọn tỉnh → tính theo Hà Nội.
 */
function shipRule(s, province) {
  const hn = { fee: Number(s.shipping_fee) || 0, threshold: Number(s.free_ship_threshold) || 0 };
  if (!String(province || '').trim() || isHanoi(province)) return hn;
  const or = (v, d) => (String(v ?? '').trim() === '' ? d : Number(v) || 0);
  return { fee: or(s.province_shipping_fee, hn.fee), threshold: or(s.province_free_ship_threshold, hn.threshold) };
}

function shipRulesDiffer(s) {
  const a = shipRule(s, 'Hà Nội');
  const b = shipRule(s, 'Tỉnh khác');
  return a.fee !== b.fee || a.threshold !== b.threshold;
}

/** "50.000₫/đơn, miễn phí cho đơn từ 1.500.000₫" — một vùng. */
function shipRuleText({ fee, threshold }) {
  if (!fee) return 'miễn phí giao';
  return threshold ? `${money(fee)}/đơn, miễn phí cho đơn từ ${money(threshold)}` : `${money(fee)}/đơn`;
}

/** Câu phí giao cho khách: một câu nếu hai vùng giống nhau, tách Hà Nội / tỉnh khác nếu khác. */
function shipText(s) {
  const hn = shipRuleText(shipRule(s, 'Hà Nội'));
  return shipRulesDiffer(s) ? `Hà Nội: ${hn}. Tỉnh khác: ${shipRuleText(shipRule(s, 'Tỉnh khác'))}` : hn;
}

async function priceCart(cart, { province } = {}) {
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
        lineTotal: p.price * l.qty, maxQty: Math.min(p.stock, MAX_QTY), unitCost: p.cost_price ?? null,
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
  const afterDiscount = subtotal - discount;
  const feeFor = (rule) => (!lines.length || (rule.threshold && afterDiscount >= rule.threshold) ? 0 : rule.fee);
  const { fee, threshold } = shipRule(s, province);
  const shippingFee = feeFor({ fee, threshold });
  const count = lines.reduce((a, l) => a + l.qty, 0);
  // Cả hai vùng — trang thanh toán đổi phí giao/tổng tiền ngay khi khách đổi tỉnh
  const areas = {};
  for (const [k, p] of [['hn', 'Hà Nội'], ['tinh', 'Tỉnh khác']]) {
    const f = feeFor(shipRule(s, p));
    areas[k] = { shippingFee: f, total: afterDiscount + f };
  }

  return {
    lines, notices, subtotal, discount, coupon, couponCode: cart.coupon, couponError,
    shippingFee, total: afterDiscount + shippingFee, count, areas,
    freeShipRemaining: threshold && afterDiscount < threshold ? threshold - afterDiscount : 0,
    freeShipThreshold: threshold,
    shipDiffers: shipRulesDiffer(s), shipText: shipText(s),
  };
}

function cartCount(req) {
  const c = req.session && req.session.cart;
  return c ? c.lines.reduce((a, l) => a + l.qty, 0) : 0;
}

module.exports = {
  getCart, addProduct, updateQty, removeLine, priceCart, validateCoupon, cartCount, shipRule, shipRulesDiffer, shipText, isHanoi,
};
