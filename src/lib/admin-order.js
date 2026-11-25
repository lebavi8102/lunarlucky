/**
 * Chủ shop / nhân viên tạo đơn ngay trong admin (khách chốt qua Fanpage, Zalo, điện thoại).
 * Khác đơn trên web: giá từng giỏ do người tạo tự quyết (giá sỉ, giá thương lượng), ghi được
 * "khách đã chuyển khoản / đã cọc", và luôn báo ngay vào nhóm Telegram để cả nhóm cùng biết.
 * (Chủ shop yêu cầu 25/11/2026.)
 */
const db = require('../db');
const settings = require('./settings');
const { Form } = require('./validate');
const { SOURCES, todayVN } = require('./format');

const MAX_LINES = 30;

/** Đọc các dòng hàng từ form (mảng product_id[], qty[], price[]). */
function readLines(body) {
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const ids = arr(body.product_id);
  const qtys = arr(body.qty);
  const prices = arr(body.price);
  const costs = arr(body.cost); // giá nhập chủ shop tự gõ (trống = lấy theo bảng giá nhập sỉ/lẻ)
  const out = [];
  for (let i = 0; i < Math.min(ids.length, MAX_LINES); i++) {
    const id = Number(ids[i]);
    const qty = Number(String(qtys[i] || '').replace(/\D/g, ''));
    const price = Number(String(prices[i] || '').replace(/\D/g, ''));
    const cRaw = String(costs[i] ?? '').replace(/\D/g, '');
    const cost = cRaw === '' ? null : Number(cRaw);
    if (!id) continue;
    out.push({ product_id: id, qty, price, cost, row: i });
  }
  return out;
}

/**
 * @returns {Promise<{ errors?: object, values?: object, order?: object, items?: object[], negative?: object[] }>}
 */
