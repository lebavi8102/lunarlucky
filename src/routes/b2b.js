const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const notify = require('../lib/notify');
const { Form } = require('../lib/validate');

const router = express.Router();
const quoteLimiter = rateLimit({ windowMs: 30 * 60000, limit: 6, standardHeaders: true, legacyHeaders: false });

async function render(res, data) {
  const products = await db('products')
    .where({ is_active: true })
    .orderBy([{ column: 'is_featured', order: 'desc' }, { column: 'sold', order: 'desc' }])
    .limit(4);
  res.locals.seo.title = 'Quà Tết doanh nghiệp · In logo, giao hàng loạt · Lunar Lucky';
  res.locals.seo.description =
    'Giải pháp quà Tết doanh nghiệp trọn gói: tư vấn ngân sách, in logo lên hộp và thiệp, xuất hóa đơn VAT, giao hàng loạt đúng hẹn trên toàn quốc.';
  res.render('pages/business', { products, ...data });
}

router.get('/qua-tang-doanh-nghiep', (req, res) => render(res, { values: {}, errors: {}, sent: req.query['da-gui'] === '1' }));

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
  };
  if (!f.ok) {
    res.status(422);
    return render(res, { values: f.values, errors: f.errors, sent: false });
  }
  await db('quotes').insert(q);
  notify.telegram(notify.quoteTelegram(q));
  if (q.email) {
    notify.sendMail({ to: q.email, subject: `Lunar Lucky đã nhận yêu cầu báo giá của ${q.company}`, template: 'quote-received', data: { q, s: res.locals.s } })
      .catch((err) => console.error('[mail] báo giá lỗi:', err.message));
  }
  // Chuyển hướng sau khi gửi: tải lại trang không gửi trùng yêu cầu
  res.redirect(303, '/qua-tang-doanh-nghiep?da-gui=1#bao-gia');
});

module.exports = router;
