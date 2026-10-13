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
const PAYMENT_STATUS = { pending: 'Chưa thanh toán', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền' };

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
      data: { order: { ...order, status }, statusLabel: ORDER_STATUS[status], s: await settings.all() },
    });
  }
  return { before: order, order: { ...order, ...update }, items, changed: events.length > 0 };
}

module.exports = { ORDER_STATUS, PAYMENT_STATUS, loadOrder, updateOrder, logTime };
