const express = require('express');
const testimonials = require('../lib/testimonials');
const db = require('../db');
const { render: md } = require('../lib/markdown');
const { search } = require('../lib/search');
const { lines, parseJson, truncate, todayVN } = require('../lib/format');

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
  res.locals.seo.title = `Giỏ quà Tết cao cấp 2027 tại Hà Nội · Giao tận nơi | ${s.shop_name}`;
  res.locals.jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: s.shop_name,
    description: s.hero_subtitle,
    url: res.locals.siteUrl,
    telephone: s.shop_phone,
    email: s.shop_email,
    address: { '@type': 'PostalAddress', addressLocality: 'Hai Bà Trưng', addressRegion: 'Hà Nội', addressCountry: 'VN' },
    areaServed: [{ '@type': 'City', name: 'Hà Nội' }, { '@type': 'Country', name: 'Việt Nam' }],
    priceRange: '₫₫',
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
  // Chỉ hiện khoảng giá đang có sản phẩm (trong danh mục đang xem); khoảng đang chọn luôn giữ lại
  const prices = await (category ? activeProducts().andWhere({ category_id: category.id }) : activeProducts()).select('price');
  const ranges = Object.keys(PRICE_RANGES).filter((k) => k === range || prices.some((x) => x.price >= PRICE_RANGES[k][0] && (!PRICE_RANGES[k][1] || x.price <= PRICE_RANGES[k][1])));
  return { products, categories, ranges, sort, range, page, pages: Math.max(1, Math.ceil(Number(n) / perPage)), total: Number(n) };
}

router.get('/bo-suu-tap', async (req, res) => {
  const data = await listing(req, res, null);
  res.locals.seo.title = 'Giỏ quà Tết 2027 cao cấp · Tất cả mẫu giỏ quà | Lunar Lucky';
  res.locals.seo.description = 'Tất cả mẫu giỏ quà Tết 2027 của Lunar Lucky: biếu sếp, đối tác, gia đình, tặng nhân viên. Giao đúng ngày tại Hà Nội, toàn quốc 2–4 ngày, xuất hóa đơn VAT.';
  res.render('shop/collection', { ...data, category: null, sorts: Object.keys(SORTS) });
});

// Trang đích cho tìm kiếm "giỏ quà Tết Hà Nội" (SEO + quảng cáo tìm kiếm). Nội dung chỉ dùng số liệu thật từ Cài đặt.
router.get('/gio-qua-tet-ha-noi', async (req, res) => {
  const data = await listing(req, res, null);
  const s = res.locals.s;
  const { money } = require('../lib/format');
  const prices = await activeProducts().select('price');
  const min = prices.length ? Math.min(...prices.map((p) => Number(p.price))) : 0;
  const free = money(Number(s.free_ship_threshold) || 0);
  const fee = money(Number(s.shipping_fee) || 0);
  const allFaq = require('../lib/faq')(s);
  const faqs = [allFaq[0], allFaq[1], allFaq[4], allFaq[2], allFaq[6]].filter(Boolean);
  const landing = {
    path: '/gio-qua-tet-ha-noi',
    crumb: 'Giỏ quà Tết Hà Nội',
    h1: 'Giỏ quà Tết Hà Nội cao cấp 2027',
    lead: `Giỏ quà Tết cao cấp giao tận nơi trong nội thành Hà Nội, đúng ngày và đúng buổi bạn chọn.${min ? ` Giá từ ${money(min)}.` : ''} Miễn phí giao cho đơn từ ${free}.`,
    blocks: [
      {
        h: 'Đặt giỏ quà Tết ở Hà Nội tại Lunar Lucky',
        p: [
          'Lunar Lucky chuẩn bị giỏ quà Tết tại Hà Nội (Hai Bà Trưng) và giao tận tay người nhận ở các quận nội thành. Bạn chọn ngày giao và buổi giao: sáng (8h–12h), chiều (13h–17h) hoặc tối (18h–20h); shipper gọi trước khi giao.',
          'Mỗi giỏ được tuyển chọn và đóng gói thủ công, phù hợp để biếu sếp, đối tác, khách hàng, gia đình hay tặng nhân viên dịp Tết Nguyên đán 2027.',
        ],
      },
      {
        h: 'Giao hàng và thanh toán',
        p: [
          `Phí giao đồng giá ${fee} mỗi đơn, miễn phí cho đơn từ ${free}. Đơn lẻ trong Hà Nội giao được từ ngày hôm sau; các tỉnh khác giao trong 2–4 ngày.`,
          'Thanh toán chuyển khoản qua mã VietQR (hệ thống tự xác nhận khi tiền về) hoặc thanh toán khi nhận hàng (COD) có đặt cọc. Muốn gửi tặng thẳng tới người nhận, bạn chọn "Gửi tặng người khác" khi đặt hàng.',
        ],
      },
      {
        h: 'Quà Tết doanh nghiệp tại Hà Nội',
        p: [
          'Doanh nghiệp đặt từ 5 giỏ được tư vấn ngân sách, báo giá riêng theo số lượng, in logo và xuất hóa đơn VAT, giao hàng loạt theo danh sách người nhận.',
          `Cần tư vấn nhanh, gọi hoặc nhắn Zalo ${s.shop_phone || ''} từ 8:00 đến 21:00 hằng ngày.`,
        ],
      },
    ],
    faqs,
  };
  res.locals.seo.title = 'Giỏ quà Tết Hà Nội cao cấp 2027 · Giao tận nơi | Lunar Lucky';
  res.locals.seo.description = truncate(`Giỏ quà Tết Hà Nội cao cấp${min ? ` giá từ ${money(min)}` : ''}: biếu sếp, đối tác, gia đình. Giao đúng ngày, đúng buổi trong nội thành, miễn phí giao từ ${free}. Xuất VAT, in logo.`, 160);
  res.locals.jsonLd.push(breadcrumb(res, [['Giỏ quà Tết Hà Nội', '/gio-qua-tet-ha-noi']]));
  res.locals.jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  });
  res.render('shop/collection', { ...data, category: null, landing, sorts: Object.keys(SORTS) });
});

