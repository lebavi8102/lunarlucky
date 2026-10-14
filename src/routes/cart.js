const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const cart = require('../lib/cart');
const { flash } = require('../middleware/locals');

const router = express.Router();
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

const couponLimiter = rateLimit({ windowMs: 10 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false });

router.get('/gio-hang', async (req, res) => {
  const c = cart.getCart(req);
  const priced = await cart.priceCart(c);
  res.locals.cartCount = priced.count;
  res.locals.seo.title = 'Giỏ hàng · Lunar Lucky';
  res.locals.seo.noindex = true;
  res.render('shop/cart', { cart: priced });
});

router.post('/gio-hang/them', async (req, res) => {
  const product = await db('products').where({ id: Number(req.body.product_id), is_active: true }).first();
  if (!product || product.stock <= 0) {
    const msg = 'Sản phẩm hiện đã hết hàng.';
    if (wantsJson(req)) return res.status(400).json({ ok: false, error: msg });
    flash(req, 'error', msg);
    return res.redirect(product ? `/san-pham/${product.slug}` : '/bo-suu-tap');
  }
  const c = cart.getCart(req);
  cart.addProduct(c, product.id, req.body.qty);
  const line = c.lines.find((l) => l.type === 'product' && l.productId === product.id);
  if (line.qty > product.stock) line.qty = product.stock;
  const count = cart.cartCount(req);
  if (wantsJson(req)) return res.json({ ok: true, count, name: product.name });
  if (req.body.buy_now) return res.redirect('/thanh-toan');
  flash(req, 'success', `Đã thêm “${product.name}” vào giỏ hàng.`);
  res.redirect('/gio-hang');
});

router.post('/gio-hang/cap-nhat', (req, res) => {
  const c = cart.getCart(req);
  cart.updateQty(c, String(req.body.key), req.body.qty);
  if (wantsJson(req)) return res.json({ ok: true, count: cart.cartCount(req) });
  res.redirect('/gio-hang');
});

router.post('/gio-hang/xoa', (req, res) => {
  const c = cart.getCart(req);
  cart.removeLine(c, String(req.body.key));
  if (wantsJson(req)) return res.json({ ok: true, count: cart.cartCount(req) });
  res.redirect('/gio-hang');
});

router.post('/gio-hang/ma-giam-gia', couponLimiter, async (req, res) => {
  const c = cart.getCart(req);
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 40);
  if (req.body.remove || !code) {
    c.coupon = null;
    return res.redirect(req.body.from === 'checkout' ? '/thanh-toan' : '/gio-hang');
  }
  const priced = await cart.priceCart({ ...c, coupon: null, lines: [...c.lines] });
  const r = await cart.validateCoupon(code, priced.subtotal);
  if (r.error) flash(req, 'error', r.error);
  else {
    c.coupon = r.coupon.code;
    flash(req, 'success', `Đã áp dụng mã ${r.coupon.code}.`);
  }
  res.redirect(req.body.from === 'checkout' ? '/thanh-toan' : '/gio-hang');
});

module.exports = router;
