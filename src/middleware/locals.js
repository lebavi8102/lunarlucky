const config = require('../config');
const settings = require('../lib/settings');
const fmt = require('../lib/format');
const { cartCount } = require('../lib/cart');

/**
 * Mã phiên bản file tĩnh = hash nội dung CSS/JS lúc khởi động.
 * Đổi code → mã đổi → trình duyệt (nhất là điện thoại) tải bản mới thay vì dùng bản cũ trong bộ nhớ đệm.
 */
const ASSET_VERSION = (() => {
  const fs = require('fs');
  const path = require('path');
  const h = require('crypto').createHash('sha1');
  for (const dir of ['css', 'js']) {
    const abs = path.join(__dirname, '../../public', dir);
    for (const f of fs.readdirSync(abs).sort()) h.update(fs.readFileSync(path.join(abs, f)));
  }
  return h.digest('hex').slice(0, 10);
})();

const { awaitingMoney, amountDue, codDue, depositRule, depositFor } = require('../lib/payment');
const PAY = { awaitingMoney, amountDue, codDue, depositRule, depositFor };

function asset(p) {
  return `${p}?v=${ASSET_VERSION}`;
}

function img(id, fallback = '/img/placeholder.svg') {
  return id ? `/media/${id}` : fallback;
}

/** Biến dùng chung cho mọi view. */
module.exports = async function locals(req, res, next) {
  const s = await settings.all();
  res.locals.s = s;
  res.locals.fmt = fmt;
  res.locals.money = fmt.money;
  res.locals.img = img;
  res.locals.asset = asset;
  res.locals.pay = PAY; // tiền cọc / tiền cần trả / tiền thu COD dùng trong giao diện
  res.locals.siteUrl = config.siteUrl;
  res.locals.path = req.path;
  res.locals.user = req.session.user || null;
  res.locals.cartCount = cartCount(req);
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.seo = {
    title: `${s.shop_name} · ${s.shop_tagline}`,
    description: s.hero_subtitle,
    image: `${config.siteUrl}/img/og-default.png`,
    canonical: config.siteUrl + req.path,
    type: 'website',
    noindex: false,
  };
  res.locals.jsonLd = [];
  res.locals.isActive = (prefix) =>
    prefix === '/' ? req.path === '/' : req.path === prefix || req.path.startsWith(prefix + '/');
  next();
};

module.exports.flash = function flash(req, type, message) {
  req.session.flash = { type, message };
};
