/**
 * SITE_URL là tên miền chính (lunarlucky.vn). Khi tên miền chưa hoạt động (đang chờ duyệt, lỗi DNS…)
 * mà vẫn dùng nó cho ảnh xem trước Zalo/Facebook, link trong email, sitemap → khách bấm vào bị lỗi.
 * → Kiểm tra định kỳ: tên miền chính mở được thì dùng, chưa được thì tạm dùng địa chỉ đang chạy (Render).
 */
const config = require('../config');

const primary = config.siteUrl;
let timer = null;

async function check() {
  if (!/^https:\/\//.test(primary) || primary === config.publicUrl) return;
  let ok = false;
  try {
    const r = await fetch(`${primary}/healthz`, { signal: AbortSignal.timeout(6000), redirect: 'manual' });
    ok = r.status === 200;
  } catch {
    ok = false;
  }
  const next = ok ? primary : config.publicUrl;
  if (config.siteUrl !== next) {
    config.siteUrl = next;
    console.log(`[site] dùng địa chỉ ${next}${ok ? '' : ` (tên miền ${primary} chưa truy cập được)`}`);
  }
}

function start() {
  if (timer || config.env !== 'production') return;
  check();
  timer = setInterval(check, 10 * 60000);
  timer.unref();
}

module.exports = { start, check, primary };
