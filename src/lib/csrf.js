const crypto = require('crypto');

/**
 * CSRF dạng synchronizer token lưu trong session.
 * Form thường gửi field `_csrf`; form multipart gửi qua query `?_csrf=`;
 * fetch() gửi header `x-csrf-token`.
 */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function csrfProtection(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // multipart: multer chưa chạy nên body rỗng — chỉ kiểm tra query/header
  const sent =
    (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  const ok =
    typeof sent === 'string' &&
    sent.length === req.session.csrf.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
  if (ok) return next();
  // Đặt hàng: không tạo đơn, nhưng hiện lại form với thông tin khách đã điền để bấm lại (không mất đơn)
  if (req.method === 'POST' && req.path === '/thanh-toan') {
    req.csrfFailed = true;
    return next();
  }
  const err = new Error('Phiên làm việc đã hết hạn. Vui lòng tải lại trang và thử lại.');
  err.status = 403;
  next(err);
}

module.exports = { csrfProtection, csrfToken };
