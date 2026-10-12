const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const config = require('./config');
const db = require('./db');
const KnexStore = require('./lib/session-store');
const { csrfProtection } = require('./lib/csrf');
const locals = require('./middleware/locals');

const app = express();
const root = path.join(__dirname, '..');

app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://img.vietqr.io'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'https://www.facebook.com'],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(compression());

app.use(
  express.static(path.join(root, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    setHeaders(res, file) {
      if (/\.(css|js)$/.test(file) && config.isProd) res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }),
);

// Ảnh lưu trong DB — không mất khi deploy lại
app.get('/media/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const m = await db('media').where({ id }).first('mime', 'data', 'created_at');
  if (!m) return res.status(404).end();
  res.set({
    'Content-Type': m.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(Buffer.from(m.data));
});

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '100kb' }));

app.use(
  session({
    name: 'lunar.sid',
    secret: config.sessionSecret,
    store: new KnexStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: 14 * 86400000,
    },
  }),
);

app.use(locals);
app.use(csrfProtection);

app.use(require('./routes/seo'));
app.use(require('./routes/shop'));
app.use(require('./routes/cart'));
app.use(require('./routes/checkout'));
app.use(require('./routes/account'));
app.use(require('./routes/b2b'));
app.use(require('./routes/blog'));
app.use(require('./routes/pages'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404);
  res.locals.seo.title = 'Không tìm thấy trang · Lunar';
  res.locals.seo.noindex = true;
  res.render('errors/404');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  const message =
    err.code === 'LIMIT_FILE_SIZE'
      ? 'Ảnh quá lớn (tối đa 5MB).'
      : status < 500
        ? err.message
        : 'Đã có lỗi xảy ra. Vui lòng thử lại sau ít phút.';
  if (req.xhr || (req.get('accept') || '').includes('application/json')) {
    return res.status(status).json({ ok: false, error: message });
  }
  res.status(status);
  if (!res.locals.seo) return res.send(message);
  res.locals.seo.title = 'Có lỗi xảy ra · Lunar';
  res.locals.seo.noindex = true;
  res.render('errors/error', { status, message });
});

module.exports = app;
