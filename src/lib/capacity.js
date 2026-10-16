/**
 * Giới hạn số giỏ giao mỗi ngày (Cài đặt: daily_capacity, 0 = không giới hạn).
 * Sát Tết khách dồn đơn vào vài ngày — kho/shipper chỉ làm được một số giỏ → ngày kín thì không nhận thêm.
 * Tính cả đơn đang chờ tiền (đang giữ chỗ); đơn đã hủy không tính.
 */
const db = require('../db');
const { todayVN } = require('./format');

const capOf = (s) => Math.max(0, Math.floor(Number(s.daily_capacity) || 0));

/** Số giỏ đã nhận theo ngày giao (từ hôm nay). */
async function bookedByDate() {
  const rows = await db('orders')
    .join('order_items', 'order_items.order_id', 'orders.id')
    .whereNot('orders.status', 'cancelled')
    .andWhere('orders.delivery_date', '>=', todayVN())
    .groupBy('orders.delivery_date')
    .select('orders.delivery_date as d')
    .sum({ n: 'order_items.qty' });
  return Object.fromEntries(rows.map((r) => [String(r.d).slice(0, 10), Number(r.n) || 0]));
}

/** Những ngày không nhận thêm được đơn qty giỏ (Set 'YYYY-MM-DD'). */
async function fullDates(s, qty = 1) {
  const cap = capOf(s);
  if (!cap) return new Set();
  const booked = await bookedByDate();
  return new Set(Object.entries(booked).filter(([, n]) => n + Math.max(1, qty) > cap).map(([d]) => d));
}

/** Còn nhận bao nhiêu giỏ cho ngày d (Infinity nếu không giới hạn). */
async function remaining(s, d) {
  const cap = capOf(s);
  if (!cap) return Infinity;
  return Math.max(0, cap - ((await bookedByDate())[d] || 0));
}

module.exports = { capOf, bookedByDate, fullDates, remaining };
