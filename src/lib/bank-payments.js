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
const payment = require('./payment');
// Tin về tiền (chờ chuyển khoản/cọc, chuyển thiếu, chuyển dư…) → chủ đề TIỀN VỀ (/chontien); chưa chọn thì vào chủ đề đơn hàng
const MONEY = { topic: 'money' };

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

  console.log(`[sepay] tiền vào ${amount} · "${content.slice(0, 80)}"`);
  const code = findCode(content) || findCode(tx.code);
  if (!code) {
    await save('no_code');
    return { result: 'no_code' };
  }
  const order = await db('orders').where({ code }).first();
  if (!order) {
    await save('unknown_order');
    await notify.telegram(`💸 Tiền vào <b>${money(amount)}</b> có mã <b>${code}</b> nhưng không tìm thấy đơn.\nNội dung: ${notify.escapeTg(content)}`, null, MONEY);
    return { result: 'unknown_order' };
  }
  if (order.payment_status === 'paid') {
    await save('already_paid', order.id);
    await notify.telegram(`💸 Đơn <b>${code}</b> đã thanh toán trước đó, nay nhận thêm <b>${money(amount)}</b> — kiểm tra khách chuyển trùng.`, null, MONEY);
    return { result: 'already_paid' };
  }
  // Số tiền cần lúc này: cả đơn (CK), tiền cọc (COD chờ cọc), hoặc phần còn lại (COD đã cọc)
  const due = payment.amountDue(order);
  const remaining = Number(order.total) - (order.payment_status === 'deposit' ? Number(order.deposit_amount) : 0);
  if (amount < due) {
    await save('underpaid', order.id);
    await notify.telegram(
      `⚠️ Đơn <b>${code}</b> chuyển thiếu: nhận <b>${money(amount)}</b> / cần ${money(due)}${due !== Number(order.total) ? ' (tiền cọc)' : ''} (thiếu ${money(due - amount)}).\nLiên hệ khách: ${notify.escapeTg(order.customer_name)} · ${notify.escapeTg(order.phone)}`,
      null, MONEY,
    );
    return { result: 'underpaid' };
  }

  // Đủ cả đơn → đã thanh toán; mới đủ tiền cọc → đã cọc. Đơn tự hủy vì quá hạn mà khách vẫn chuyển → khôi phục
  const changes = { payment_status: amount >= remaining ? 'paid' : 'deposit' };
  if (order.status === 'cancelled') changes.status = 'new';
  await updateOrder(order.id, changes, { by: `SePay tự động (${require('./format').money(amount)})` });
  await save(`${changes.payment_status}${order.status === 'cancelled' ? '_restored' : ''}`, order.id);
  const over = changes.payment_status === 'paid' ? amount - remaining : amount - due;
  if (over > 0 && changes.payment_status === 'paid') {
    await notify.telegram(`ℹ️ Đơn <b>${code}</b> khách chuyển dư ${money(over)}.`, null, MONEY);
  }
  return { result: changes.payment_status, orderId: order.id };
}

/** Sau khi đơn chuyển sang "Đã thanh toán": đơn chưa báo nhóm thì báo (ĐƠN MỚI), đã báo thì cập nhật tin. */
const money2 = (n) => require('./format').money(n);

function waitText(order, state) {
  const head = {
    wait: Number(order.deposit_amount) > 0 && order.payment_method === 'cod'
      ? `⏳ <b>CHỜ CỌC</b> ${money2(order.deposit_amount)} · ${order.code} (COD)`
      : `⏳ <b>CHỜ CHUYỂN KHOẢN</b> · ${order.code}`,
    paid: `✅ <b>${order.payment_status === 'deposit' ? 'ĐÃ NHẬN CỌC' : 'ĐÃ NHẬN TIỀN'}</b> · ${order.code} → xem tin ĐƠN MỚI bên dưới để xử lý`,
    expired: `❌ <b>TỰ HỦY</b> · ${order.code} — quá hạn chưa chuyển khoản, hàng đã trả về kho`,
  }[state];
  return [
    head,
    `👤 ${notify.escapeTg(order.customer_name)} · ${notify.escapeTg(order.phone)}`,
    `💰 ${money2(order.total)} · giao ${require('./format').deliveryWhen(order)}`,
    state === 'wait' ? '<i>Chưa soạn hàng. Bot báo ĐƠN MỚI khi nhận được tiền. Có thể gọi nhắc khách.</i>' : null,
  ].filter(Boolean).join('\n');
}

