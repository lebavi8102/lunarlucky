/**
 * Đối soát với nhà cung cấp (chủ shop 25/11/2026).
 * Mô hình: nhà cung cấp giữ hàng, giao hàng, chịu ship/hộp/thiệp/hàng hỏng (đã gồm trong giá nhập) và NHẬN TIỀN KHÁCH
 * vào tài khoản của họ (chuyển khoản hoặc COD shipper thu). Chủ shop chạy quảng cáo + bán.
 *
 *   Giá nhập 1 giỏ  = giá nhập SỈ nếu cả đơn ≥ mốc đơn sỉ (mặc định 10 giỏ), ngược lại giá nhập LẺ — khóa lúc đặt (order_items.unit_cost)
 *   Mỗi đơn         : khách trả (order.total) − tiền hàng (Σ giá nhập × số lượng) = phần của chủ shop
 *   Mỗi tuần (T2→CN): cộng các đơn ĐÃ GIAO XONG chưa vào kỳ nào, ngày giao ≤ cuối kỳ → nhà cung cấp chuyển lại phần của chủ shop.
 *   Đơn giao trễ / hoàn tất muộn tự vào kỳ sau, không bao giờ sót. Đã chốt thì khóa (orders.settlement_id).
 */
const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const { todayVN } = require('./format');

async function wholesaleMin() {
  const n = Number((await settings.all()).wholesale_min_qty);
  return Number.isInteger(n) && n > 1 ? n : 10;
}

/** Giá nhập 1 giỏ theo tổng số giỏ của đơn. product cần cost_price (lẻ), cost_price_si (sỉ). */
function unitCostFor(product, orderQty, minSi) {
  if (!product) return null;
  const le = product.cost_price ?? null;
  const si = product.cost_price_si ?? null;
  return orderQty >= minSi && si != null ? si : le;
}

/** Gắn unit_cost cho các dòng hàng (mảng {product_id, qty}) theo mức sỉ/lẻ của cả đơn. */
async function applyUnitCosts(lines) {
  const ids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  if (!ids.length) return lines;
  const min = await wholesaleMin();
  const qty = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0);
  const prods = new Map((await db('products').whereIn('id', ids).select('id', 'cost_price', 'cost_price_si')).map((p) => [p.id, p]));
  for (const l of lines) if (l.product_id) l.unit_cost = unitCostFor(prods.get(l.product_id), qty, min);
  return lines;
}

/** Thứ Hai → Chủ nhật của tuần chứa `day` (YYYY-MM-DD, giờ VN). */
function weekOf(day = todayVN()) {
  const d = new Date(`${day}T12:00:00+07:00`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Thứ Hai
  const mon = new Date(d.getTime() - dow * 86400000);
  const f = (x) => x.toISOString().slice(0, 10);
  return { from: f(mon), to: f(new Date(mon.getTime() + 6 * 86400000)) };
}
/** Tuần trước (kỳ cần chốt mặc định). */
const lastWeek = () => weekOf(todayVN(-7));

const eligible = (q) => q.where({ status: 'completed' }).whereNot('payment_status', 'refunded');

/**
 * Bảng đối soát.
 * - settlementId: xem lại kỳ đã chốt
 * - to: kỳ đang mở → mọi đơn đã giao xong, chưa chốt, ngày giao ≤ to
 */
async function sheet({ settlementId = null, to = null } = {}) {
  let q = db('orders');
  if (settlementId) q = q.where({ settlement_id: settlementId });
  else q = eligible(q).whereNull('settlement_id').andWhere('delivery_date', '<=', to);
  const orders = await q.orderBy([{ column: 'delivery_date' }, { column: 'id' }]);
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await db('order_items').whereIn('order_id', ids).orderBy('id') : [];
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const i of items) byOrder.get(i.order_id).push(i);
  const min = await wholesaleMin();
  let revenue = 0;
  let cost = 0;
  let missing = 0;
  const rows = orders.map((o) => {
    const its = byOrder.get(o.id);
    const qty = its.reduce((t, i) => t + i.qty, 0);
    let c = 0;
    let miss = false;
    for (const i of its) {
      if (i.unit_cost == null) miss = true;
      c += (Number(i.unit_cost) || 0) * i.qty;
    }
    if (miss) missing++;
    const total = Number(o.total);
    revenue += total;
    cost += c;
    return {
      id: o.id, code: o.code, delivery_date: String(o.delivery_date || '').slice(0, 10), customer: o.customer_name,
      payment: o.payment_method === 'cod' ? 'COD (shipper thu)' : 'Chuyển khoản',
      items: its, qty, isSi: qty >= min, total, cost: c, owner: total - c, missingCost: miss,
    };
  });
  return { rows, revenue, cost, ownerDue: revenue - cost, missing, minSi: min };
}

