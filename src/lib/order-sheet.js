/**
 * Bảng đơn hàng cho người cầm tiền + làm hàng (vợ chủ shop, 25/11/2026) — Google Sheets tự cập nhật.
 * Web trả CSV ở đường dẫn bí mật; file Google Sheets dùng =IMPORTDATA(...) kéo về (Google tự làm mới định kỳ).
 *   /bang-don/don.csv?k=…   mỗi dòng 1 đơn: giao hàng, giỏ, tiền đã thu / còn thu, giá nhập, phần chủ shop
 *   /bang-don/tong.csv?k=…  tổng theo ngày giao, theo tuần, và tổng cộng
 * Khóa lưu ở settings.order_sheet_key (đổi khóa trong admin → link cũ hết hiệu lực ngay).
 * Đơn đã hủy / đã hoàn tiền không đưa vào bảng.
 */
const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const { slotLabel } = require('./format');

const STATUS = { new: 'Mới', confirmed: 'Đã xác nhận', packing: 'Đang đóng gói', shipping: 'Đang giao', completed: 'Đã giao xong' };

async function key() {
  let k = (await settings.all()).order_sheet_key;
  if (!k) {
    k = crypto.randomBytes(18).toString('base64url');
    await settings.save({ order_sheet_key: k });
  }
  return k;
}
async function newKey() {
  const k = crypto.randomBytes(18).toString('base64url');
  await settings.save({ order_sheet_key: k });
  return k;
}
async function checkKey(k) {
  const cur = (await settings.all()).order_sheet_key;
  if (!cur || !k) return false;
  const a = Buffer.from(String(k));
  const b = Buffer.from(cur);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function links() {
  const base = `${require('../config').siteUrl}/bang-don`;
  const k = await key();
  return { don: `${base}/don.csv?k=${k}`, tong: `${base}/tong.csv?k=${k}` };
}

// Tiền đã thu: chuyển khoản/cọc đã về, hoặc COD đã giao xong (shipper thu đủ)
function collected(o) {
  const total = Number(o.total);
  if (o.payment_status === 'paid') return total;
  if (o.payment_method === 'cod' && o.status === 'completed') return total;
  if (o.payment_status === 'deposit') return Math.min(total, Number(o.deposit_amount) || 0);
  return 0;
}

async function rows() {
  const min = await require('./supplier').wholesaleMin();
  const orders = await db('orders').whereNot('status', 'cancelled').whereNot('payment_status', 'refunded')
    .orderBy([{ column: 'delivery_date' }, { column: 'id' }]);
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await db('order_items').whereIn('order_id', ids).orderBy('id') : [];
  const by = new Map(ids.map((id) => [id, []]));
  for (const i of items) by.get(i.order_id).push(i);
  return orders.map((o) => {
    const its = by.get(o.id);
    const qty = its.reduce((t, i) => t + i.qty, 0);
    const cost = its.reduce((t, i) => t + (Number(i.unit_cost) || 0) * i.qty, 0);
    const missing = its.some((i) => i.unit_cost == null);
    const total = Number(o.total);
    const got = collected(o);
    const gift = !!o.is_gift;
    return {
      o, qty, cost, missing, total, got, due: total - got,
      cells: [
        o.code,
        String(o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at || '').slice(0, 10),
        String(o.delivery_date || '').slice(0, 10),
        slotLabel(o.delivery_slot) || '',
        qty >= min ? 'Sỉ' : 'Lẻ',
        STATUS[o.status] || o.status,
        o.customer_name || '',
        o.phone || '',
        gift ? o.recipient_name || '' : o.customer_name || '',
        gift ? o.recipient_phone || '' : o.phone || '',
        [gift ? o.recipient_address : o.address, o.province].filter(Boolean).join(', '),
        its.map((i) => `${i.name} × ${i.qty}`).join('; '),
        qty,
        Number(o.subtotal) - Number(o.discount || 0) + Number(o.adjustment || 0),
        Number(o.shipping_fee) || 0,
        total,
        o.payment_method === 'cod' ? 'COD' : 'Chuyển khoản',
        got,
        total - got,
        missing ? '' : cost,
        missing ? '' : total - cost,
        [o.note, gift ? 'GỬI TẶNG (không kèm giá)' : ''].filter(Boolean).join(' | '),
        o.created_by ? `Tạo tay: ${o.created_by}` : o.source || 'web',
      ],
    };
  });
}

const HEAD_DON = ['Mã đơn', 'Ngày đặt', 'Ngày giao', 'Buổi', 'Sỉ/Lẻ', 'Trạng thái', 'Người đặt', 'SĐT người đặt', 'Người nhận', 'SĐT người nhận', 'Địa chỉ giao',
  'Giỏ × số lượng', 'Số giỏ', 'Tiền hàng bán', 'Phí giao', 'Khách trả (tổng)', 'Thanh toán', 'Đã thu', 'Còn phải thu', 'Tiền hàng theo giá nhập', 'Phần chủ shop', 'Ghi chú', 'Nguồn'];

// CSV: ô có dấu phẩy/ngoặc/xuống dòng thì bọc "..."; ô bắt đầu bằng = + - @ thêm ' để Sheets không chạy như công thức
function csv(table) {
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + table.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

async function donCsv() {
  const r = await rows();
  return csv([HEAD_DON, ...r.map((x) => x.cells)]);
}

function weekStart(day) {
  const d = new Date(`${day}T12:00:00+07:00`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

async function tongCsv() {
  const r = await rows();
  const add = (m, k, x) => {
    const a = m.get(k) || { n: 0, q: 0, total: 0, got: 0, due: 0, cost: 0, profit: 0, miss: 0 };
    a.n++; a.q += x.qty; a.total += x.total; a.got += x.got; a.due += x.due;
    if (x.missing) a.miss++; else { a.cost += x.cost; a.profit += x.total - x.cost; }
    m.set(k, a);
  };
  const days = new Map();
  const weeks = new Map();
  const all = new Map();
  for (const x of r) {
    const d = String(x.o.delivery_date || '').slice(0, 10);
    add(days, d, x);
    add(weeks, weekStart(d), x);
    add(all, 'TỔNG CỘNG', x);
  }
  const line = (label, a) => [label, a.n, a.q, a.total, a.got, a.due, a.cost, a.profit, a.miss ? `${a.miss} đơn chưa có giá nhập` : ''];
  const head = ['Kỳ', 'Số đơn', 'Số giỏ', 'Khách trả', 'Đã thu', 'Còn phải thu', 'Tiền hàng theo giá nhập', 'Phần chủ shop', 'Ghi chú'];
  const vn = (d) => d.split('-').reverse().join('/');
  const out = [head];
  for (const [k, a] of all) out.push(line(k, a));
  out.push([], ['THEO TUẦN (Thứ 2 → CN, theo ngày giao)']);
  for (const [k, a] of [...weeks].sort()) {
    const end = new Date(new Date(`${k}T12:00:00+07:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    out.push(line(`Tuần ${vn(k)} – ${vn(end)}`, a));
  }
  out.push([], ['THEO NGÀY GIAO']);
  for (const [k, a] of [...days].sort()) out.push(line(vn(k), a));
  return csv(out);
}

module.exports = { key, newKey, checkKey, links, donCsv, tongCsv, collected };
