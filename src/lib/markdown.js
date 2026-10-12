const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ gfm: true, breaks: true });

/** Markdown → HTML an toàn (dùng cho mô tả sản phẩm, bài blog). */
function render(md) {
  const html = marked.parse(String(md || ''));
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'figure', 'figcaption']),
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
    },
  });
}

/** Ước lượng thời gian đọc (phút). */
function readingTime(md) {
  const words = String(md || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

module.exports = { render, readingTime };
