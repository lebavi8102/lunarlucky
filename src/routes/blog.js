const express = require('express');
const db = require('../db');
const { render: md, readingTime } = require('../lib/markdown');
const { toDate, truncate } = require('../lib/format');
const { breadcrumb } = require('./shop');

const router = express.Router();

router.get('/blog', async (req, res) => {
  const page = Math.max(1, Number(req.query.trang) || 1);
  const perPage = 9;
  const base = db('posts').where({ is_published: true });
  const [{ n }] = await base.clone().count({ n: '*' });
  const posts = await base.orderBy('published_at', 'desc').limit(perPage).offset((page - 1) * perPage);
  res.locals.seo.title = 'Cẩm nang quà Tết · Lunar';
  res.locals.seo.description = 'Ý nghĩa quà Tết, cách chọn giỏ quà biếu sếp, đối tác, gia đình và văn hóa tặng quà ngày xuân.';
  res.render('blog/index', { posts, page, pages: Math.max(1, Math.ceil(Number(n) / perPage)) });
});

router.get('/blog/:slug', async (req, res, next) => {
  const post = await db('posts').where({ slug: req.params.slug, is_published: true }).first();
  if (!post) return next();
  const more = await db('posts')
    .where({ is_published: true })
    .andWhere('id', '!=', post.id)
    .orderBy('published_at', 'desc')
    .limit(3);
  const products = await db('products').where({ is_active: true, is_featured: true }).orderBy('sold', 'desc').limit(3);
  const url = `${res.locals.siteUrl}/blog/${post.slug}`;
  res.locals.seo.title = post.seo_title || `${post.title} · Lunar`;
  res.locals.seo.description = post.seo_desc || post.excerpt || truncate(post.content, 160);
  res.locals.seo.type = 'article';
  if (post.cover_id) res.locals.seo.image = `${res.locals.siteUrl}/media/${post.cover_id}`;
  res.locals.jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: post.cover_id ? [`${res.locals.siteUrl}/media/${post.cover_id}`] : undefined,
    datePublished: toDate(post.published_at)?.toISOString(),
    dateModified: toDate(post.updated_at)?.toISOString(),
    author: { '@type': 'Organization', name: 'Lunar' },
    publisher: { '@type': 'Organization', name: 'Lunar', logo: { '@type': 'ImageObject', url: `${res.locals.siteUrl}/img/logo-mark.svg` } },
    mainEntityOfPage: url,
  });
  res.locals.jsonLd.push(breadcrumb(res, [['Cẩm nang', '/blog'], [post.title, `/blog/${post.slug}`]]));
  res.render('blog/post', { post, more, products, html: md(post.content), minutes: readingTime(post.content) });
});

module.exports = router;
