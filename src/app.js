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
      // Có mã phiên bản (?v=hash, đổi khi tệp đổi) → điện thoại khách lưu hẳn 1 năm, khỏi tải lại
      if (config.isProd && res.req && res.req.query && res.req.query.v) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (/\.(css|js)$/.test(file) && config.isProd) res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }),
);

// Dùng cho dịch vụ ping giữ server luôn thức (Render free) và kiểm tra sức khỏe
app.get('/healthz', async (req, res) => {
  // ?db=1: chạm cả database để dịch vụ DB miễn phí không tự tắt vì "không hoạt động"
  if (req.query.db) {
    try {
      await db.raw('select 1');
    } catch (err) {
      return res.status(503).type('text/plain').send('db error');
    }
  }
  res.type('text/plain').send('ok');
});

// Ảnh lưu trong DB — không mất khi deploy lại
// Ảnh lưu trong database → giữ bản sao trong RAM (tối đa ~48MB) để cao điểm không đọc database mỗi lượt xem
const mediaCache = new Map();
let mediaCacheBytes = 0;
const MEDIA_CACHE_MAX = 48 * 1024 * 1024;
app.get('/media/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  let m = mediaCache.get(id);
  if (m) {
    mediaCache.delete(id); // đưa lên cuối = mới dùng
    mediaCache.set(id, m);
  } else {
    m = await db('media').where({ id }).first('mime', 'data', 'created_at');
    if (!m) return res.status(404).end();
    m = { mime: m.mime, data: Buffer.from(m.data) };
    if (m.data.length < 4 * 1024 * 1024) {
      mediaCache.set(id, m);
      mediaCacheBytes += m.data.length;
      while (mediaCacheBytes > MEDIA_CACHE_MAX && mediaCache.size) {
        const [oldId, old] = mediaCache.entries().next().value;
        mediaCache.delete(oldId);
        mediaCacheBytes -= old.data.length;
      }
    }
  }
  res.set({
    'Content-Type': m.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(m.data);
});

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { if (req.url.startsWith('/messenger/')) req.rawBody = buf; } }));

// Webhook Telegram: nút xử lý đơn trong nhóm. Đặt trước session/CSRF vì Telegram gọi trực tiếp.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/apple-touch-icon.png'));

app.post('/telegram/webhook', (req, res) => {
  const tg = require('./lib/telegram-orders');
  if (req.get('x-telegram-bot-api-secret-token') !== tg.webhookSecret()) return res.status(403).end();
  res.sendStatus(200);
  tg.handleUpdate(req.body || {}).catch((err) => console.error('[telegram] webhook lỗi:', err.message));
});

// Webhook Messenger: khách nhắn Fanpage → AI tư vấn trả lời. Đặt trước session/CSRF vì Facebook gọi trực tiếp.
app.get('/messenger/webhook', (req, res) => {
  const challenge = require('./lib/messenger').verifyChallenge(req.query);
  if (challenge === null) return res.status(403).end();
  res.type('text/plain').send(challenge);
});
app.post('/messenger/webhook', (req, res) => {
  const m = require('./lib/messenger');
  if (!m.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) return res.status(403).end();
  res.sendStatus(200); // trả lời Facebook ngay, AI xử lý sau (có thể mất vài giây)
  m.handleWebhook(req.body);
});

// Webhook SePay: báo tiền vào tài khoản → tự xác nhận đơn chuyển khoản. Đặt trước session/CSRF.
app.post('/thanh-toan/sepay-webhook', async (req, res) => {
  const bank = require('./lib/bank-payments');
  if (!bank.authorized(req)) return res.status(401).json({ success: false });
  try {
    const r = await bank.handleSepay(req.body || {});
    res.status(200).json({ success: true, result: r.result });
  } catch (err) {
    console.error('[sepay] webhook lỗi:', err.message);
    res.status(500).json({ success: false }); // SePay sẽ gửi lại
  }
});

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
app.use(require('./routes/callback'));
app.use(require('./routes/reviews'));
app.use(require('./routes/ai'));
app.use(require('./routes/blog'));
app.use(require('./routes/pages'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404);
  res.locals.seo.title = 'Không tìm thấy trang · Lunar Lucky';
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
  res.locals.seo.title = 'Có lỗi xảy ra · Lunar Lucky';
  res.locals.seo.noindex = true;
  res.render('errors/error', { status, message });
});

module.exports = app;
