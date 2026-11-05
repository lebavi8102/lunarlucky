/**
 * API cho tool đồng bộ Excel trên máy chủ shop (đặt trước session/CSRF vì tool gọi trực tiếp, không đăng nhập).
 *   GET  /api/dong-bo-san-pham/excel   → tải file Excel sản phẩm đang có trên web
 *   POST /api/dong-bo-san-pham          → gửi file Excel (field "excel") + ảnh (field "images"), ?final=1 ở lượt gửi ảnh
 * Bảo vệ bằng mã bí mật PRODUCT_SYNC_TOKEN (biến môi trường trên Render). Chưa đặt mã → API tắt.
 */
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sync = require('../lib/product-sync');
const { limiterKey } = require('../lib/client-ip');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 60 },
});

const limiter = rateLimit({ ...limiterKey, windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function authorized(req) {
  const want = String(process.env.PRODUCT_SYNC_TOKEN || '').trim();
  const got = String(req.get('x-sync-token') || '').trim();
  if (want.length < 24 || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

function guard(req, res, next) {
  if (!String(process.env.PRODUCT_SYNC_TOKEN || '').trim()) return res.status(503).json({ ok: false, error: 'Web chưa bật đồng bộ Excel (thiếu PRODUCT_SYNC_TOKEN trên Render).' });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Sai mã đồng bộ.' });
  next();
}

router.get('/api/dong-bo-san-pham/excel', limiter, guard, async (req, res, next) => {
  try {
    const buf = await sync.exportExcel();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="LunarLucky_SanPham.xlsx"',
      'Cache-Control': 'no-store',
    }).send(buf);
  } catch (err) {
    next(err);
  }
});

router.post('/api/dong-bo-san-pham', limiter, guard, upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'images', maxCount: 59 }]), async (req, res) => {
  const excel = req.files && req.files.excel && req.files.excel[0];
  if (!excel) return res.status(400).json({ ok: false, error: 'Thiếu file Excel.' });
  // tool gửi tên file ảnh dạng mã hóa URL (chỉ ký tự ASCII) để giữ đúng tên tiếng Việt
  const images = ((req.files && req.files.images) || []).map((f) => {
    let name = f.originalname;
    try { name = decodeURIComponent(name); } catch { /* giữ nguyên */ }
    return { ...f, originalname: name };
  });
  try {
    const r = await sync.syncFromExcel(excel.buffer, images, { final: req.query.final === '1' });
    if (r.applied) console.log(`[dong-bo-excel] thêm ${r.created.length}, sửa ${r.updated.length}, giữ ${r.unchanged}, lỗi ${r.errors.length}`);
    res.json(r);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[dong-bo-excel] lỗi:', err);
    res.status(status).json({ ok: false, error: status < 500 ? err.message : 'Lỗi máy chủ khi đồng bộ, thử lại sau.' });
  }
});

module.exports = router;
