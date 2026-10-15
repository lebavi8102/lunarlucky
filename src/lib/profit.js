/**
 * Báo cáo doanh thu – lợi nhuận.
 *
 *   Doanh thu        = tiền hàng (sau giảm giá) + phí giao khách trả
 *   Giá vốn          = Σ số lượng × giá vốn (giá nhập) lưu lúc đặt
 *   Lợi nhuận gộp    = Doanh thu − Giá vốn
 *   Chi phí          = Σ khoản chi trong kỳ (ship thực trả, bao bì, quảng cáo...)
 *   Lợi nhuận cuối   = Lợi nhuận gộp − Chi phí
 *
 * Phí xuất hóa đơn VAT khách trả là tiền thu hộ (chuyển cho đơn vị xuất hóa đơn) → không tính vào doanh thu.
 * Đơn được tính: chưa hủy và đã thu tiền (chuyển khoản đã nhận, hoặc đơn COD đã hoàn tất / đã thu).
 */
const db = require('../db');

const EXPENSE_CATEGORIES = [
  'Phí vận chuyển thực trả',
  'Bao bì, hộp, thiệp',
  'Quảng cáo (Facebook, Zalo...)',
  'Hosting & phần mềm',
  'Nhân công',
  'Phí ngân hàng / SePay',
  'Khác',
];

const VN = '+07:00';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
const startOf = (day) => new Date(`${day}T00:00:00${VN}`);
const addDays = (day, n) => ymd(new Date(startOf(day).getTime() + n * 86400000 + 3600000));

/** Kỳ báo cáo có sẵn → { from, to } (YYYY-MM-DD, tính cả 2 đầu, giờ Việt Nam). */
function presetRange(key, today = ymd(new Date())) {
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (key) {
    case 'hom-nay':
      return { from: today, to: today };
    case '7-ngay':
      return { from: addDays(today, -6), to: today };
    case '30-ngay':
      return { from: addDays(today, -29), to: today };
    case 'thang-truoc': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
    }
    case 'nam-nay':
      return { from: `${y}-01-01`, to: today };
    case 'thang-nay':
    default:
      return { from: `${y}-${pad(m)}-01`, to: today };
  }
}

// Đơn đã hoàn tiền (khách trả hàng) không còn là doanh thu
const isPaid = (o) => o.status !== 'cancelled' && o.payment_status !== 'refunded' && (o.payment_status === 'paid' || o.status === 'completed');

async function report({ from, to }) {
  const start = startOf(from);
  const end = startOf(addDays(to, 1));

  const orders = await db('orders')
    .where('created_at', '>=', start)
    .andWhere('created_at', '<', end)
    .select('id', 'code', 'status', 'payment_status', 'payment_method', 'subtotal', 'discount', 'shipping_fee', 'vat_fee', 'total', 'created_at');
  const paid = orders.filter(isPaid);
  const pending = orders.filter((o) => o.status !== 'cancelled' && !isPaid(o));

  const items = paid.length
    ? await db('order_items as i')
        .leftJoin('products as p', 'p.id', 'i.product_id')
        .whereIn('i.order_id', paid.map((o) => o.id))
        .select('i.order_id', 'i.product_id', 'i.name', 'i.qty', 'i.line_total', 'i.unit_cost', 'p.cost_price', 'p.sku')
    : [];

  const byOrder = new Map(paid.map((o) => [o.id, { cost: 0 }]));
  const products = new Map();
  let missingCost = 0;
  for (const i of items) {
    const unit = i.unit_cost ?? i.cost_price;
    if (unit == null) missingCost += i.qty;
    const cost = (unit || 0) * i.qty;
    byOrder.get(i.order_id).cost += cost;
    const key = i.product_id || `x:${i.name}`;
    const p = products.get(key) || { name: i.name, sku: i.sku || '', qty: 0, revenue: 0, cost: 0, missing: false };
    p.qty += i.qty;
    p.revenue += i.line_total;
    p.cost += cost;
    if (unit == null) p.missing = true;
    products.set(key, p);
  }

  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const goods = sum(paid, (o) => o.subtotal - o.discount);
  const shipping = sum(paid, (o) => o.shipping_fee);
  const vatCollected = sum(paid, (o) => o.vat_fee);
  const revenue = goods + shipping;
  const cogs = sum([...byOrder.values()], (x) => x.cost);
  const gross = revenue - cogs;

  const expenseRows = await db('expenses').whereBetween('spent_on', [from, to]).select('category', 'amount');
  const expenseByCat = {};
  for (const e of expenseRows) expenseByCat[e.category] = (expenseByCat[e.category] || 0) + Number(e.amount);
  const expenses = sum(expenseRows, (e) => e.amount);
  const net = gross - expenses;

  // Theo ngày (≤ 62 ngày) hoặc theo tháng
  const days = Math.round((end - start) / 86400000);
  const bucket = (d) => (days <= 62 ? ymd(new Date(d)) : ymd(new Date(d)).slice(0, 7));
  const series = new Map();
  for (const o of paid) {
    const k = bucket(o.created_at);
    const s = series.get(k) || { key: k, orders: 0, revenue: 0, cogs: 0 };
    s.orders += 1;
    s.revenue += o.subtotal - o.discount + o.shipping_fee;
    s.cogs += byOrder.get(o.id).cost;
    series.set(k, s);
  }

  return {
    from, to,
    orders: paid.length,
    pendingOrders: pending.length,
    pendingValue: sum(pending, (o) => o.total),
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    refunded: orders.filter((o) => o.payment_status === 'refunded').length,
    goods, shipping, vatCollected, revenue, cogs, gross, expenses, expenseByCat, net,
    grossMargin: revenue ? gross / revenue : 0,
    netMargin: revenue ? net / revenue : 0,
    avgOrder: paid.length ? Math.round(revenue / paid.length) : 0,
    missingCost,
    series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)).map((s) => ({ ...s, profit: s.revenue - s.cogs })),
    products: [...products.values()].map((p) => ({ ...p, profit: p.revenue - p.cost })).sort((a, b) => b.profit - a.profit),
  };
}

module.exports = { report, presetRange, EXPENSE_CATEGORIES, isPaid };
