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
  let status = ORDER_STATUS[changes.status] ? changes.status : order.status;
  const payment_status = PAYMENT_STATUS[changes.payment_status] ? changes.payment_status : order.payment_status;
  // Đơn chủ shop đặt hộ: tiền/cọc về là coi như đã chốt → tự "Đã xác nhận" để kho soạn ngay
  const gotMoney = ['paid', 'deposit'].includes(payment_status) && !['paid', 'deposit'].includes(order.payment_status);
  if (gotMoney && order.created_by && status === 'new') status = 'confirmed';

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
  if (status === 'completed' && order.status !== 'completed') update.completed_at = new Date(); // để xin đánh giá sau vài giờ
  const becamePaid = payment_status === 'paid' && order.payment_status !== 'paid';
  if (becamePaid) update.paid_at = new Date();
  if (payment_status === 'deposit' && order.payment_status !== 'deposit') update.deposit_paid_at = new Date();
  // Đơn "sẵn sàng" (đã trả hoặc đã cọc) lần đầu → báo nhóm ĐƠN MỚI
  const ready = (st) => st === 'paid' || st === 'deposit';
  const becameReady = ready(payment_status) && !ready(order.payment_status);

  await db.transaction(async (trx) => {
    const goingCancelled = status === 'cancelled' && order.status !== 'cancelled';
    const leavingCancelled = order.status === 'cancelled' && status !== 'cancelled';
    // Mã giảm giá: hủy đơn → trả lại lượt dùng; khôi phục đơn → tính lại lượt
    if ((goingCancelled || leavingCancelled) && order.coupon_code) {
      const c = trx('coupons').whereRaw('UPPER(code) = ?', [String(order.coupon_code).toUpperCase()]);
      if (goingCancelled) await c.andWhere('used_count', '>', 0).decrement('used_count', 1);
      else await c.increment('used_count', 1);
    }
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

/**
 * Sửa tiền điều chỉnh (khách đổi món sau khi đã đặt) → tính lại phí VAT, tổng tiền, tiền cọc.
 * Chỉ khi chưa nhận đủ tiền: đơn chưa thanh toán, hoặc COD đã cọc (phần còn lại thu khi giao tự đổi theo).
 * Đơn chuyển khoản đã trả đủ → không sửa ở đây (chênh lệch thu thêm/hoàn lại xử lý riêng).
 */
async function updateAdjustment(id, { adjustment, note }, { by } = {}) {
  const order = await db('orders').where({ id }).first();
  if (!order) return { error: 'Không tìm thấy đơn.' };
  if (['cancelled', 'completed'].includes(order.status)) return { error: 'Đơn đã hủy/hoàn tất — không sửa giá được.' };
  if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
    return { error: 'Đơn đã thanh toán đủ — không sửa giá ở đây. Chênh lệch: thu thêm hoặc hoàn lại cho khách rồi ghi chú vào đơn.' };
  }
  const adj = Math.round(Number(adjustment) || 0);
  const base = Number(order.subtotal) - Number(order.discount);
  if (adj < -base) return { error: 'Giảm nhiều hơn tiền hàng — kiểm tra lại số tiền.' };
  if (adj > 100000000) return { error: 'Số tiền điều chỉnh quá lớn.' };
  const cleanNote = String(note || '').trim().slice(0, 200) || null;
  if (adj && !cleanNote) return { error: 'Ghi lý do điều chỉnh (vd: đổi vang sang trà Shan tuyết).' };
  if (adj === Number(order.adjustment || 0) && (cleanNote || null) === (order.adjustment_note || null)) return { order, changed: false };

  const s = await settings.all();
  const payment = require('./payment');
  const goods = base + adj;
  const vat_fee = order.needs_vat ? Math.round(goods * (Number(order.vat_fee_percent) || payment.vatFeePercent(s)) / 100) : 0;
  const total = goods + Number(order.shipping_fee) + vat_fee;
  const update = { adjustment: adj, adjustment_note: adj ? cleanNote : null, vat_fee, total, updated_at: new Date() };
  // Cọc: chưa nhận cọc → tính lại theo giá mới; đã nhận cọc → giữ nguyên, phần thu khi giao tự đổi
  if (order.payment_method === 'cod' && order.payment_status === 'pending') {
    const qty = Number((await db('order_items').where({ order_id: id }).sum({ n: 'qty' }).first() || {}).n) || 0;
    update.deposit_amount = payment.depositFor({ goods, qty, total }, s);
  }
  const { money } = require('./format');
  const sign = (n) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : '0');
  const ev = `Đổi giá (${cleanNote || 'bỏ điều chỉnh'}): điều chỉnh ${sign(Number(order.adjustment) || 0)} → ${sign(adj)} · tổng ${money(order.total)} → ${money(total)}`
    + (update.deposit_amount !== undefined && update.deposit_amount !== Number(order.deposit_amount) ? ` · cọc ${money(order.deposit_amount)} → ${money(update.deposit_amount)}` : '');
  update.handled_log = [order.handled_log, `${logTime()} · ${ev}${by ? ` · ${by}` : ''}`].filter(Boolean).join('\n').split('\n').slice(-30).join('\n');
  await db('orders').where({ id }).update(update);
  const next = { ...order, ...update };
  await require('./telegram-orders').refreshOrderMessage(id).catch(() => {});
  // Đơn đang chờ tiền → báo chủ đề TIỀN VỀ số tiền mới cần chuyển
  if (payment.awaitingMoney(next) || next.payment_status === 'deposit') {
    await notify.telegram(`✏️ <b>Đơn ${next.code} đổi giá</b> (${notify.escapeTg(cleanNote || 'bỏ điều chỉnh')})\nTổng mới: <b>${money(total)}</b> · cần chuyển ngay: <b>${money(payment.amountDue(next))}</b>${next.payment_method === 'cod' ? ` · thu khi giao: ${money(payment.codDue(next))}` : ''}`, null, { topic: 'money' }).catch(() => {});
  }
  return { order: next, changed: true, event: ev };
}

module.exports = { ORDER_STATUS, PAYMENT_STATUS, loadOrder, updateOrder, updateDelivery, updateAdjustment, logTime };