async function createStaffOrder(body, user) {
  const s = await settings.all();
  const payment = require('./payment');
  const checkout = require('../routes/checkout');
  const f = new Form(body);
  const errors = f.errors;

  // 1. Dòng hàng — giá tự quyết, gộp dòng trùng giỏ
  const raw = readLines(body);
  const products = raw.length ? await db('products').whereIn('id', raw.map((l) => l.product_id)) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  for (const l of raw) {
    const p = byId.get(l.product_id);
    if (!p) { errors.items = 'Có giỏ không còn trong danh sách sản phẩm — chọn lại.'; continue; }
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 10000) { errors.items = `Số lượng "${p.name}" không hợp lệ.`; continue; }
    if (!Number.isInteger(l.price) || l.price < 1000 || l.price > 100000000) { errors.items = `Đơn giá "${p.name}" không hợp lệ (tối thiểu 1.000₫).`; continue; }
    if (l.cost != null && (!Number.isInteger(l.cost) || l.cost > 100000000)) { errors.items = `Giá nhập "${p.name}" không hợp lệ.`; continue; }
    const same = lines.find((x) => x.product_id === p.id && x.price === l.price && x.typedCost === l.cost);
    if (same) { same.qty += l.qty; same.line_total = same.price * same.qty; continue; }
    lines.push({ product_id: p.id, name: p.name, price: l.price, qty: l.qty, line_total: l.price * l.qty, unit_cost: null, typedCost: l.cost });
  }
  if (!lines.length && !errors.items) errors.items = 'Chọn ít nhất 1 giỏ.';
  // Giá nhập: chủ shop gõ ô nào thì lưu đúng số đó; ô trống → theo bảng giá nhập sỉ/lẻ (tổng số giỏ của đơn)
  await require('./supplier').applyUnitCosts(lines);
  for (const l of lines) { if (l.typedCost != null) l.unit_cost = l.typedCost; delete l.typedCost; }

  // 2. Khách + giao hàng
  const customer_name = f.text('customer_name', { label: 'tên khách', required: true, min: 2, max: 120 });
  const phone = f.phone('phone', { label: 'số điện thoại khách' });
  const email = f.email('email') || null;
  const pv = String(body.province || '').normalize('NFC').trim();
  const province = checkout.PROVINCES.includes(pv) ? pv : '';
  if (!province) errors.province = 'Chọn tỉnh/thành phố.';
  const is_gift = f.bool('is_gift');
  let address = f.text('address', { label: 'địa chỉ', required: !is_gift, min: 6, max: 300 });
  let recipient_name = null;
  let recipient_phone = null;
  let recipient_address = null;
  if (is_gift) {
    recipient_name = f.text('recipient_name', { label: 'tên người nhận', required: true, min: 2, max: 120 });
    recipient_phone = f.phone('recipient_phone', { label: 'SĐT người nhận' });
    recipient_address = f.text('recipient_address', { label: 'địa chỉ người nhận', required: true, min: 6, max: 300 });
    if (!address) address = recipient_address;
  }
  // Đơn chốt tay: cho ghi cả ngày đã qua (nhập lại đơn đã giao) và ngày đã kín lịch
  const delivery_date = f.date('delivery_date', { label: 'ngày giao', required: true, minOffset: -30, maxOffset: 365 });
  const delivery_slot = checkout.isHanoi(province) ? f.oneOf('delivery_slot', ['', 'sang', 'chieu', 'toi'], '') || null : null;
  const note = f.text('note', { max: 500 }) || null;
  const source = f.oneOf('order_source', Object.keys(SOURCES), 'facebook');

  // 3. Tiền
  const subtotal = lines.reduce((t, l) => t + l.line_total, 0);
  const shipRaw = String(body.shipping_fee ?? '').replace(/\D/g, '');
  const shipping_fee = shipRaw === '' ? 0 : Number(shipRaw);
  if (shipping_fee > 10000000) errors.shipping_fee = 'Phí giao quá lớn.';
  const total = subtotal + shipping_fee;
  const payment_method = f.oneOf('payment_method', ['bank', 'cod'], 'bank');
  let payment_status = f.oneOf('payment_status', ['pending', 'deposit', 'paid'], 'pending');
  let deposit_amount = 0;
  if (payment_status === 'deposit') {
    deposit_amount = Number(String(body.deposit_amount || '').replace(/\D/g, ''));
    if (!deposit_amount) errors.deposit_amount = 'Ghi số tiền khách đã cọc.';
    else if (deposit_amount >= total) payment_status = 'paid';
  } else if (payment_method === 'cod' && payment_status === 'pending') {
    deposit_amount = payment.depositFor({ goods: subtotal, qty: lines.reduce((t, l) => t + l.qty, 0), total }, s);
  }
  if (payment_status === 'paid') deposit_amount = 0;

  if (Object.keys(errors).length) return { errors, values: { ...f.values, ...body } };

  const by = user && user.name ? user.name : 'Admin';
  const logTime = require('./orders').logTime;
  const order = {
    code: checkout.newCode(),
    user_id: null,
    source,
    created_by: by,
    customer_name, phone, email, address, province,
    is_gift, recipient_name, recipient_phone, recipient_address, delivery_date, delivery_slot,
    note, invoice_info: null, needs_vat: false,
    ...payment.snapshot(payment.accountFromSettings('personal', s)),
    payment_method, payment_status,
    // Chốt tay = đã thống nhất với khách → kho soạn được ngay, không tự hủy khi chưa trả tiền
    status: 'confirmed',
    handled_log: `${logTime()} · Tạo đơn trong admin · ${by}`,
    subtotal, discount: 0, shipping_fee, adjustment: 0, adjustment_note: null,
    vat_fee: 0, vat_fee_percent: null, total,
    deposit_amount,
    coupon_code: null,
  };

  const negative = [];
  await db.transaction(async (trx) => {
    for (const l of lines) {
      await trx('products').where({ id: l.product_id }).update({ stock: trx.raw('stock - ?', [l.qty]), sold: trx.raw('sold + ?', [l.qty]) });
      const p = await trx('products').where({ id: l.product_id }).first('name', 'stock');
      if (p && p.stock < 0) negative.push(p);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const [id] = await trx('orders').insert(order);
        order.id = typeof id === 'object' ? id.id : id;
        break;
      } catch (err) {
        if (attempt < 3 && /unique|duplicate/i.test(err.message)) order.code = checkout.newCode();
        else throw err;
      }
    }
    await trx('order_items').insert(lines.map((l) => ({ ...l, order_id: order.id })));
  });

  // Báo cả nhóm Telegram ngay (kể cả đơn chưa trả tiền: chủ shop đã chốt với khách)
  const tg = require('./telegram-orders');
  tg.sendNewOrder(order, lines).then(() => tg.stockAlertsAfterOrder(lines)).catch(() => {});
  return { order, items: lines, negative };
}

/** Danh sách giỏ cho form: giá lẻ + giá sỉ catalogue (nếu có) để điền sẵn. */
async function productChoices() {
  const { giaSoLuong } = require('./bang-gia');
  const rows = await db('products').where({ is_active: true }).orderBy('name').select('id', 'name', 'slug', 'price', 'stock', 'cost_price', 'cost_price_si');
  return rows.map((p) => {
    const t = giaSoLuong(p.slug);
    return { ...p, t10: t ? t.gia_10_49 : null, t50: t ? t.gia_50_99 : null, t100: t ? t.gia_100_499 : null, ma: t ? t.ma : '' };
  });
}

module.exports = { createStaffOrder, productChoices, readLines, todayVN };
