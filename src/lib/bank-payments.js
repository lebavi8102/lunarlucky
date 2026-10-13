/**
 * Tự xác nhận chuyển khoản qua SePay.
 * - SePay báo mỗi giao dịch tiền vào tài khoản → tìm mã đơn trong nội dung → đủ tiền thì đánh dấu "Đã thanh toán".
 * - Đơn chuyển khoản chỉ được báo vào nhóm Telegram khi đã nhận tiền (đơn COD báo ngay như cũ).
 * - Đơn chuyển khoản quá hạn chưa trả tiền → tự hủy, trả lại tồn kho.
 */
const config = require('../config');
const db = require('../db');
const notify = require('./notify');
const settings = require('./settings');
const { updateOrder } = require('./orders');

const CODE_RE = /LN\d{6}[A-Z2-9]{4}/;

function enabled() {
  return !!config.sepay.apiKey;
}

/** SePay gửi header "Authorization: Apikey <khóa>". */
function authorized(req) {
  const h = String(req.get('authorization') || '').trim();
  const m = h.match(/^apikey\s+(.+)$/i);
  if (!enabled() || !m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(config.sepay.apiKey);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

function findCode(text) {
  const m = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').match(CODE_RE);
  if (m) return m[0];
  // Một số ngân hàng dồn liền chữ: thử lại khi bỏ hết khoảng trắng
  const m2 = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(CODE_RE);
  return m2 ? m2[0] : null;
}

const money = (n) => notify.escapeTg(require('./format').money(n));

/** Xử lý một giao dịch từ SePay. Trả về kết quả để ghi log / kiểm thử. */
async function handleSepay(tx) {
  if (!tx || String(tx.transferType || '').toLowerCase() !== 'in') return { result: 'ignored' };
  const id = `sepay:${tx.id}`;
  const amount = Math.round(Number(tx.transferAmount) || 0);
  const content = String(tx.content || tx.description || '').slice(0, 500);

  // Chống trùng: SePay có thể gửi lại cùng giao dịch
  if (await db('bank_transactions').where({ id }).first()) return { result: 'duplicate' };
  const record = { id, provider: 'sepay', amount, content, reference: String(tx.referenceCode || '').slice(0, 100) || null };
  try {
    await db('bank_transactions').insert(record);
  } catch (err) {
    if (/unique|duplicate/i.test(err.message)) return { result: 'duplicate' };
    throw err;
  }
  const save = (result, orderId = null) => db('bank_transactions').where({ id }).update({ result, order_id: orderId });

  const code = findCode(content) || findCode(tx.code);
  if (!code) {
    await save('no_code');
    return { result: 'no_code' };
  }
  const order = await db('orders').where({ code }).first();
  if (!order) {
    await save('unknown_order');
    await notify.telegram(`💸 Tiền vào <b>${money(amount)}</b> có mã <b>${code}</b> nhưng không tìm thấy đơn.\nNội dung: ${notify.escapeTg(content)}`);
    return { result: 'unknown_order' };
  }
  if (order.payment_status === 'paid') {
    await save('already_paid', order.id);
    await notify.telegram(`💸 Đơn <b>${code}</b> đã thanh toán trước đó, nay nhận thêm <b>${money(amount)}</b> — kiểm tra khách chuyển trùng.`);
    return { result: 'already_paid' };
  }
  if (amount < Number(order.total)) {
    await save('underpaid', order.id);
    await notify.telegram(
      `⚠️ Đơn <b>${code}</b> chuyển thiếu: nhận <b>${money(amount)}</b> / cần ${money(order.total)} (thiếu ${money(order.total - amount)}).\nLiên hệ khách: ${notify.escapeTg(order.customer_name)} · ${notify.escapeTg(order.phone)}`,
    );
    return { result: 'underpaid' };
  }

  // Đơn đã tự hủy vì quá hạn mà khách vẫn chuyển → khôi phục đơn
  const changes = { payment_status: 'paid' };
  if (order.status === 'cancelled') changes.status = 'new';
  await updateOrder(order.id, changes, { by: `SePay tự động (${require('./format').money(amount)})` });
  await save(order.status === 'cancelled' ? 'paid_restored' : 'paid', order.id);
  if (amount > Number(order.total)) {
    await notify.telegram(`ℹ️ Đơn <b>${code}</b> khách chuyển dư ${money(amount - order.total)}.`);
  }
  return { result: 'paid', orderId: order.id };
}

/** Sau khi đơn chuyển sang "Đã thanh toán": đơn chưa báo nhóm thì báo (ĐƠN MỚI), đã báo thì cập nhật tin. */
async function afterPaid(orderId) {
  const tg = require('./telegram-orders');
  const order = await db('orders').where({ id: orderId }).first();
  if (!order) return;
  if (!order.tg_message_id) {
    const items = await db('order_items').where({ order_id: order.id });
    await tg.sendNewOrder(order, items);
  } else {
    await tg.refreshOrderMessage(order.id);
  }
}

function holdHours(s) {
  const n = Number(String(s.payment_hold_hours ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/** Hủy các đơn chuyển khoản quá hạn chưa thanh toán (chỉ khi bật tự xác nhận). */
async function expireUnpaid() {
  if (!enabled()) return 0;
  const hours = holdHours(await settings.all());
  const before = new Date(Date.now() - hours * 3600000);
  const rows = await db('orders')
    .where({ payment_method: 'bank', payment_status: 'pending', status: 'new' })
    .whereNull('tg_message_id')
    .andWhere('created_at', '<', before)
    .select('id');
  for (const r of rows) {
    await updateOrder(r.id, { status: 'cancelled' }, { by: `Tự hủy: quá ${hours} giờ chưa thanh toán` });
  }
  return rows.length;
}

/**
 * (chạy mỗi phút) Gửi bù tin "ĐƠN MỚI" cho đơn cần báo nhóm (COD, hoặc đã thanh toán) mà lần trước gửi Telegram lỗi.
 * Chỉ xét đơn trong 6 giờ gần nhất để không gửi lại đơn cũ / đơn thử.
 */
async function resendMissed() {
  if (!config.telegram.token) return 0;
  const since = new Date(Date.now() - 6 * 3600000);
  const rows = await db('orders')
    .whereNull('tg_message_id')
    .whereNot('status', 'cancelled')
    .andWhere('created_at', '>', since)
    .andWhere((w) => {
      w.where('payment_method', 'cod').orWhere('payment_status', 'paid');
      if (!enabled()) w.orWhere('payment_method', 'bank'); // chưa bật SePay: đơn CK cũng báo ngay
    });
  const tg = require('./telegram-orders');
  let n = 0;
  for (const o of rows) {
    const items = await db('order_items').where({ order_id: o.id });
    await tg.sendNewOrder(o, items);
    if ((await db('orders').where({ id: o.id }).first()).tg_message_id) n++;
  }
  if (n) console.log(`[telegram] đã gửi bù ${n} đơn`);
  return n;
}

function startExpiryTimer() {
  const run = async () => {
    await resendMissed().catch((err) => console.error('[telegram] gửi bù lỗi:', err.message));
    if (enabled()) await expireUnpaid().catch((err) => console.error('[thanh toán] tự hủy đơn lỗi:', err.message));
  };
  setTimeout(run, 30000).unref();
  setInterval(run, 60000).unref();
}

module.exports = { resendMissed, enabled, authorized, findCode, handleSepay, afterPaid, expireUnpaid, startExpiryTimer, holdHours };
