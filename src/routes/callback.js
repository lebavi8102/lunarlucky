/** Khách để lại tên + SĐT, Lunar Lucky gọi lại (dùng ở trang sản phẩm, giỏ hàng, thanh toán). */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const cart = require('../lib/cart');
const callbacks = require('../lib/callbacks');
const { Form } = require('../lib/validate');
const { flash } = require('../middleware/locals');

const router = express.Router();
const limiter = rateLimit({ windowMs: 10 * 60000, limit: 5, standardHeaders: true, legacyHeaders: false });
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

router.post('/goi-lai', limiter, async (req, res) => {
  const f = new Form(req.body);
  const name = f.text('name', { label: 'tên của bạn', required: true, max: 120 });
  const phone = f.phone('phone');
  const note = f.text('note', { label: 'ghi chú', max: 300 });
  const source = String(req.body.source || '');
  const back = String(req.body.back || '/').startsWith('/') ? String(req.body.back || '/') : '/';

  if (Object.keys(f.errors).length) {
    const msg = Object.values(f.errors)[0];
    if (wantsJson(req)) return res.status(422).json({ ok: false, errors: f.errors, error: msg });
    flash(req, 'error', msg);
    return res.redirect(back);
  }

  // Khách đang quan tâm giỏ nào: sản phẩm đang xem, hoặc các món trong giỏ hàng
  let productId = Number(req.body.product_id) || null;
  let interest = '';
  if (productId) {
    const p = await db('products').where({ id: productId }).first();
    if (p) interest = p.name;
    else productId = null;
  }
  if (!interest && (source === 'gio-hang' || source === 'thanh-toan')) {
    const priced = await cart.priceCart(cart.getCart(req));
    if (priced.lines.length) {
      interest = priced.lines.map((l) => `${l.name} × ${l.qty}`).join(', ') + ` (tạm tính ${require('../lib/format').money(priced.subtotal)})`;
    }
  }

  await callbacks.create({ name, phone, productId, interest, note, source });
  const ok = `Cảm ơn ${name}! Lunar Lucky sẽ gọi lại số ${phone} trong ít phút.`;
  if (wantsJson(req)) return res.json({ ok: true, message: ok });
  flash(req, 'success', ok);
  res.redirect(back);
});

module.exports = router;
