/**
 * API cho tool đồng bộ Excel trên máy chủ shop (đặt trước session/CSRF vì tool gọi trực tiếp, không đăng nhập).
 *   GET  /api/dong-bo-san-pham/excel   → tải file Excel sản phẩm đang có trên web
 *   POST /api/dong-bo-san-pham/ton-kho  → tồn kho hiện tại để tool ghi ngược vào Excel
 *   POST /api/dong-bo-san-pham          → gửi file Excel (field "excel") + ảnh (field "images"); ?check=1 chỉ hỏi, ?final=1 áp dụng
 * Bảo vệ bằng mã bí mật của tool (file cauhinh.txt trên máy chủ shop). Code chỉ giữ dạng băm SHA-256 của mã
 * (băm một chiều, xem code cũng không suy ra được mã). Có biến PRODUCT_SYNC_TOKEN trên Render thì dùng mã đó thay thế.
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

// SHA-256 của mã trong cauhinh.txt (tạo 05/11/2026). Đổi mã: đặt PRODUCT_SYNC_TOKEN trên Render hoặc thay dòng này.
const TOKEN_HASH = 'a47778a19c1396e5a518e64f8b43563d1e292bc4353f7856197960b76be220d5';

function wantHash() {
  const env = String(process.env.PRODUCT_SYNC_TOKEN || '').trim();
  if (env.length >= 24) return crypto.createHash('sha256').update(env).digest();
  return Buffer.from(TOKEN_HASH, 'hex');
}

function authorized(req) {
  const got = String(req.get('x-sync-token') || '').trim();
  if (got.length < 24) return false;
  return crypto.timingSafeEqual(wantHash(), crypto.createHash('sha256').update(got).digest());
}

function guard(req, res, next) {
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
    const r = await sync.syncFromExcel(excel.buffer, images, { final: req.query.final === '1', check: req.query.check === '1' });
    if (r.applied) console.log(`[dong-bo-excel] thêm ${r.created.length}, sửa ${r.updated.length}, giữ ${r.unchanged}, lỗi ${r.errors.length}`);
    res.json(r);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[dong-bo-excel] lỗi:', err);
    res.status(status).json({ ok: false, error: status < 500 ? err.message : 'Lỗi máy chủ khi đồng bộ, thử lại sau.' });
  }
});

// Tool gửi ảnh theo đợt nhỏ (vài ảnh/lần) trước lượt đồng bộ cuối — tránh một request 50 ảnh làm máy chủ hết RAM
const uploadBatch = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 6 } });
const batchLimiter = rateLimit({ ...limiterKey, windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
router.post('/api/dong-bo-san-pham/anh', batchLimiter, guard, uploadBatch.array('images', 6), async (req, res) => {
  const images = (req.files || []).map((f) => {
    let name = f.originalname;
    try { name = decodeURIComponent(name); } catch { /* giữ nguyên */ }
    return { ...f, originalname: name };
  });
  if (!images.length) return res.status(400).json({ ok: false, error: 'Thiếu ảnh.' });
  try {
    res.json(await sync.stageImages(images));
  } catch (err) {
    console.error('[dong-bo-excel] lỗi nhận ảnh:', err);
    res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi nhận ảnh, thử lại sau.' });
  }
});

// Tool hỏi tồn kho hiện tại (mỗi phút) để ghi ngược vào cột Tồn kho trong Excel của chủ shop
router.post('/api/dong-bo-san-pham/ton-kho', limiter, guard, async (req, res) => {
  try {
    res.json({ ok: true, stock: await sync.stockReport() });
  } catch (err) {
    console.error('[dong-bo-excel] lỗi đọc tồn kho:', err);
    res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi đọc tồn kho.' });
  }
});

module.exports = router;
