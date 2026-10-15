/**
 * Xuất dữ liệu ra Excel để chủ shop tự lưu giữ (ngoài bản sao lưu tự động của Aiven).
 * Sheet: Đơn hàng · Chi tiết đơn · Khách hàng · Sản phẩm · Chi phí
 */
const db = require('../db');
const { buildXlsx } = require('./xlsx');
const { ORDER_STATUS, PAYMENT_STATUS } = require('./orders');
const { toDate } = require('./format');

const vnTime = (d) => {
  const date = toDate(d);
  if (!date || Number.isNaN(date.getTime())) return d ? String(d) : '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};
const yesNo = (v) => (v ? 'Có' : '');
const PAY = { bank: 'Chuyển khoản', cod: 'COD' };

const ORDER_COLUMNS = [
  { header: 'Mã đơn', key: 'code', width: 16 },
  { header: 'Ngày đặt', key: 'created', width: 17 },
  { header: 'Khách hàng', key: 'customer_name', width: 22 },
  { header: 'Điện thoại', key: 'phone', width: 13 },
  { header: 'Email', key: 'email', width: 24 },
  { header: 'Khu vực', key: 'province', width: 16 },
  { header: 'Địa chỉ', key: 'address', width: 32 },
  { header: 'Tặng người khác', key: 'gift', width: 9 },
  { header: 'Người nhận', key: 'recipient_name', width: 20 },
  { header: 'SĐT người nhận', key: 'recipient_phone', width: 13 },
  { header: 'Địa chỉ người nhận', key: 'recipient_address', width: 32 },
  { header: 'Ngày giao', key: 'delivery_date', width: 11 },
  { header: 'Thanh toán', key: 'pay', width: 13 },
  { header: 'Trạng thái thanh toán', key: 'pay_status', width: 16 },
  { header: 'Ngày nhận tiền', key: 'paid', width: 17 },
  { header: 'Trạng thái đơn', key: 'status_label', width: 14 },
  { header: 'Tạm tính', key: 'subtotal', type: 'money', width: 13 },
  { header: 'Giảm giá', key: 'discount', type: 'money', width: 11 },
  { header: 'Mã giảm giá', key: 'coupon_code', width: 12 },
  { header: 'Phí giao', key: 'shipping_fee', type: 'money', width: 11 },
  { header: 'Phí VAT', key: 'vat_fee', type: 'money', width: 11 },
  { header: 'Tổng cộng', key: 'total', type: 'money', width: 13 },
  { header: 'Tiền cọc', key: 'deposit_amount', type: 'money', width: 12 },
  { header: 'Xuất VAT', key: 'vat', width: 8 },
  { header: 'Tên công ty', key: 'vat_company', width: 26 },
  { header: 'Mã số thuế', key: 'vat_tax_code', width: 13 },
  { header: 'Địa chỉ công ty', key: 'vat_address', width: 30 },
  { header: 'Email nhận hóa đơn', key: 'vat_email', width: 24 },
  { header: 'Lời chúc trên thiệp', key: 'card_message', width: 34 },
  { header: 'Ghi chú khách', key: 'note', width: 30 },
  { header: 'Ghi chú nội bộ', key: 'admin_note', width: 30 },
];

async function orderSheets() {
  const orders = await db('orders').orderBy('id', 'desc');
  const rows = orders.map((o) => ({
    ...o,
    created: vnTime(o.created_at),
    paid: vnTime(o.paid_at),
    gift: yesNo(o.is_gift),
    pay: PAY[o.payment_method] || o.payment_method,
    pay_status: PAYMENT_STATUS[o.payment_status] || o.payment_status,
    status_label: ORDER_STATUS[o.status] || o.status,
    vat: yesNo(o.needs_vat),
  }));
  const codeById = new Map(orders.map((o) => [o.id, o.code]));
  const items = await db('order_items as i').leftJoin('products as p', 'p.id', 'i.product_id').select('i.*', 'p.sku').orderBy('i.order_id', 'desc');
  const itemRows = items.map((i) => ({ ...i, code: codeById.get(i.order_id) || '', cost_total: i.unit_cost == null ? null : i.unit_cost * i.qty }));
  return [
    { name: 'Đơn hàng', columns: ORDER_COLUMNS, rows },
    {
      name: 'Chi tiết đơn',
      columns: [
        { header: 'Mã đơn', key: 'code', width: 16 },
        { header: 'Mã SP', key: 'sku', width: 9 },
        { header: 'Sản phẩm', key: 'name', width: 30 },
        { header: 'Đơn giá', key: 'price', type: 'money', width: 12 },
        { header: 'Số lượng', key: 'qty', type: 'number', width: 9 },
        { header: 'Thành tiền', key: 'line_total', type: 'money', width: 13 },
        { header: 'Giá vốn / giỏ', key: 'unit_cost', type: 'money', width: 12 },
        { header: 'Tổng giá vốn', key: 'cost_total', type: 'money', width: 13 },
      ],
      rows: itemRows,
    },
    { name: 'Khách hàng', ...(await customerSheet(orders)) },
  ];
}

/** Khách hàng gộp theo số điện thoại (phần lớn khách đặt không cần tài khoản) + khách có tài khoản. */
/** Gom đơn theo SĐT → mỗi người mua 1 dòng (kể cả khách không tạo tài khoản). */
async function customerRows(orders) {
  const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^84/, '0');
  const map = new Map();
  for (const o of [...orders].sort((a, b) => a.id - b.id)) {
    const k = digits(o.phone) || `email:${o.email || o.id}`;
    const c = map.get(k) || { phone: o.phone, orders: 0, spent: 0, first: o.created_at, cancelled: 0 };
    c.name = o.customer_name;
    c.email = o.email || c.email;
    c.address = o.address ? `${o.address}${o.province ? ', ' + o.province : ''}` : c.address;
    c.last = o.created_at;
    c.company = o.vat_company || c.company;
    if (o.status === 'cancelled') c.cancelled += 1;
    else {
      c.orders += 1;
      c.spent += Number(o.total) || 0;
    }
    if (o.user_id) c.account = true;
    map.set(k, c);
  }
  const users = await db('users').where({ role: 'customer' });
  for (const u of users) {
    const k = digits(u.phone) || `email:${u.email}`;
    const c = map.get(k) || { phone: u.phone, name: u.name, orders: 0, spent: 0, cancelled: 0, first: u.created_at };
    c.email = c.email || u.email;
    c.account = true;
    map.set(k, c);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}

async function customerSheet(orders) {
  const rows = (await customerRows(orders))
    .map((c) => ({ ...c, first: vnTime(c.first), last: vnTime(c.last), account: yesNo(c.account) }));
  return {
    columns: [
      { header: 'Khách hàng', key: 'name', width: 22 },
      { header: 'Điện thoại', key: 'phone', width: 13 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Địa chỉ gần nhất', key: 'address', width: 36 },
      { header: 'Công ty (VAT)', key: 'company', width: 26 },
      { header: 'Số đơn', key: 'orders', type: 'number', width: 8 },
      { header: 'Tổng đã mua', key: 'spent', type: 'money', width: 14 },
      { header: 'Đơn hủy', key: 'cancelled', type: 'number', width: 8 },
      { header: 'Đơn đầu tiên', key: 'first', width: 17 },
      { header: 'Đơn gần nhất', key: 'last', width: 17 },
      { header: 'Có tài khoản', key: 'account', width: 10 },
    ],
    rows,
  };
}

async function productSheet() {
  const cats = Object.fromEntries((await db('categories')).map((c) => [c.id, c.name]));
  const rows = (await db('products').orderBy('sort').orderBy('id')).map((p) => ({ ...p, category: cats[p.category_id] || '', active: yesNo(p.is_active) }));
  return {
    name: 'Sản phẩm',
    columns: [
      { header: 'Mã SP', key: 'sku', width: 9 },
      { header: 'Tên sản phẩm', key: 'name', width: 30 },
      { header: 'Danh mục', key: 'category', width: 18 },
      { header: 'Giá bán', key: 'price', type: 'money', width: 12 },
      { header: 'Giá gốc', key: 'compare_price', type: 'money', width: 12 },
      { header: 'Giá vốn', key: 'cost_price', type: 'money', width: 12 },
      { header: 'Tồn kho', key: 'stock', type: 'number', width: 9 },
      { header: 'Đã bán', key: 'sold', type: 'number', width: 9 },
      { header: 'Hiển thị', key: 'active', width: 9 },
      { header: 'Thành phần', key: 'contents', width: 40 },
    ],
    rows,
  };
}

async function expenseSheet() {
  return {
    name: 'Chi phí',
    columns: [
      { header: 'Ngày', key: 'spent_on', width: 11 },
      { header: 'Loại chi phí', key: 'category', width: 26 },
      { header: 'Số tiền', key: 'amount', type: 'money', width: 13 },
      { header: 'Ghi chú', key: 'note', width: 40 },
    ],
    rows: await db('expenses').orderBy('spent_on', 'desc'),
  };
}

/** kind: 'tat-ca' | 'don-hang' | 'khach-hang' */
async function exportXlsx(kind = 'tat-ca') {
  const [orders, items, customers] = await orderSheets();
  if (kind === 'don-hang') return buildXlsx([orders, items]);
  if (kind === 'khach-hang') return buildXlsx([customers]);
  return buildXlsx([orders, items, customers, await productSheet(), await expenseSheet()]);
}

module.exports = { exportXlsx, vnTime, customerRows };
