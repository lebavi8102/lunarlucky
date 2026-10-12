const config = require('../config');
const settings = require('../lib/settings');
const fmt = require('../lib/format');
const { cartCount } = require('../lib/cart');

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
