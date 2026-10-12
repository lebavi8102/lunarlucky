const express = require('express');
const db = require('../db');
const config = require('../config');
const { toDate } = require('../lib/format');

const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /gio-hang',
      'Disallow: /thanh-toan',
      'Disallow: /don-hang/',
      'Disallow: /tai-khoan',
      'Disallow: /tim-kiem',
      '',
      `Sitemap: ${config.siteUrl}/sitemap.xml`,
    ].join('\n'),
  );
});

router.get('/sitemap.xml', async (req, res) => {
  const [cats, products, posts] = await Promise.all([
    db('categories').where({ is_active: true }).select('slug', 'updated_at'),
    db('products').where({ is_active: true }).select('slug', 'updated_at'),
    db('posts').where({ is_published: true }).select('slug', 'updated_at'),
  ]);
  const { PAGES } = require('./pages');
  const urls = [
    ['/', 'daily', '1.0'],
    ['/bo-suu-tap', 'daily', '0.9'],
    ['/qua-tang-doanh-nghiep', 'weekly', '0.8'],
    ['/blog', 'weekly', '0.6'],
    ...Object.keys(PAGES).map((p) => [`/${p}`, 'monthly', '0.4']),
    ...cats.map((c) => [`/bo-suu-tap/${c.slug}`, 'weekly', '0.8', c.updated_at]),
    ...products.map((p) => [`/san-pham/${p.slug}`, 'weekly', '0.9', p.updated_at]),
    ...posts.map((p) => [`/blog/${p.slug}`, 'monthly', '0.6', p.updated_at]),
  ];
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(([loc, freq, pri, mod]) => {
        const d = toDate(mod);
        return `  <url><loc>${config.siteUrl}${encodeURI(loc)}</loc>${d ? `<lastmod>${d.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
      })
      .join('\n') +
    '\n</urlset>\n';
  res.type('application/xml').send(xml);
});

module.exports = router;
