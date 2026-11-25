const express = require('express');
const rateLimit = require('express-rate-limit');
const { limiterKey } = require('../lib/client-ip');
const db = require('../db');
const notify = require('../lib/notify');
const { Form } = require('../lib/validate');

const router = express.Router();
const quoteLimiter = rateLimit({ ...limiterKey, windowMs: 30 * 60000, limit: 6, standardHeaders: true, legacyHeaders: false });

const PAGE = '/bo-suu-tap/qua-doanh-nghiep';

// Gộp 2 trang doanh nghiệp về 1 (23/11/2026): link cũ, mã QR trong catalogue in ra → chuyển hẳn sang trang mới
router.get('/qua-tang-doanh-nghiep', (req, res) => {
  res.redirect(301, req.query['da-gui'] === '1' ? `${PAGE}?da-gui=1#nhan-bao-gia` : `${PAGE}#nhan-bao-gia`);
});

router.post('/qua-tang-doanh-nghiep', quoteLimiter, async (req, res) => {
  if (req.body.website) return res.redirect(303, PAGE); // honeypot chống spam
  const f = new Form(req.body);
  const q = {
    company: f.text('company', { label: 'tên doanh nghiệp', max: 200 }),
    contact_name: f.text('contact_name', { label: 'người liên hệ', required: true, min: 2, max: 120 }),
    phone: f.phone('phone'),
    email: f.email('email') || null,
    quantity: f.int('quantity', { label: 'số lượng', min: 5, max: 100000 }),
    budget: f.oneOf('budget', ['Dưới 500.000₫', '500.000₫ – 1.000.000₫', '1.000.000₫ – 2.000.000₫', '2.000.000₫ – 5.000.000₫', 'Trên 5.000.000₫', 'Cần tư vấn'], 'Cần tư vấn'),
    delivery_date: f.date('delivery_date', { label: 'ngày giao dự kiến', minOffset: 2, maxOffset: 365 }) || null,
    logo_print: f.bool('logo_print'),
    message: f.text('message', { max: 2000 }) || null,
  };
  if (req.body.catalogue === '1') q.message = ['📘 Khách xin CATALOGUE + báo giá số lượng (gửi qua Zalo theo số điện thoại)', q.message].filter(Boolean).join('\n');
  if (!f.ok) return res.redirect(303, `${PAGE}?loi=1#nhan-bao-gia`);
  await db('quotes').insert(q);
  notify.telegram(notify.quoteTelegram(q), null, { topic: 'consult' });
  if (q.email) {
    notify.sendMail({ to: q.email, subject: q.company ? `Lunar Lucky đã nhận yêu cầu báo giá của ${q.company}` : 'Lunar Lucky đã nhận yêu cầu báo giá của bạn', template: 'quote-received', data: { q, s: res.locals.s } })
      .catch((err) => console.error('[mail] báo giá lỗi:', err.message));
  }
  // Chuyển hướng sau khi gửi: tải lại trang không gửi trùng yêu cầu
  res.redirect(303, `${PAGE}?da-gui=1#nhan-bao-gia`);
});

// Bảng đơn hàng cho Google Sheets (=IMPORTDATA): đường dẫn có khóa bí mật, không cần đăng nhập
router.get('/bang-don/:kind.csv', async (req, res, next) => {
  const sheet = require('../lib/order-sheet');
  if (!['don', 'tong'].includes(req.params.kind)) return next();
  if (!(await sheet.checkKey(req.query.k))) return res.status(403).type('text/plain').send('Sai khóa');
  const body = req.params.kind === 'don' ? await sheet.donCsv() : await sheet.tongCsv();
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).send(body);
});

// Link chỉ xem bảng đối soát cho nhà cung cấp (có chữ ký, không cần đăng nhập, không sửa được)
router.get('/doi-soat/:id', async (req, res, next) => {
  const supplier = require('../lib/supplier');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || String(req.query.k || '') !== supplier.shareKey(id)) return next();
  const p = await db('supplier_settlements').where({ id }).first();
  if (!p) return next();
  res.locals.seo.title = `Đối soát ${p.period_from} → ${p.period_to} · Lunar Lucky`;
  res.locals.seo.noindex = true;
  res.set('Cache-Control', 'private, no-store');
  res.render('pages/supplier-share', { p, ds: await supplier.sheet({ settlementId: p.id }) });
});

module.exports = router;