router.get('/bo-suu-tap/:slug', async (req, res, next) => {
  const category = await db('categories').where({ slug: req.params.slug, is_active: true }).first();
  if (!category) return next();
  const data = await listing(req, res, category);
  res.locals.seo.title = `${category.name} · Giỏ quà Tết 2027 | Lunar Lucky`;
  res.locals.seo.description = truncate(`${category.name}: ${category.tagline || category.description || 'giỏ quà Tết tuyển chọn'}. Giỏ quà Tết Lunar Lucky đóng hộp sơn mài, giao toàn quốc, miễn phí giao từ 1.500.000₫.`, 160);
  if (category.image_id) res.locals.seo.image = `${res.locals.siteUrl}/media/${category.image_id}`;
  res.locals.jsonLd.push(breadcrumb(res, [['Bộ sưu tập', '/bo-suu-tap'], [category.name, `/bo-suu-tap/${category.slug}`]]));
  const sent = category.slug === 'qua-doanh-nghiep' && req.query['da-gui'] === '1';
  if (sent) res.locals.track.events.push({ name: 'generate_lead', value: 0 }); // gửi yêu cầu báo giá từ trang bộ sưu tập DN
  res.render('shop/collection', { ...data, category, sent, sorts: Object.keys(SORTS) });
});

router.get('/san-pham/:slug', async (req, res, next) => {
  const product = await activeProducts().andWhere({ slug: req.params.slug }).first();
  if (!product) return next();
  const [category, related] = await Promise.all([
    product.category_id ? db('categories').where({ id: product.category_id }).first() : null,
    activeProducts()
      .andWhere('id', '!=', product.id)
      .modify((q) => product.category_id && q.andWhere({ category_id: product.category_id }))
      .orderBy('sold', 'desc')
      .limit(4),
  ]);
  const gallery = [product.image_id, ...parseJson(product.gallery, [])].filter(Boolean);
  const url = `${res.locals.siteUrl}/san-pham/${product.slug}`;

  res.locals.seo.title = product.seo_title || `${product.name} · Giỏ quà Tết cao cấp | Lunar Lucky`;
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

  res.locals.track.events.push({ name: 'view_item', value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 }] });
  res.render('shop/product', {
    product, category, related, gallery,
    reviews: await testimonials.listActive({ productId: product.id, limit: 6, textOk: true }),
    earliest: todayVN(Number(res.locals.s.min_delivery_days) || 1),
    contents: lines(product.contents),
    descriptionHtml: md(product.description),
    depositText: require('../lib/payment').depositText(res.locals.s),
  });
});

router.get('/tim-kiem', async (req, res) => {
  const q = String(req.query.q || '').normalize('NFC').trim().slice(0, 80);
  let products = [];
  if (q) {
    // Khách hay gõ không dấu / kèm giá ("gio tet duoi 1tr") → tìm mềm trong bộ nhớ
    const [all, cats] = await Promise.all([activeProducts(), db('categories').select('id', 'name')]);
    products = search(all, q, cats).slice(0, 24);
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
