const db = require('../db');

/**
 * Cài đặt cửa hàng — chủ shop chỉnh trong /admin/cai-dat.
 * Giá trị mặc định dùng khi chưa có trong DB.
 */
const DEFAULTS = {
  shop_name: 'Lunar',
  shop_tagline: 'Giỏ quà Tết cao cấp',
  shop_phone: '0900 000 000',
  shop_email: 'hello@lunar.vn',
  shop_hours: '8:00 – 21:00, tất cả các ngày',
  fanpage_url: 'https://facebook.com/',
  messenger_url: 'https://m.me/',
  zalo_url: 'https://zalo.me/0900000000',
  bank_id: 'VCB',
  bank_name: 'Vietcombank',
  bank_account: '0000000000',
  bank_holder: 'CONG TY LUNAR',
  shipping_fee: '35000',
  free_ship_threshold: '1500000',
  min_delivery_days: '1',
  announcement: 'Miễn phí giao hàng nội thành cho đơn từ 1.500.000₫ · Đặt trước Tết để chọn ngày giao',
  hero_eyebrow: 'Bộ sưu tập Tết Đinh Mùi 2027',
  hero_title: 'Trao lời chúc trọn vẹn trong từng giỏ quà',
  hero_subtitle:
    'Giỏ quà Tết tuyển chọn thủ công từ đặc sản ba miền, đóng hộp sơn mài, kèm thiệp chúc viết tay và giao tận nơi đúng ngày bạn chọn.',
};

let cache = null;
let cacheAt = 0;

async function all() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const rows = await db('settings').select('key', 'value');
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  cache = out;
  cacheAt = Date.now();
  return out;
}

async function save(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULTS)) continue;
    const v = value == null ? '' : String(value);
    const exists = await db('settings').where({ key }).first();
    if (exists) await db('settings').where({ key }).update({ value: v });
    else await db('settings').insert({ key, value: v });
  }
  cache = null;
}

module.exports = { all, save, DEFAULTS };
