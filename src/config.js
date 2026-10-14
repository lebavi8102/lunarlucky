const path = require('path');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function required(name, fallback) {
  const v = process.env[name];
  if (v) return v;
  if (isProd && fallback === undefined) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return fallback;
}

// DATABASE_URL dạng mysql://user:pass@host:port/db (copy từ Aiven) — ưu tiên hơn các biến DB_* riêng lẻ
if (process.env.DATABASE_URL) {
  let u;
  try {
    u = new URL(process.env.DATABASE_URL.trim());
  } catch {
    u = null;
  }
  if (!u || u.protocol !== 'mysql:') {
    throw new Error(
      `DATABASE_URL không hợp lệ (đang là "${u ? u.protocol + '//' + u.host : 'không đọc được'}"). ` +
        'Cần dán dòng "Service URI" của Aiven, dạng mysql://avnadmin:...@...aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED',
    );
  }
  process.env.DB_CLIENT = 'mysql2';
  process.env.DB_HOST = u.hostname;
  process.env.DB_PORT = u.port || '3306';
  process.env.DB_USER = decodeURIComponent(u.username);
  process.env.DB_PASSWORD = decodeURIComponent(u.password);
  process.env.DB_NAME = u.pathname.replace(/^\//, '') || 'defaultdb';
  if (/required|verify/i.test(u.searchParams.get('ssl-mode') || '')) process.env.DB_SSL = 'true';
}
if (process.env.DB_SSL_CA_FILE && !process.env.DB_SSL_CA) {
  process.env.DB_SSL_CA = require('fs').readFileSync(path.resolve(root, process.env.DB_SSL_CA_FILE), 'utf8');
}

const dbClient = process.env.DB_CLIENT || (isProd ? 'mysql2' : 'better-sqlite3');

module.exports = {
  env,
  isProd,
  port: Number(process.env.PORT) || 3000,
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Địa chỉ chắc chắn truy cập được (Render tự đặt RENDER_EXTERNAL_URL) — dùng cho webhook, link trong Telegram
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: required('SESSION_SECRET', isProd ? undefined : 'dev-only-secret-change-me'),

  db: {
    client: dbClient,
    connection:
      dbClient === 'mysql2'
        ? {
            host: required('DB_HOST', 'localhost'),
            port: Number(process.env.DB_PORT) || 3306,
            user: required('DB_USER', 'root'),
            password: process.env.DB_PASSWORD || '',
            database: required('DB_NAME', 'lunar'),
            charset: 'utf8mb4',
            dateStrings: false,
            connectTimeout: 10000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000,
            // Database cloud (Aiven, TiDB...) bắt buộc SSL. DB_SSL_CA: nội dung file ca.pem
            ssl:
              process.env.DB_SSL === 'true'
                ? process.env.DB_SSL_CA
                  ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
                  : { rejectUnauthorized: true }
                : undefined,
          }
        : { filename: path.resolve(root, process.env.SQLITE_FILE || './data/lunar.sqlite') },
  },

  // Gmail: SMTP_HOST=smtp.gmail.com, SMTP_USER=địa chỉ gmail, SMTP_PASS=mật khẩu ứng dụng 16 ký tự
  mail: {
    host: String(process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    user: String(process.env.SMTP_USER || '').trim(),
    // Mật khẩu ứng dụng Gmail hiển thị có dấu cách ("abcd efgh ...") → bỏ dấu cách
    pass: /gmail/i.test(process.env.SMTP_HOST || '')
      ? String(process.env.SMTP_PASS || '').replace(/\s+/g, '')
      : String(process.env.SMTP_PASS || '').trim(),
    // Gmail chỉ cho gửi bằng chính địa chỉ gmail đó → mặc định "Lunar Lucky <gmail của shop>"
    from:
      process.env.MAIL_FROM ||
      (process.env.SMTP_USER ? `Lunar Lucky <${String(process.env.SMTP_USER).trim()}>` : 'Lunar Lucky <no-reply@lunarlucky.vn>'),
  },

  // SePay: tự xác nhận chuyển khoản (đơn CK chỉ báo vào nhóm khi đã nhận tiền). Trống = xác nhận tay
  sepay: {
    apiKey: String(process.env.SEPAY_API_KEY || '').trim(),
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },

  uploadMaxBytes: 5 * 1024 * 1024,
};
