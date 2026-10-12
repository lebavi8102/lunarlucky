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

const dbClient = process.env.DB_CLIENT || (isProd ? 'mysql2' : 'better-sqlite3');

module.exports = {
  env,
  isProd,
  port: Number(process.env.PORT) || 3000,
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
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
          }
        : { filename: path.resolve(root, process.env.SQLITE_FILE || './data/lunar.sqlite') },
  },

  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'Lunar <no-reply@lunar.vn>',
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