/** Tính lại giá nhập theo bảng giá hiện tại cho các đơn CHƯA chốt (vd: vừa cập nhật Excel giá nhập sỉ). */
async function recalcOpen(to) {
  const orders = await eligible(db('orders')).whereNull('settlement_id').andWhere('delivery_date', '<=', to).select('id');
  let n = 0;
  for (const o of orders) {
    const its = await db('order_items').where({ order_id: o.id }).select('id', 'product_id', 'qty', 'unit_cost');
    const before = its.map((i) => i.unit_cost);
    await applyUnitCosts(its);
    for (let k = 0; k < its.length; k++) {
      if (its[k].unit_cost !== before[k]) { await db('order_items').where({ id: its[k].id }).update({ unit_cost: its[k].unit_cost }); n++; }
    }
  }
  return n;
}

/** Chốt kỳ: khóa các đơn trong bảng vào 1 kỳ. */
async function close({ from, to, by, note }) {
  const s = await sheet({ to });
  if (!s.rows.length) return { error: 'Không có đơn nào đã giao xong để chốt.' };
  if (s.missing) return { error: `Còn ${s.missing} đơn thiếu giá nhập — cập nhật giá nhập (Excel) rồi bấm "Tính lại giá nhập" trước khi chốt.` };
  let id;
  await db.transaction(async (trx) => {
    const [x] = await trx('supplier_settlements').insert({
      period_from: from, period_to: to, orders_count: s.rows.length, revenue: s.revenue, cost: s.cost, owner_due: s.ownerDue,
      status: 'closed', note: note || null, created_by: by || null,
    });
    id = typeof x === 'object' ? x.id : x;
    await trx('orders').whereIn('id', s.rows.map((r) => r.id)).whereNull('settlement_id').update({ settlement_id: id });
  });
  return { id, sheet: s };
}

/** Link chỉ xem cho nhà cung cấp: có chữ ký, không đoán được. */
function shareKey(id) {
  return crypto.createHmac('sha256', `doi-soat:${require('../config').sessionSecret}`).update(String(id)).digest('base64url').slice(0, 20);
}
function shareLink(id) {
  return `${require('../config').siteUrl}/doi-soat/${id}?k=${shareKey(id)}`;
}

/** File Excel 2 sheet: tổng hợp từng đơn + chi tiết từng giỏ. */
function excel(s, title) {
  const { buildXlsx } = require('./xlsx');
  return buildXlsx([
    {
      name: 'Đối soát',
      columns: [
        { header: 'Mã đơn', key: 'code', width: 16 },
        { header: 'Ngày giao', key: 'delivery_date', width: 12 },
        { header: 'Khách', key: 'customer', width: 22 },
        { header: 'Sỉ / lẻ', key: 'kind', width: 8 },
        { header: 'Số giỏ', key: 'qty', type: 'number', width: 8 },
        { header: 'Thanh toán', key: 'payment', width: 16 },
        { header: 'Khách trả (₫)', key: 'total', type: 'money', width: 14 },
        { header: 'Tiền hàng theo giá nhập (₫)', key: 'cost', type: 'money', width: 16 },
        { header: 'Phần chủ shop (₫)', key: 'owner', type: 'money', width: 15 },
      ],
      rows: [
        ...s.rows.map((r) => ({ ...r, kind: r.isSi ? 'Sỉ' : 'Lẻ' })),
        { code: 'TỔNG', customer: title, total: s.revenue, cost: s.cost, owner: s.ownerDue },
      ],
    },
    {
      name: 'Chi tiết giỏ',
      columns: [
        { header: 'Mã đơn', key: 'code', width: 16 },
        { header: 'Giỏ', key: 'name', width: 30 },
        { header: 'Số lượng', key: 'qty', type: 'number', width: 9 },
        { header: 'Giá bán / giỏ', key: 'price', type: 'money', width: 13 },
        { header: 'Giá nhập / giỏ', key: 'unit_cost', type: 'money', width: 13 },
        { header: 'Tiền hàng', key: 'cost_total', type: 'money', width: 13 },
      ],
      rows: s.rows.flatMap((r) => r.items.map((i) => ({ code: r.code, name: i.name, qty: i.qty, price: i.price, unit_cost: i.unit_cost, cost_total: (Number(i.unit_cost) || 0) * i.qty }))),
    },
  ]);
}

module.exports = { unitCostFor, applyUnitCosts, weekOf, lastWeek, sheet, recalcOpen, close, shareKey, shareLink, excel, wholesaleMin };
