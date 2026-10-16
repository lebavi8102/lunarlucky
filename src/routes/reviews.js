const express = require('express');
const db = require('../db');
const { upload, saveFile } = require('../lib/media');
const reviews = require('../lib/reviews');

const router = express.Router();

async function load(req) {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^LN\w{6,14}$/.test(code)) return null;
  const order = await db('orders').where({ code }).first();
  if (!order || order.status === 'cancelled') return null;
  const okKey = String(req.query.k || '') === require('./checkout').orderKey(code);
  const mine = (req.session.myOrders || []).includes(code);
  return okKey || mine ? order : null;
}

router.get('/danh-gia/:code', async (req, res, next) => {
  const order = await load(req);
  if (!order) return next();
  res.locals.seo.title = 'Cảm nhận về giỏ quà · Lunar Lucky';
  res.locals.seo.noindex = true;
  const done = await db('testimonials').where({ order_code: order.code }).whereIn('source', ['customer', 'customer-private']).first();
  res.render('shop/review', { order, done: !!done, sent: req.query.da === '1', error: null, values: {}, k: String(req.query.k || '') });
});

router.post('/danh-gia/:code', upload.single('photo'), async (req, res, next) => {
  const order = await load(req);
  if (!order) return next();
  const k = String(req.query.k || '');
  const back = `/danh-gia/${order.code}?k=${encodeURIComponent(k)}`;
  if (await db('testimonials').where({ order_code: order.code }).whereIn('source', ['customer', 'customer-private']).first()) return res.redirect(`${back}&da=1`);
  const rating = Math.round(Number(req.body.rating));
  const content = String(req.body.content || '').trim().slice(0, 400);
  const consent = req.body.consent === '1';
  const fail = (error) => res.status(422).render('shop/review', { order, done: false, sent: false, error, values: { rating, content, consent }, k });
  if (!(rating >= 1 && rating <= 5)) return fail('Anh/chị chọn số sao giúp Lunar Lucky nhé.');
  if (!content && !req.file) return fail('Anh/chị viết vài dòng cảm nhận hoặc gửi một tấm ảnh giúp em nhé.');
  let imageId = null;
  try {
    imageId = req.file ? await saveFile(req.file, `Khách gửi ảnh đơn ${order.code}`) : null;
  } catch (err) {
    return fail(err.message);
  }
  await reviews.saveReview(order, { rating, content, imageId, consent });
  res.redirect(`${back}&da=1`);
});

module.exports = router;
