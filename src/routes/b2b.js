const express = require('express');
const rateLimit = require('express-rate-limit');
const { limiterKey } = require('../lib/client-ip');
const db = require('../db');
const notify = require('../lib/notify');
const { Form } = require('../lib/validate');
const cart = require('../lib/cart');

const DELIVERY_MODES = { one: 'Giao 1 địa chỉ', many: 'Giao nhiều địa chỉ (theo danh sách người nhận)' };

/** Giỏ khách đang chọn trên web → "Phú Quý × 10; An Khang × 5" để đưa vào yêu cầu báo giá. */
async function cartSummary(req) {
  const priced = await cart.priceCart(cart.getCart(req));
  if (!priced.lines.length) return null;
  return { count: priced.count, text: priced.lines.map((l) => `${l.name} × ${l.qty}`).join('; ').slice(0, 2000) };
}

const router = express.Router();
const quoteLimiter = rateLimit({ ...limiterKey, windowMs: 30 * 60000, limit: 6, standardHeaders: true, legacyHeaders: false });

async function render(res, data) {
  const products = await db('products')
    .where({ is_active: true })
    .orderBy([{ column: 'is_featured', order: 'desc' }, { column: 'sold', order: 'desc' }])
    .limit(4);
  res.locals.seo.title = 'Quà Tết doanh nghiệp · In logo, giao hàng loạt · Lunar Lucky';
  res.locals.seo.description =
    'Giải pháp quà Tết doanh nghiệp trọn gói: tư vấn ngân sách, in logo lên hộp và thiệp, xuất hóa đơn VAT, giao hàng loạt đúng hẹn trên toàn quốc.';
  res.render('pages/business', { products, deliveryModes: DELIVERY_MODES, ...data });
}

router.get('/qua-tang-doanh-nghiep', async (req, res) => {
  if (req.query['da-gui'] === '1') res.locals.track.events.push({ name: 'generate_lead', value: 0 }); // gửi yêu cầu báo giá
  // Từ giỏ hàng (5 giỏ trở lên) sang: điền sẵn số lượng, kèm danh sách giỏ đã chọn
  const fromCart = req.query['tu-gio'] === '1' ? await cartSummary(req) : null;
  const values = fromCart ? { quantity: Math.max(5, fromCart.count), from_cart: '1' } : {};
  render(res, { values, errors: {}, sent: req.query['da-gui'] === '1', fromCart });
});

router.post('/qua-tang-doanh-nghiep', quoteLimiter, async (req, res) => {
  if (req.body.website) return res.redirect('/qua-tang-doanh-nghiep'); // honeypot chống spam
  const f = new Form(req.body);
  const q = {
    company: f.text('company', { label: 'tên doanh nghiệp', required: true, min: 2, max: 200 }),
    contact_name: f.text('contact_name', { label: 'người liên hệ', required: true, min: 2, max: 120 }),
    phone: f.phone('phone'),
    email: f.email('email') || null,
    quantity: f.int('quantity', { label: 'số lượng', min: 5, max: 100000, required: true }),
    budget: f.oneOf('budget', ['Dưới 500.000₫', '500.000₫ – 1.000.000₫', '1.000.000₫ – 2.000.000₫', '2.000.000₫ – 5.000.000₫', 'Trên 5.000.000₫', 'Cần tư vấn'], 'Cần tư vấn'),
    delivery_date: f.date('delivery_date', { label: 'ngày giao dự kiến', minOffset: 2, maxOffset: 365 }) || null,
    logo_print: f.bool('logo_print'),
    message: f.text('message', { max: 2000 }) || null,
    delivery_mode: f.oneOf('delivery_mode', Object.keys(DELIVERY_MODES), 'one'),
    delivery_points: null,
    delivery_area: f.text('delivery_area', { max: 500 }) || null,
    cart_summary: null,
  };
  if (q.delivery_mode === 'many') q.delivery_points = f.int('delivery_points', { label: 'số điểm giao', min: 2, max: 100000 }) || null;
  const fromCart = req.body.from_cart === '1' ? await cartSummary(req) : null;
  if (fromCart) q.cart_summary = fromCart.text;
  if (!f.ok) {
    res.status(422);
    return render(res, { values: f.values, errors: f.errors, sent: false, fromCart });
  }
  await db('quotes').insert(q);
  notify.telegram(notify.quoteTelegram(q), null, { topic: 'consult' });
  if (q.email) {
    notify.sendMail({ to: q.email, subject: `Lunar Lucky đã nhận yêu cầu báo giá của ${q.company}`, template: 'quote-received', data: { q, s: res.locals.s } })
      .catch((err) => console.error('[mail] báo giá lỗi:', err.message));
  }
  // Chuyển hướng sau khi gửi: tải lại trang không gửi trùng yêu cầu
  res.redirect(303, '/qua-tang-doanh-nghiep?da-gui=1#bao-gia');
});

module.exports = router;
