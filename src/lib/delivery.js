/**
 * Kế hoạch giao theo ngày (mùa cao điểm): đơn cần giao, bảng soạn hàng, tiền COD cần thu.
 * Đơn "sẵn sàng giao" = chưa hủy và (COD hoặc đã thanh toán). Đơn chuyển khoản chưa trả tiền tách riêng.
 */
const db = require('../db');

const payment = require('./payment');
const isReady = (o) => o.status !== 'cancelled' && !payment.awaitingMoney(o);

async function forDate(day) {
  const orders = await db('orders').where({ delivery_date: day }).whereNot('status', 'cancelled').orderBy('id');
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await db('order_items as i').leftJoin('products as p', 'p.id', 'i.product_id').whereIn('i.order_id', ids).select('i.*', 'p.sku') : [];
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const i of items) byOrder.get(i.order_id).push(i);

  // Xếp theo buổi giao (sáng → chiều → tối → buổi nào cũng được) để shipper đi theo thứ tự
  const SLOT_ORDER = { sang: 0, chieu: 1, toi: 2 };
  const ready = orders.filter(isReady).map((o) => ({ ...o, items: byOrder.get(o.id) }))
    .sort((a, b) => (SLOT_ORDER[a.delivery_slot] ?? 3) - (SLOT_ORDER[b.delivery_slot] ?? 3) || a.id - b.id);
  const unpaid = orders.filter((o) => !isReady(o)).map((o) => ({ ...o, items: byOrder.get(o.id) }));

  // Bảng soạn hàng: tổng số giỏ mỗi loại cần chuẩn bị (chỉ đơn sẵn sàng giao)
  const pick = new Map();
  for (const o of ready) {
    for (const i of o.items) {
      const k = i.product_id || i.name;
      const r = pick.get(k) || { name: i.name, sku: i.sku || '', qty: 0, orders: 0 };
      r.qty += i.qty;
      r.orders += 1;
      pick.set(k, r);
    }
  }
  const area = (o) => (/hà nội/i.test(o.province || '') ? 'Hà Nội' : 'Tỉnh khác');
  return {
    day,
    ready,
    unpaid,
    picking: [...pick.values()].sort((a, b) => b.qty - a.qty),
    baskets: ready.reduce((a, o) => a + o.items.reduce((x, i) => x + i.qty, 0), 0),
    cards: ready.filter((o) => o.card_message).length,
    codTotal: ready.reduce((a, o) => a + payment.codDue(o), 0),
    hanoi: ready.filter((o) => area(o) === 'Hà Nội').length,
    provinces: ready.filter((o) => area(o) !== 'Hà Nội').length,
    area,
  };
}

/** Địa chỉ + người nhận thực tế (đơn gửi tặng giao cho người nhận). */
function shipTo(o) {
  return o.is_gift
    ? { name: o.recipient_name, phone: o.recipient_phone, address: `${o.recipient_address || ''}, ${o.province || ''}` }
    : { name: o.customer_name, phone: o.phone, address: `${o.address || ''}, ${o.province || ''}` };
}

const codDue = (o) => payment.codDue(o);

module.exports = { forDate, shipTo, codDue, isReady };
