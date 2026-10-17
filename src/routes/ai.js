const express = require('express');
const rateLimit = require('express-rate-limit');
const { limiterKey } = require('../lib/client-ip');
const ai = require('../lib/ai-sales');

const router = express.Router();
// Chống spam: mỗi khách tối đa 20 tin / 5 phút
const chatLimiter = rateLimit({ ...limiterKey,
  windowMs: 5 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ reply: 'Anh/chị nhắn hơi nhanh, đợi em vài phút hoặc nhắn Zalo giúp em nhé!' }),
});

router.post('/tu-van/chat', chatLimiter, async (req, res) => {
  const text = String((req.body && req.body.message) || '').trim();
  if (!text) return res.status(400).json({ reply: 'Anh/chị nhập câu hỏi giúp em nhé.' });
  // Chế độ thử (header x-lunar-test): giả lập kênh Fanpage + tên Facebook để kiểm thử kịch bản; không tạo yêu cầu gọi lại thật
  const test = req.get('x-lunar-test') === '1';
  let fbName = '';
  try { fbName = decodeURIComponent(String(req.get('x-lunar-name') || '')).slice(0, 80); } catch { fbName = ''; }
  const opts = test && req.get('x-lunar-channel') === 'messenger' ? { channel: 'messenger', customerName: fbName } : {};
  const r = await ai.chat(req, text, opts);
  const learn = require('../lib/ai-learn');
  const id = `web:${String(req.sessionID || '').slice(0, 40)}`;
  // Lượt chat thử của chủ shop / kiểm thử (header x-lunar-test) không tính vào số liệu tỉ lệ chốt
  if (!r.off && !r.error && req.get('x-lunar-test') !== '1') {
    await learn.log(id, 'customer', text);
    await learn.log(id, 'ai', r.reply);
    if (r.action) await learn.log(id, 'event', 'order_button');
    if (r.callback) await learn.log(id, 'event', 'human');
  }
  if (!test) { delete r.tools; delete r.usage; delete r.debug; }
  res.set('Cache-Control', 'no-store').json(r);
});

// Link "Kiểm tra & đặt hàng" AI gửi qua Messenger → bỏ giỏ + điền sẵn thông tin vào phiên trên web
router.get('/tu-van/don/:token', async (req, res) => {
  const h = await require('../lib/messenger').loadHandoff(req.params.token);
  if (!h || !h.cart) {
    req.session.flash = { type: 'error', message: 'Link đặt hàng đã hết hạn. Anh/chị nhắn lại Fanpage để em gửi link mới nhé!' };
    return res.redirect('/gio-hang');
  }
  req.session.cart = h.cart;
  req.session.aiPrefill = h.prefill;
  res.redirect('/thanh-toan?tu-van=1');
});

router.post('/tu-van/moi', (req, res) => {
  delete req.session.aiChat;
  res.json({ ok: true });
});

module.exports = router;
