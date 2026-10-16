const db = require('../db');

/**
 * Cài đặt cửa hàng — chủ shop chỉnh trong /admin/cai-dat.
 * Giá trị mặc định dùng khi chưa có trong DB.
 */
const DEFAULTS = {
  shop_name: 'Lunar Lucky',
  telegram_chat_id: '',
  telegram_seen_chats: '',
  low_stock_threshold: '5',
  telegram_order_thread: '',
  telegram_stock_thread: '',
  telegram_photo_thread: '',
  telegram_ops_thread: '',
  telegram_ship_thread: '',
  telegram_money_thread: '',
  telegram_consult_thread: '',
  shop_tagline: 'Luxury Gifts & Hampers',
  shop_phone: '096 900 09 10',
  shop_email: 'lunarlucky.cskh@gmail.com',
  shop_hours: '8:00 – 21:00, tất cả các ngày',
  fanpage_url: 'https://www.facebook.com/Lunarlucky.vn',
  messenger_url: 'https://m.me/Lunarlucky.vn',
  zalo_url: 'https://zalo.me/0969000910',
  bank_id: 'VCB',
  bank_name: 'Vietcombank',
  bank_account: '0000000000',
  bank_holder: 'CONG TY LUNAR LUCKY',
  company_name: '',
  company_bank_id: '',
  company_bank_name: '',
  company_bank_account: '',
  company_bank_holder: '',
  vat_fee_percent: '11',
  payment_hold_hours: '24',
  cod_deposit_percent: '30',
  cod_deposit_min_total: '1000000',
  cod_deposit_min_qty: '2',
  cod_deposit_bulk_qty: '5',
  cod_deposit_bulk_percent: '50',
  shipping_fee: '50000',
  free_ship_threshold: '1500000',
  min_delivery_days: '1',
  province_min_days: '3',
  // Đơn nhiều giỏ cần thời gian chuẩn bị
  bulk_min_qty: '5',
  bulk_min_days: '2',
  bulk_max_days: '3',
  bulk2_min_qty: '21',
  bulk2_min_days: '5',
  bulk2_max_days: '10',
  bulk3_min_qty: '100',
  // Ngày giao cuối cùng trước Tết (YYYY-MM-DD) + cách gọi theo âm lịch; để trống thì không hiện
  order_deadline: '2027-02-05',
  order_deadline_label: '29 tháng Chạp',
  // Nghỉ Tết: không nhận giao trong khoảng này (YYYY-MM-DD)
  tet_closed_from: '2027-02-06',
  tet_closed_to: '2027-02-10',
  telegram_admin_only: '1',
  ops_digest: '1',
  // AI tư vấn bán hàng (cần ANTHROPIC_API_KEY trên Render)
  ai_chat_enabled: '1',
  messenger_ai_enabled: '1',
  messenger_pause_hours: '12',
  ai_model: 'claude-opus-5-5',
  ai_daily_limit: '500',
  backup_email: '1',
  backup_last: '',
  ops_morning_hour: '7',
  ops_evening_hour: '21',
  ops_morning_last: '',
  ops_evening_last: '',
  announcement: 'Miễn phí giao hàng cho đơn từ 1.500.000₫ · Đặt trước Tết để chọn ngày giao',
  hero_eyebrow: 'Quà Tết an khang, trao trọn phú quý',
  hero_title: 'Trao lời chúc trọn vẹn trong từng giỏ quà',
  hero_subtitle:
    'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Thiệp viết tay, giao đúng ngày bạn hẹn.',
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
