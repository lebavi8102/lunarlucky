const express = require('express');
const testimonials = require('../lib/testimonials');
const db = require('../db');
const { render: md } = require('../lib/markdown');
const { lines, parseJson, truncate } = require('../lib/format');

const router = express.Router();

const SORTS = {
  'noi-bat': [['is_featured', 'desc'], ['sort', 'asc'], ['id', 'desc']],
  'ban-chay': [['sold', 'desc'], ['id', 'desc']],
  'gia-tang': [['price', 'asc']],
  'gia-giam': [['price', 'desc']],
  'moi-nhat': [['id', 'desc']],
};
const PRICE_RANGES = {
  'duoi-1-trieu': [0, 999999],
  '1-2-trieu': [1000000, 2000000],
  '2-5-trieu': [2000001, 5000000],
  'tren-5-trieu': [5000001, null],
};

function activeProducts() {
  return db('products').where('products.is_active', true);
}

router.get('/', async (req, res) => {
  const [featured, categories, bestsellers, posts, reviews] = await Promise.all([
    activeProducts().andWhere({ is_featured: true }).orderBy([{ column: 'sort' }, { column: 'id', order: 'desc' }]).limit(8),
    db('categories').where({ is_active: true }).orderBy('sort'),
    activeProducts().orderBy([{ column: 'sold', order: 'desc' }]).limit(4),
    db('posts').where({ is_published: true }).orderBy('published_at', 'desc').limit(3),
    testimonials.listActive({ limit: 8 }),
  ]);
  const s = res.locals.s;
  res.locals.seo.title = `${s.shop_name} · Giỏ quà Tết cao cấp, giao tận nơi`;
  res.locals.jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: s.shop_name,
    description: s.hero_subtitle,
    url: res.locals.siteUrl,
    telephone: s.shop_phone,
    email: s.shop_email,
    logo: `${res.locals.siteUrl}/img/logo-mark.svg`,
    sameAs: [s.fanpage_url].filter(Boolean),
  });
  res.render('shop/home', { reviews, featured, categories, bestsellers, posts });
});

async function listing(req, res, category) {
  const sort = SORTS[req.query.sap_xep] ? req.query.sap_xep : 'noi-bat';
  const range = PRICE_RANGES[req.query.gia] ? req.query.gia : null;
  const page = Math.max(1, Number(req.query.trang) || 1);
  const perPage = 12;

  let q = activeProducts();
  if (category) q = q.andWhere({ category_id: category.id });
  if (range) {
    const [min, max] = PRICE_RANGES[range];
    q = q.andWhere('price', '>=', min);
    if (max) q = q.andWhere('price', '<=', max);
  }
  const [{ n }] = await q.clone().count({ n: '*' });
  const products = await q
    .orderBy(SORTS[sort].map(([column, order]) => ({ column, order })))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const categories = await db('categories').where({ is_active: true }).orderBy('sort');
  return { products, categories, sort, range, page, pages: Math.max(1, Math.ceil(Number(n) / perPage)), total: Number(n) };
}

router.get('/bo-suu-tap', async (req, res) => {
  const data = await listing(req, res, null);
  res.locals.seo.title = 'Tất cả giỏ quà Tết · Lunar Lucky';
  res.locals.seo.description = 'Khám phá toàn bộ bộ sưu tập giỏ quà Tết Lunar Lucky: hộp sơn mài, giỏ mây tre, quà doanh nghiệp, giá từ vài trăm nghìn đến cao cấp.';
  res.render('shop/collection', { ...data, category: null, sorts: Object.keys(SORTS), ranges: Object.keys(PRICE_RANGES) });
});

router.get('/bo-suu-tap/:slug', async (req, res, next) => {
  const category = await db('categories').where({ slug: req.params.slug, is_active: true }).first();
  if (!category) return next();
  const data = await listing(req, res, category);
  res.locals.seo.title = `${category.name} · Lunar Lucky`;
  res.locals.seo.description = category.tagline || truncate(category.description, 160);
  if (category.image_id) res.locals.seo.image = `${res.locals.siteUrl}/media/${category.image_id}`;
  res.locals.jsonLd.push(breadcrumb(res, [['Bộ sưu tập', '/bo-suu-tap'], [category.name, `/bo-suu-tap/${category.slug}`]]));
  res.render('shop/collection', { ...data, category, sorts: Object.keys(SORTS), ranges: Object.keys(PRICE_RANGES) });
});

router.get('/san-pham/:slug', async (req, res, next) => {
  const product = await activeProducts().andWhere({ slug: req.params.slug }).first();
  if (!product) return next();
  const category = product.category_id ? await db('categories').where({ id: product.category_id }).first() : null;
  const related = await activeProducts()
    .andWhere('id', '!=', product.id)
    .modify((q) => category && q.andWhere({ category_id: category.id }))
    .orderBy('sold', 'desc')
    .limit(4);
  const gallery = [product.image_id, ...parseJson(product.gallery, [])].filter(Boolean);
  const url = `${res.locals.siteUrl}/san-pham/${product.slug}`;

  res.locals.seo.title = product.seo_title || `${product.name} · Lunar Lucky`;
  res.locals.seo.description = product.seo_desc || product.short_desc || truncate(product.description, 160);
  res.locals.seo.type = 'product';
  if (product.image_id) res.locals.seo.image = `${res.locals.siteUrl}/media/${product.image_id}`;
  res.locals.jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.short_desc || truncate(product.description, 300),
    image: gallery.map((id) => `${res.locals.siteUrl}/media/${id}`),
    sku: `LN-${product.id}`,
    brand: { '@type': 'Brand', name: 'Lunar Lucky' },
    category: category ? category.name : undefined,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'VND',
      price: product.price,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  });
  const crumbs = [['Bộ sưu tập', '/bo-suu-tap']];
  if (category) crumbs.push([category.name, `/bo-suu-tap/${category.slug}`]);
  crumbs.push([product.name, `/san-pham/${product.slug}`]);
  res.locals.jsonLd.push(breadcrumb(res, crumbs));

  res.render('shop/product', {
    product, category, related, gallery,
    reviews: await testimonials.listActive({ productId: product.id, limit: 4 }),
    contents: lines(product.contents),
    descriptionHtml: md(product.description),
  });
});

router.get('/tim-kiem', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  let products = [];
  if (q) {
    // Dùng "!" làm ký tự escape để câu LIKE chạy giống nhau trên MySQL và SQLite
    const like = `%${q.replace(/[%_!]/g, (c) => '!' + c)}%`;
    const cond = (col) => [`${col} LIKE ? ESCAPE '!'`, [like]];
    products = await activeProducts()
      .andWhere((w) => w.whereRaw(...cond('name')).orWhereRaw(...cond('short_desc')).orWhereRaw(...cond('contents')))
      .orderBy('sold', 'desc')
      .limit(24);
  }
  res.locals.seo.title = q ? `Tìm “${q}” · Lunar Lucky` : 'Tìm kiếm · Lunar Lucky';
  res.locals.seo.noindex = true;
  res.render('shop/search', { q, products });
});

function breadcrumb(res, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Trang chủ', '/'], ...items].map(([name, p], i) => ({
      '@type': 'ListItem', position: i + 1, name, item: res.locals.siteUrl + p,
    })),
  };
}

module.exports = router;
module.exports.breadcrumb = breadcrumb;
