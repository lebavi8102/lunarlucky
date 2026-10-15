/**
 * IP thật của khách. Web chạy sau Cloudflare → Render: req.ip có thể là IP của Cloudflare (nhiều khách chung 1 IP),
 * làm giới hạn chống spam chặn nhầm khách thật lúc cao điểm. Cloudflare luôn ghi đè header CF-Connecting-IP bằng IP thật.
 */
let logged = false;
function clientIp(req) {
  const ip = req.get('cf-connecting-ip') || req.get('true-client-ip') || req.ip || '';
  if (!logged && process.env.NODE_ENV === 'production') {
    logged = true;
    console.log(`[ip] req.ip=${req.ip} · cf-connecting-ip=${req.get('cf-connecting-ip') ? 'có' : 'không'} → dùng ${req.get('cf-connecting-ip') ? 'cf-connecting-ip' : 'req.ip'}`);
  }
  return ip;
}

/** Tùy chọn chung cho express-rate-limit: đếm theo IP thật của khách. */
// IPv6: gom theo dải mạng (một máy có thể đổi nhiều địa chỉ) — dùng hàm chuẩn của express-rate-limit
const { ipKeyGenerator } = require('express-rate-limit');
const limiterKey = { keyGenerator: (req) => ipKeyGenerator(clientIp(req)) };

module.exports = { clientIp, limiterKey };
