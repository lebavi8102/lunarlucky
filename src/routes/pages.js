const express = require('express');

const router = express.Router();

const PAGES = {
  'gioi-thieu': {
    view: 'about',
    title: 'Câu chuyện Lunar',
    description: 'Lunar tuyển chọn đặc sản ba miền, đóng hộp sơn mài thủ công để mỗi giỏ quà Tết là một lời chúc trọn vẹn.',
  },
  'lien-he': { view: 'contact', title: 'Liên hệ', description: 'Liên hệ Lunar qua hotline, Zalo, Messenger hoặc email để được tư vấn giỏ quà Tết.' },
  'cau-hoi-thuong-gap': { view: 'faq', title: 'Câu hỏi thường gặp', description: 'Giải đáp về đặt hàng, giao hàng, thanh toán và đổi trả giỏ quà Tết tại Lunar.' },
  'chinh-sach-giao-hang': { view: 'policy-shipping', title: 'Chính sách giao hàng', description: 'Thời gian, phạm vi và phí giao hàng giỏ quà Tết Lunar.' },
  'chinh-sach-doi-tra': { view: 'policy-returns', title: 'Chính sách đổi trả', description: 'Điều kiện đổi trả và hoàn tiền tại Lunar.' },
  'chinh-sach-bao-mat': { view: 'policy-privacy', title: 'Chính sách bảo mật', description: 'Cách Lunar thu thập và bảo vệ thông tin cá nhân của khách hàng.' },
  'dieu-khoan': { view: 'policy-terms', title: 'Điều khoản sử dụng', description: 'Điều khoản khi mua sắm tại website Lunar.' },
};

router.get('/:page', (req, res, next) => {
  const p = PAGES[req.params.page];
  if (!p) return next();
  res.locals.seo.title = `${p.title} · Lunar`;
  res.locals.seo.description = p.description;
  if (p.view === 'faq') {
    res.locals.jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: require('../lib/faq').map((f) => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  res.render(`pages/${p.view}`, { page: p, faqs: require('../lib/faq') });
});

module.exports = router;
module.exports.PAGES = PAGES;
