const express = require('express');

const router = express.Router();

const PAGES = {
  'gioi-thieu': {
    view: 'about',
    title: 'Câu chuyện Lunar Lucky',
    description: 'Lunar Lucky làm việc trực tiếp với các xưởng sản xuất, tuyển chọn kỹ lưỡng từng sản phẩm và đóng hộp sơn mài thủ công để mỗi giỏ quà Tết là một lời chúc trọn vẹn.',
  },
  'lien-he': { view: 'contact', title: 'Liên hệ', description: 'Liên hệ Lunar Lucky qua hotline, Zalo, Messenger hoặc email để được tư vấn giỏ quà Tết.' },
  'cau-hoi-thuong-gap': { view: 'faq', title: 'Câu hỏi thường gặp', description: 'Giải đáp về đặt hàng, giao hàng, thanh toán và đổi trả giỏ quà Tết tại Lunar Lucky.' },
  'chinh-sach-giao-hang': { view: 'policy-shipping', title: 'Chính sách giao hàng', description: 'Phí giao hàng đồng giá 50.000₫, miễn phí cho đơn từ 1.500.000₫. Giao đúng ngày tại nội thành Hà Nội, toàn quốc 2–4 ngày. Kiểm tra hàng khi nhận.' },
  'chinh-sach-doi-tra': { view: 'policy-returns', title: 'Chính sách đổi trả', description: 'Đổi mới hoặc hoàn tiền khi giỏ quà vỡ, móp, sai mẫu hoặc thiếu món. Báo trong 24 giờ kèm video mở hàng, Lunar Lucky phản hồi trong ngày.' },
  'chinh-sach-bao-mat': { view: 'policy-privacy', title: 'Chính sách bảo mật', description: 'Cách Lunar Lucky thu thập, sử dụng và bảo vệ thông tin cá nhân của khách hàng khi đặt giỏ quà Tết. Không bán hay chia sẻ dữ liệu cho bên thứ ba.' },
  'dieu-khoan': { view: 'policy-terms', title: 'Điều khoản sử dụng', description: 'Điều khoản đặt hàng, thanh toán chuyển khoản VietQR hoặc COD, hóa đơn VAT và giao nhận giỏ quà Tết tại Lunar Lucky.' },
};

router.get('/:page', (req, res, next) => {
  const p = PAGES[req.params.page];
  if (!p) return next();
  res.locals.seo.title = `${p.title} · Lunar Lucky`;
  res.locals.seo.description = p.description;
  if (p.view === 'faq') {
    res.locals.jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: require('../lib/faq')(res.locals.s).map((f) => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  res.render(`pages/${p.view}`, { page: p, faqs: require('../lib/faq')(res.locals.s) });
});

module.exports = router;
module.exports.PAGES = PAGES;
