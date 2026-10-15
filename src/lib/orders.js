const db = require('../db');
const notify = require('./notify');
const settings = require('./settings');
const { parseJson } = require('./format');

const ORDER_STATUS = {
  new: 'Mới',
  confirmed: 'Đã xác nhận',
  packing: 'Đang đóng gói',
  shipping: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
};
const PAYMENT_STATUS = { pending: 'Chưa thanh toán', deposit: 'Đã cọc', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền' };

async function loadOrder(id) {
  const order = await db('orders').where({ id: Number(id) }).first();
  if (!order) return null;
  const items = (await db('order_items').where({ order_id: order.id })).map((i) => ({
    ...i,
    details: parseJson(i.details, null),
  }));
  return { order, items };
}

function logTime() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Cập nhật trạng thái đơn: hoàn/trừ tồn kho khi hủy, ghi lịch sử, gửi email cho khách.
 * changes: { status?, payment_status?, admin_note? } — by: tên người thao tác (để ghi lịch sử)
 */
async function updateOrder(id, changes, { by } = {}) {
  const data = await loadOrder(id);
  if (!data) return null;
  const { order, items } = data;
  const status = ORDER_STATUS[changes.status] ? changes.status : order.status;
  const payment_status = PAYMENT_STATUS[changes.payment_status] ? changes.payment_status : order.payment_status;

  const events = [];
  if (status !== order.status) events.push(ORDER_STATUS[status]);
  if (payment_status !== order.payment_status) events.push(PAYMENT_STATUS[payment_status]);
  const log = [order.handled_log, ...events.map((e) => `${logTime()} · ${e}${by ? ` · ${by}` : ''}`)]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .slice(-30)
    .join('\n');

  const update = { status, payment_status, handled_log: log || null, updated_at: new Date() };
  if (changes.admin_note !== undefined) update.admin_note = changes.admin_note;
  const becamePaid = payment_status === 'paid' && order.payment_status !== 'paid';
  if (becamePaid) update.paid_at = new Date();
  if (payment_status === 'deposit' && order.payment_status !== 'deposit') update.deposit_paid_at = new Date();
  // Đơn "sẵn sàng" (đã trả hoặc đã cọc) lần đầu → báo nhóm ĐƠN MỚI
  const ready = (st) => st === 'paid' || st === 'deposit';
  const becameReady = ready(payment_status) && !ready(order.payment_status);

  await db.transaction(async (trx) => {
    const goingCancelled = status === 'cancelled' && order.status !== 'cancelled';
    const leavingCancelled = order.status === 'cancelled' && status !== 'cancelled';
    if (goingCancelled || leavingCancelled) {
      const sign = goingCancelled ? 1 : -1;
      for (const i of items.filter((x) => x.product_id)) {
        await trx('products').where({ id: i.product_id }).update({
          stock: trx.raw('stock + ?', [sign * i.qty]),
          sold: trx.raw('CASE WHEN sold - ? < 0 THEN 0 ELSE sold - ? END', [sign * i.qty, sign * i.qty]),
        });
      }
    }
    await trx('orders').where({ id: order.id }).update(update);
  });

  if (status !== order.status && order.email && ['confirmed', 'shipping', 'completed', 'cancelled'].includes(status)) {
    notify.sendMail({
      to: order.email,
      subject: `Đơn hàng ${order.code}: ${ORDER_STATUS[status]}`,
      template: 'order-status',
      data: { order: { ...order, status, payment_status }, statusLabel: ORDER_STATUS[status], s: await settings.all(), expired: /^Tự hủy/.test(by || '') },
    });
  }
  // Đã nhận tiền: đơn chuyển khoản chưa báo nhóm thì giờ mới báo "ĐƠN MỚI"
  if (becameReady) {
    await require('./bank-payments').afterPaid(order.id).catch((err) => console.error('[thanh toán] báo nhóm lỗi:', err.message));
  }
  // Khôi phục đơn đã hủy mà kho không đủ (giỏ đã bán cho khách khác) → báo để kiểm hàng
  let negativeStock = [];
  if (order.status === 'cancelled' && status !== 'cancelled') {
    const pids = items.filter((x) => x.product_id).map((x) => x.product_id);
    if (pids.length) negativeStock = await db('products').whereIn('id', pids).andWhere('stock', '<', 0).select('name', 'stock');
  }
  return { before: order, order: { ...order, ...update }, items, changed: events.length > 0, negativeStock };
}

const DELIVERY_FIELDS = {
  delivery_date: 'Ngày giao', delivery_slot: 'Buổi giao', phone: 'SĐT người đặt', address: 'Địa chỉ',
  recipient_name: 'Người nhận', recipient_phone: 'SĐT người nhận', recipient_address: 'Địa chỉ nhận', card_message: 'Lời chúc thiệp', note: 'Ghi chú',
};

/**
 * Đổi thông tin giao (khách xin đổi ngày, shipper báo hẹn lại…): ghi từng thay đổi vào lịch sử, sửa tin Telegram.
 * changes chỉ gồm các trường trong DELIVERY_FIELDS; trường không đổi được bỏ qua.
 */
async function updateDelivery(id, changes, { by } = {}) {
  const order = await db('orders').where({ id }).first();
  if (!order) return null;
  const { ymd, slotLabel } = require('./format');
  const show = (k, v) => (k === 'delivery_date' ? ymd(String(v || '').slice(0, 10)) : k === 'delivery_slot' ? slotLabel(v) || 'buổi nào cũng được' : v || '(trống)');
  const update = {};
  const events = [];
  for (const [k, label] of Object.entries(DELIVERY_FIELDS)) {
    if (changes[k] === undefined) continue;
    const before = k === 'delivery_date' ? String(order[k] || '').slice(0, 10) : order[k] || null;
    const after = changes[k] === '' ? null : changes[k];
    if (String(before || '') === String(after || '')) continue;
    update[k] = after;
    events.push(`Đổi ${label.toLowerCase()}: ${show(k, before)} → ${show(k, after)}`);
  }
  if (!events.length) return { order, changed: false };
  update.handled_log = [order.handled_log, ...events.map((e) => `${logTime()} · ${e}${by ? ` · ${by}` : ''}`)]
    .filter(Boolean).join('\n').split('\n').slice(-30).join('\n');
  update.updated_at = new Date();
  await db('orders').where({ id }).update(update);
  await require('./telegram-orders').refreshOrderMessage(id);
  return { order: { ...order, ...update }, changed: true, events };
}

module.exports = { ORDER_STATUS, PAYMENT_STATUS, loadOrder, updateOrder, updateDelivery, logTime };
