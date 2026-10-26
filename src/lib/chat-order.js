/**
 * Tạo đơn THẬT từ cuộc trò chuyện Fanpage (khách đã xác nhận trong chat, không qua trang web).
 * Dùng đúng cách tính tiền, giữ kho, cọc COD, báo Telegram như trang thanh toán (routes/checkout.js).
 */
const db = require('../db');
const payment = require('./payment');
const { isHanoi, newCode } = require('../routes/checkout');

const digits = (v) => String(v || '').replace(/\D/g, '');

/** draft: kết quả draftOrder ({ c, priced, gift, method }); input: thông tin AI đưa vào prepare_order/confirm_order. */
async function create({ draft, input, s, psid }) {
  const { priced, gift, method } = draft;
  const order = {
    code: newCode(),
    user_id: null,
    source: 'ai_fb',
    cta: null,
    messenger_psid: psid,
    created_by: null,
    customer_name: String(input.customer_name || '').trim().slice(0, 120),
    phone: digits(input.phone).replace(/^84/, '0'),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email || '').trim()) ? String(input.email).trim().slice(0, 160) : null,
    address: String(gift ? (input.recipient_address || input.address) : input.address).trim().slice(0, 300),
    province: input.province,
    is_gift: gift,
    recipient_name: gift ? String(input.recipient_name).trim().slice(0, 120) : null,
    recipient_phone: gift ? digits(input.recipient_phone).replace(/^84/, '0') : null,
    recipient_address: gift ? String(input.recipient_address).trim().slice(0, 300) : null,
    delivery_date: input.delivery_date,
    delivery_slot: isHanoi(input.province) && ['sang', 'chieu', 'toi'].includes(input.delivery_slot) ? input.delivery_slot : null,
    note: String(input.note || '').trim().slice(0, 500) || null,
    invoice_info: null,
    needs_vat: false, vat_company: null, vat_tax_code: null, vat_address: null, vat_email: null,
    ...payment.snapshot(payment.accountFromSettings('personal', s)),
    payment_method: method, payment_status: 'pending',
    status: 'new',
    subtotal: priced.subtotal, discount: priced.discount, shipping_fee: priced.shippingFee,
    adjustment: 0, adjustment_note: null,
    vat_fee: 0, vat_fee_percent: null,
    total: priced.total,
    coupon_code: priced.coupon ? priced.coupon.code : null,
  };
  order.deposit_amount = method === 'cod'
    ? payment.depositFor({ goods: priced.subtotal - priced.discount, qty: priced.count, total: order.total }, s)
    : 0;
  const items = priced.lines.map((l) => ({
    product_id: l.productId, name: l.name, price: l.unitPrice, qty: l.qty, line_total: l.lineTotal, unit_cost: l.unitCost ?? null,
  }));

  // Khách bấm xác nhận hai lần / AI gọi lặp → trả lại đơn vừa tạo, không tạo đơn thứ hai
  const dup = await db('orders').where({ messenger_psid: psid, phone: order.phone, total: order.total, delivery_date: order.delivery_date })
    .whereNot({ status: 'cancelled' }).andWhere('created_at', '>=', new Date(Date.now() - 15 * 60000)).first().catch(() => null);
  if (dup) return { order: dup, items, until: '', duplicate: true };

  try {
    await db.transaction(async (trx) => {
      for (const l of priced.lines.filter((x) => x.type === 'product')) {
        const n = await trx('products').where({ id: l.productId }).andWhere('stock', '>=', l.qty)
          .update({ stock: trx.raw('stock - ?', [l.qty]), sold: trx.raw('sold + ?', [l.qty]) });
        if (!n) {
          const e = new Error(`“${l.name}” không còn đủ số lượng.`);
          e.status = 409;
          throw e;
        }
      }
      if (order.coupon_code) {
        const n = await trx('coupons').where({ code: order.coupon_code })
          .andWhere((w) => w.whereNull('max_uses').orWhere('used_count', '<', trx.ref('max_uses')))
          .increment('used_count', 1);
        if (!n) {
          const e = new Error('Mã giảm giá vừa hết lượt sử dụng.');
          e.status = 409;
          throw e;
        }
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const [id] = await trx('orders').insert(order);
          order.id = typeof id === 'object' ? id.id : id;
          break;
        } catch (err) {
          if (attempt < 3 && /unique|duplicate/i.test(err.message)) order.code = newCode();
          else throw err;
        }
      }
      await trx('order_items').insert(items.map((i) => ({ ...i, order_id: order.id })));
    });
  } catch (err) {
    if (err.status === 409) return { error: `${err.message} Báo khách thật, gọi search_products để gợi ý giỏ khác còn hàng.` };
    throw err;
  }

  // Báo nhóm Telegram (đơn chuyển khoản chờ tiền chỉ báo khi tiền về; COD báo ngay) — giống trang thanh toán
  const tg = require('./telegram-orders');
  const bank = require('./bank-payments');
  const hold = payment.awaitingMoney({ ...order, status: 'new' }) && bank.enabled();
  (hold ? bank.notifyWaiting(order) : tg.sendNewOrder(order, items)).then(() => tg.stockAlertsAfterOrder(items)).catch(() => {});
  const th = await db('messenger_threads').where({ psid }).first().catch(() => null);
  if (th && th.ad_id) await db('orders').where({ code: order.code }).update({ ad_id: th.ad_id }).catch(() => {});
  if (order.email) {
    require('./notify').sendMail({
      to: order.email,
      subject: `Lunar Lucky đã nhận đơn hàng ${order.code}`,
      template: 'order-confirmation',
      data: { order, items, s, qr: payment.qrForOrder(order, s), payee: payment.accountForOrder(order, s) },
    });
  }
  const stored = await db('orders').where({ id: order.id }).first().catch(() => null);
  return { order: stored || order, items, until: hold ? bank.holdUntil(order, s) : '' };
}

module.exports = { create };
