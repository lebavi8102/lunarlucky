/**
 * Xem trước email gửi khách + tin Telegram với dữ liệu mẫu (không gửi gì đi).
 * Chạy: node scripts/preview-messages.js   → in ra chữ thuần để soát câu chữ.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const ejs = require('ejs');
const settings = require('../src/lib/settings');
const payment = require('../src/lib/payment');
const { money, ymd, todayVN } = require('../src/lib/format');
const db = require('../src/db');

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

(async () => {
  const s = await settings.all();
  const items = [{ name: 'Giỏ An Khang', qty: 10, line_total: 18900000 }];
  const base = {
    id: 1, code: 'LN261015MAU1', customer_name: 'Chị Mai', phone: '0912345678', email: 'mai@example.test', address: '12 Láng Hạ', province: 'Hà Nội',
    delivery_date: todayVN(3), delivery_slot: 'sang', subtotal: 18900000, discount: 0, shipping_fee: 0, vat_fee: 0, total: 18900000,
    status: 'new', payment_status: 'pending', deposit_amount: 0, is_gift: false, created_at: new Date(),
  };
  const cod10 = { ...base, payment_method: 'cod', deposit_amount: payment.depositFor({ goods: 18900000, qty: 10, total: 18900000 }, s) };
  const gift = { ...base, code: 'LN261015MAU2', payment_method: 'bank', is_gift: true, recipient_name: 'Bác Ba', recipient_phone: '0987654321', recipient_address: '5 Hàng Bông', total: 1890000, subtotal: 1890000 };
  const render = (tpl, data) => ejs.renderFile(path.join(__dirname, '../views/emails', `${tpl}.ejs`), { ...data, money, ymd, siteUrl: 'https://lunarlucky.vn' });
  const qr = 'https://img.vietqr.io/x.png';
  const payee = payment.accountForOrder(base, s);
  const show = async (title, tpl, data) => console.log(`\n===== EMAIL: ${title}\n${text(await render(tpl, data))}`);

  await show('Xác nhận đơn COD 10 giỏ (cọc 50%)', 'order-confirmation', { order: cod10, items, s, qr, payee });
  await show('Xác nhận đơn gửi tặng (chuyển khoản)', 'order-confirmation', { order: gift, items: [{ name: 'Giỏ An Khang', qty: 1, line_total: 1890000 }], s, qr, payee });
  await show('Nhắc cọc (COD 10 giỏ)', 'order-confirmation', { order: cod10, items, s, qr, payee, reminder: { until: '14:30 16/10' } });
  for (const st of ['confirmed', 'shipping', 'completed']) {
    await show(`Trạng thái: ${st} (đơn tặng)`, 'order-status', { order: { ...gift, status: st }, statusLabel: st, s });
  }
  await show('Tự hủy vì chưa cọc', 'order-status', { order: { ...cod10, status: 'cancelled' }, statusLabel: 'Đã hủy', s, expired: true });
  await show('Hủy khi đã cọc', 'order-status', { order: { ...cod10, status: 'cancelled', payment_status: 'deposit' }, statusLabel: 'Đã hủy', s });

  const tg = require('../src/lib/telegram-orders');
  const plain = (h) => h.replace(/<[^>]+>/g, '');
  console.log('\n===== TELEGRAM: đơn COD 10 giỏ chờ cọc\n' + plain(tg.messageText(cod10, items)));
  console.log('\n===== TELEGRAM: đã nhận cọc 50%\n' + plain(tg.messageText({ ...cod10, payment_status: 'deposit', status: 'confirmed' }, items)));
  await db.destroy();
})();