/** Đơn chuyển khoản vừa đặt (đang giữ chờ tiền): báo nhóm biết có khách, chưa có nút xử lý. */
async function notifyWaiting(order) {
  try {
    const msg = await notify.telegram(waitText(order, 'wait'), null, MONEY);
    if (msg && msg.message_id) await db('orders').where({ id: order.id }).update({ tg_wait_message_id: msg.message_id });
  } catch (err) {
    console.error('[telegram] báo đơn chờ CK lỗi:', err.message);
  }
}

async function updateWaiting(order, state) {
  if (!order.tg_wait_message_id || !config.telegram.token) return;
  const chat = await notify.telegramChatId();
  await notify
    .tgApi('editMessageText', { chat_id: chat, message_id: Number(order.tg_wait_message_id), text: waitText(order, state), parse_mode: 'HTML' })
    .catch(() => {});
}

async function afterPaid(orderId) {
  const tg = require('./telegram-orders');
  const order = await db('orders').where({ id: orderId }).first();
  if (!order) return;
  await updateWaiting(order, 'paid');
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
    .where({ payment_status: 'pending', status: 'new' })
    .andWhere((w) => w.where('payment_method', 'bank').orWhere((x) => x.where('payment_method', 'cod').andWhere('deposit_amount', '>', 0)))
    .whereNull('tg_message_id')
    .andWhere('created_at', '<', before)
    .select('id');
  for (const r of rows) {
    await updateOrder(r.id, { status: 'cancelled' }, { by: `Tự hủy: quá ${hours} giờ chưa thanh toán` });
    await updateWaiting(await db('orders').where({ id: r.id }).first(), 'expired');
  }
  return rows.length;
}

/**
 * Đơn chờ chuyển khoản/cọc đã qua nửa thời gian giữ mà chưa trả → email nhắc 1 lần (kèm QR, giờ hết hạn).
 * Khách hay quên sau khi đặt; nhắc kịp lúc cứu được đơn thay vì để tự hủy.
 */
async function remindUnpaid() {
  const s = await settings.all();
  const hours = holdHours(s);
  const now = Date.now();
  const rows = await db('orders')
    .where({ payment_status: 'pending', status: 'new' })
    .andWhere((w) => w.where('payment_method', 'bank').orWhere((x) => x.where('payment_method', 'cod').andWhere('deposit_amount', '>', 0)))
    .whereNull('tg_message_id')
    .whereNull('pay_reminded_at')
    .whereNotNull('email').whereNot('email', '')
    .andWhere('created_at', '<', new Date(now - (hours / 2) * 3600000))
    .andWhere('created_at', '>', new Date(now - (hours - 1) * 3600000));
  for (const order of rows) {
    await db('orders').where({ id: order.id }).update({ pay_reminded_at: new Date() });
    const items = await db('order_items').where({ order_id: order.id });
    const deadline = new Date(new Date(order.created_at).getTime() + hours * 3600000);
    const until = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(deadline);
    const isDep = order.payment_method === 'cod';
    notify.sendMail({
      to: order.email,
      subject: `Nhắc ${isDep ? 'đặt cọc' : 'thanh toán'} đơn ${order.code} — Lunar Lucky giữ giỏ quà đến ${until}`,
      template: 'order-confirmation',
      data: { order, items, s, reminder: { until }, qr: payment.qrForOrder(order, s), payee: payment.accountForOrder(order, s) },
    });
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
      w.where((x) => x.where('payment_method', 'cod').andWhere('deposit_amount', 0)).orWhereIn('payment_status', ['paid', 'deposit']);
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
    if (enabled()) {
      await remindUnpaid().catch((err) => console.error('[thanh toán] email nhắc lỗi:', err.message));
      await expireUnpaid().catch((err) => console.error('[thanh toán] tự hủy đơn lỗi:', err.message));
    }
  };
  setTimeout(run, 30000).unref();
  setInterval(run, 60000).unref();
}

module.exports = { notifyWaiting, resendMissed, enabled, authorized, findCode, handleSepay, afterPaid, expireUnpaid, remindUnpaid, startExpiryTimer, holdHours };
