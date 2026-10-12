const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const notify = require('../lib/notify');
const config = require('../config');
const { Form } = require('../lib/validate');
const { requireUser, safeNext } = require('../middleware/auth');
const { flash } = require('../middleware/locals');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: true, legacyHeaders: false });

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, address: u.address, role: u.role };
}

/** Đổi session id khi đăng nhập để chống session fixation, giữ lại giỏ hàng. */
function login(req, user) {
  return new Promise((resolve, reject) => {
    const keep = { cart: req.session.cart, myOrders: req.session.myOrders };
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, keep);
      req.session.user = publicUser(user);
      resolve();
    });
  });
}

function view(res, name, title, data) {
  res.locals.seo.title = `${title} · Lunar Lucky`;
  res.locals.seo.noindex = true;
  res.render(`account/${name}`, data);
}

router.get('/dang-nhap', (req, res) => {
  if (req.session.user) return res.redirect(safeNext(req.query.next, '/tai-khoan'));
  view(res, 'login', 'Đăng nhập', { values: { email: '' }, error: null, next: safeNext(req.query.next, '') });
});

router.post('/dang-nhap', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = email ? await db('users').where({ email }).first() : null;
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  const next = safeNext(req.body.next, '');
  if (!ok) {
    res.status(401);
    return view(res, 'login', 'Đăng nhập', { values: { email }, error: 'Email hoặc mật khẩu chưa đúng.', next });
  }
  await login(req, user);
  res.redirect(next || (user.role === 'admin' ? '/admin' : '/tai-khoan'));
});

router.get('/dang-ky', (req, res) => {
  if (req.session.user) return res.redirect('/tai-khoan');
  view(res, 'register', 'Tạo tài khoản', { values: {}, errors: {} });
});

router.post('/dang-ky', authLimiter, async (req, res) => {
  const f = new Form(req.body);
  const name = f.text('name', { label: 'họ tên', required: true, min: 2, max: 120 });
  const email = f.email('email', { required: true });
  const phone = f.phone('phone', { required: false });
  const password = String(req.body.password || '');
  if (password.length < 8) f.errors.password = 'Mật khẩu cần ít nhất 8 ký tự.';
  if (f.ok && (await db('users').where({ email }).first())) {
    f.errors.email = 'Email này đã có tài khoản. Bạn có thể đăng nhập.';
  }
  if (!f.ok) {
    res.status(422);
    return view(res, 'register', 'Tạo tài khoản', { values: f.values, errors: f.errors });
  }
  const [id] = await db('users').insert({
    name, email, phone: phone || null, password_hash: await bcrypt.hash(password, 11), role: 'customer',
  });
  const user = await db('users').where({ id: typeof id === 'object' ? id.id : id }).first();
  await login(req, user);
  flash(req, 'success', `Chào mừng ${user.name} đến với Lunar Lucky.`);
  res.redirect('/tai-khoan');
});

router.post('/dang-xuat', (req, res) => {
  const cart = req.session.cart;
  req.session.regenerate(() => {
    req.session.cart = cart;
    res.redirect('/');
  });
});

router.get('/tai-khoan', requireUser, async (req, res) => {
  const orders = await db('orders').where({ user_id: req.session.user.id }).orderBy('id', 'desc').limit(50);
  view(res, 'dashboard', 'Tài khoản', { orders, values: req.session.user, errors: {} });
});

router.post('/tai-khoan', requireUser, async (req, res) => {
  const f = new Form(req.body);
  const name = f.text('name', { label: 'họ tên', required: true, min: 2, max: 120 });
  const phone = f.phone('phone', { required: false });
  const address = f.text('address', { max: 255 });
  if (!f.ok) {
    const orders = await db('orders').where({ user_id: req.session.user.id }).orderBy('id', 'desc').limit(50);
    res.status(422);
    return view(res, 'dashboard', 'Tài khoản', { orders, values: { ...req.session.user, ...f.values }, errors: f.errors });
  }
  await db('users').where({ id: req.session.user.id }).update({ name, phone: phone || null, address: address || null, updated_at: new Date() });
  Object.assign(req.session.user, { name, phone, address });
  flash(req, 'success', 'Đã lưu thông tin tài khoản.');
  res.redirect('/tai-khoan');
});

router.get('/quen-mat-khau', (req, res) => {
  view(res, 'forgot', 'Quên mật khẩu', { sent: false, email: '' });
});

router.post('/quen-mat-khau', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = email ? await db('users').where({ email }).first() : null;
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db('users').where({ id: user.id }).update({ reset_token: hash, reset_expires: Date.now() + 3600000 });
    notify.sendMail({
      to: user.email,
      subject: 'Đặt lại mật khẩu Lunar Lucky',
      template: 'reset-password',
      data: { name: user.name, link: `${config.siteUrl}/dat-lai-mat-khau/${token}`, s: res.locals.s },
    });
  }
  // Luôn báo đã gửi để không lộ email nào có tài khoản
  view(res, 'forgot', 'Quên mật khẩu', { sent: true, email });
});

async function userByToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const u = await db('users').where({ reset_token: hash }).first();
  return u && Number(u.reset_expires) > Date.now() ? u : null;
}

router.get('/dat-lai-mat-khau/:token', async (req, res) => {
  const u = await userByToken(req.params.token);
  view(res, 'reset', 'Đặt lại mật khẩu', { valid: !!u, token: req.params.token, error: null });
});

router.post('/dat-lai-mat-khau/:token', authLimiter, async (req, res) => {
  const u = await userByToken(req.params.token);
  if (!u) return view(res, 'reset', 'Đặt lại mật khẩu', { valid: false, token: '', error: null });
  const password = String(req.body.password || '');
  if (password.length < 8) {
    res.status(422);
    return view(res, 'reset', 'Đặt lại mật khẩu', { valid: true, token: req.params.token, error: 'Mật khẩu cần ít nhất 8 ký tự.' });
  }
  await db('users').where({ id: u.id }).update({
    password_hash: await bcrypt.hash(password, 11), reset_token: null, reset_expires: null, updated_at: new Date(),
  });
  await login(req, u);
  flash(req, 'success', 'Đã đặt lại mật khẩu.');
  res.redirect(u.role === 'admin' ? '/admin' : '/tai-khoan');
});

module.exports = router;
