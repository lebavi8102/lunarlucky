function requireUser(req, res, next) {
  if (req.session.user) return next();
  res.redirect(`/dang-nhap?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  if (req.session.user) {
    const err = new Error('Bạn không có quyền truy cập trang quản trị.');
    err.status = 403;
    return next(err);
  }
  res.redirect(`/dang-nhap?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Chỉ chấp nhận đường dẫn nội bộ để tránh open redirect. */
function safeNext(next, fallback = '/') {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    return next;
  }
  return fallback;
}

module.exports = { requireUser, requireAdmin, safeNext };
