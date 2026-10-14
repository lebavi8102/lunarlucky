const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const cart = require('../lib/cart');
const notify = require('../lib/notify');
const payment = require('../lib/payment');
const bankPayments = require('../lib/bank-payments');
const { Form } = require('../lib/validate');
const { normalizePhone, todayVN } = require('../lib/format');
const { flash } = require('../middleware/locals');

const router = express.Router();

const PROVINCES = [
  'TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế', 'An Giang', 'Bắc Ninh',
  'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh',
  'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Nghệ An', 'Ninh Bình',
  'Phú Thọ', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh', 'Thái Nguyên',
  'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long',
];

const orderLimiter = rateLimit({ windowMs: 10 * 60000, limit: 10, standardHeaders: true, legacyHeaders: false });
const trackLimiter = rateLimit({ windowMs: 10 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false });

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const d = todayVN().replace(/-/g, '').slice(2);
  let r = '';
  for (const b of crypto.randomBytes(4)) r += CODE_CHARS[b % CODE_CHARS.length];
  return `LN${d}${r}`;
}

function rememberOrder(req, code) {
  req.session.myOrders = [...new Set([...(req.session.myOrders || []), code])].slice(-20);
}

function checkoutDefaults(req) {
  const u = req.session.user;
  return {
    customer_name: u ? u.name : '', phone: u ? u.phone || '' : '', email: u ? u.email : '',
    address: u ? u.address || '' : '', province: 'Hà Nội', payment_method: 'bank', is_gift: false,
  };
}

router.get('/thanh-toan', async (req, res) => {
  const priced = await cart.priceCart(cart.getCart(req));
  if (!priced.lines.length) return res.redirect('/gio-hang');
  res.locals.seo.title = 'Thanh toán · Lunar Lucky';
  res.locals.seo.noindex = true;
  const minDays = Number(res.locals.s.min_delivery_days) || 1;
  res.render('shop/checkout', {
    cart: priced, values: { ...checkoutDefaults(req), delivery_date: todayVN(minDays) }, errors: {}, provinces: PROVINCES, vatPercent: payment.vatFeePercent(res.locals.s),
    quickDates: [0, 1, 2].map((i) => todayVN(minDays + i)),
    minDate: todayVN(minDays), maxDate: todayVN(180),
  });
});

router.post('/thanh-toan', orderLimiter, async (req, res) => {
  const c = cart.getCart(req);
  // Phiên bị mất (mở lâu, trình duyệt trong Zalo/Facebook xóa cookie…) → dựng lại giỏ từ bản chụp gửi kèm form
  if (!c.lines.length && req.body.cart_snapshot) {
    try {
      for (const l of JSON.parse(String(req.body.cart_snapshot)).slice(0, 30)) cart.addProduct(c, l.id, l.qty);
    } catch {
      /* bản chụp hỏng: bỏ qua */
    }
  }
  const priced = await cart.priceCart(c);
  if (!priced.lines.length) return res.redirect('/gio-hang');

  const minDays = Number(res.locals.s.min_delivery_days) || 1;
  if (req.csrfFailed) {
    res.status(409);
    res.locals.seo.title = 'Thanh toán · Lunar Lucky';
    res.locals.seo.noindex = true;
    res.locals.flash = { type: 'info', message: 'Trang đã mở khá lâu nên cần xác nhận lại. Thông tin của bạn vẫn còn — kiểm tra rồi bấm "Đặt hàng" lần nữa.' };
    const values = { ...checkoutDefaults(req), ...req.body };
    delete values._csrf;
    delete values.cart_snapshot;
    return res.render('shop/checkout', {
      cart: priced, values, errors: {}, provinces: PROVINCES, vatPercent: payment.vatFeePercent(res.locals.s),
      quickDates: [0, 1, 2].map((i) => todayVN(minDays + i)),
      minDate: todayVN(minDays), maxDate: todayVN(180),
    });
  }
  const f = new Form(req.body);
  const customer_name = f.text('customer_name', { label: 'họ tên', required: true, min: 2, max: 120 });
  const phone = f.phone('phone');
  const email = f.email('email');
  const is_gift = f.bool('is_gift');
  let address = f.text('address', { label: 'địa chỉ nhận hàng', required: !is_gift, min: 6, max: 255 });
  const province = f.oneOf('province', PROVINCES, '');
  if (!province) f.errors.province = 'Vui lòng chọn tỉnh/thành phố.';
  let recipient_name = null;
  let recipient_phone = null;
  let recipient_address = null;
  if (is_gift) {
    recipient_name = f.text('recipient_name', { label: 'tên người nhận', required: true, min: 2, max: 120 });
    recipient_phone = f.phone('recipient_phone', { label: 'số điện thoại người nhận' });
    recipient_address = f.text('recipient_address', { label: 'địa chỉ người nhận', required: true, min: 6 });
    if (!address) address = recipient_address;
  }
  const delivery_date = f.date('delivery_date', { label: 'ngày giao', required: true, minOffset: minDays, maxOffset: 180 });
  const card_message = f.text('card_message', { max: 300 });
  const note = f.text('note', { max: 500 });
  // Xuất hóa đơn VAT → bắt buộc chuyển khoản (thu vào TK bán lẻ; khách muốn TK công ty thì nhắn Zalo)
  const needs_vat = f.bool('needs_vat');
  let vat = {};
  if (needs_vat) {
    vat = {
      vat_company: f.text('vat_company', { label: 'tên công ty', required: true, min: 3, max: 200 }),
      vat_tax_code: f.text('vat_tax_code', { label: 'mã số thuế', required: true, max: 20 }).replace(/\s/g, ''),
      vat_address: f.text('vat_address', { label: 'địa chỉ công ty', required: true, min: 6, max: 255 }),
      vat_email: f.email('vat_email', { required: true }),
    };
    if (vat.vat_tax_code && !/^\d{10}(-?\d{3})?$/.test(vat.vat_tax_code)) {
      f.errors.vat_tax_code = 'Mã số thuế gồm 10 số (hoặc 13 số với chi nhánh).';
    }
  }
  let payment_method = f.oneOf('payment_method', ['cod', 'bank'], 'bank');
  if ((needs_vat || is_gift) && payment_method === 'cod') {
    payment_method = 'bank'; // VAT: phải chuyển khoản; gửi tặng: không thu tiền người nhận quà
    f.values.payment_method = 'bank';
  }
  const invoice_info = needs_vat
    ? `${vat.vat_company} · MST ${vat.vat_tax_code} · ${vat.vat_address} · ${vat.vat_email}`.slice(0, 500)
    : null;

  if (priced.couponError) {
    c.coupon = null;
    flash(req, 'error', priced.couponError);
    return res.redirect('/thanh-toan');
  }

  if (!f.ok) {
    res.status(422);
    res.locals.seo.title = 'Thanh toán · Lunar Lucky';
    res.locals.seo.noindex = true;
    return res.render('shop/checkout', {
      cart: priced, values: f.values, errors: f.errors, provinces: PROVINCES, vatPercent: payment.vatFeePercent(res.locals.s),
      quickDates: [0, 1, 2].map((i) => todayVN(minDays + i)),
      minDate: todayVN(minDays), maxDate: todayVN(180),
    });
  }

  const order = {
    code: newCode(),
    user_id: req.session.user ? req.session.user.id : null,
    customer_name, phone, email: email || null, address, province,
    is_gift, recipient_name, recipient_phone, recipient_address, delivery_date,
    card_message: card_message || null, note: note || null, invoice_info,
    needs_vat, vat_company: vat.vat_company || null, vat_tax_code: vat.vat_tax_code || null,
    vat_address: vat.vat_address || null, vat_email: vat.vat_email || null,
    ...payment.snapshot(payment.accountFromSettings('personal', res.locals.s)),
    payment_method, payment_status: 'pending', status: 'new',
    subtotal: priced.subtotal, discount: priced.discount, shipping_fee: priced.shippingFee,
    vat_fee: needs_vat ? payment.vatFee(priced.subtotal - priced.discount, res.locals.s) : 0,
    vat_fee_percent: needs_vat ? payment.vatFeePercent(res.locals.s) : null,
    total: priced.total + (needs_vat ? payment.vatFee(priced.subtotal - priced.discount, res.locals.s) : 0),
    coupon_code: priced.coupon ? priced.coupon.code : null,
  };
  const items = priced.lines.map((l) => ({
    product_id: l.productId,
    name: l.name,
    price: l.unitPrice,
    qty: l.qty,
    line_total: l.lineTotal,
    unit_cost: l.unitCost ?? null, // giá vốn lúc đặt — để báo cáo lợi nhuận
  }));

  try {
    await db.transaction(async (trx) => {
      for (const l of priced.lines.filter((x) => x.type === 'product')) {
        const n = await trx('products')
          .where({ id: l.productId })
          .andWhere('stock', '>=', l.qty)
          .update({ stock: trx.raw('stock - ?', [l.qty]), sold: trx.raw('sold + ?', [l.qty]) });
        if (!n) {
          const e = new Error(`“${l.name}” không còn đủ số lượng. Vui lòng kiểm tra lại giỏ hàng.`);
          e.status = 409;
          throw e;
        }
      }
      if (order.coupon_code) {
        const n = await trx('coupons')
          .where({ code: order.coupon_code })
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
    if (err.status === 409) {
      if (/Mã giảm giá/.test(err.message)) c.coupon = null;
      flash(req, 'error', err.message);
      return res.redirect('/gio-hang');
    }
    throw err;
  }

  req.session.cart = { lines: [], coupon: null };
  rememberOrder(req, order.code);

  const tgOrders = require('../lib/telegram-orders');
  // Đơn chuyển khoản (đã bật tự xác nhận) chỉ báo nhóm khi nhận được tiền; COD báo ngay
  const holdForPayment = order.payment_method === 'bank' && require('../lib/bank-payments').enabled();
  (holdForPayment ? require('../lib/bank-payments').notifyWaiting(order) : tgOrders.sendNewOrder(order, items))
    .then(() => tgOrders.stockAlertsAfterOrder(items))
    .catch(() => {});
  if (order.email) {
    notify.sendMail({
      to: order.email,
      subject: `Lunar Lucky đã nhận đơn hàng ${order.code}`,
      template: 'order-confirmation',
      data: { order, items, s: res.locals.s, qr: qrFor(order, res.locals.s), payee: payment.accountForOrder(order, res.locals.s) },
    });
  }
  res.redirect(`/don-hang/${order.code}?moi=1`);
});

function qrFor(order, s) {
  return payment.qrForOrder(order, s);
}

function canView(req, order) {
  const u = req.session.user;
  return (req.session.myOrders || []).includes(order.code) || (u && (u.role === 'admin' || u.id === order.user_id));
}

// Trang đơn hỏi định kỳ: đã nhận tiền chưa? (để tự chuyển sang "Đã thanh toán")
router.get('/don-hang/:code/thanh-toan', async (req, res) => {
  const order = await db('orders').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!order || !canView(req, order)) return res.status(404).json({});
  res.set('Cache-Control', 'no-store').json({ paid: order.payment_status === 'paid', cancelled: order.status === 'cancelled' });
});

// Ảnh QR tải về máy: khách đặt bằng điện thoại lưu ảnh → mở app ngân hàng → quét từ thư viện ảnh
router.get('/don-hang/:code/qr.png', async (req, res, next) => {
  const order = await db('orders').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!order || !canView(req, order)) return next();
  const url = qrFor(order, res.locals.s);
  if (!url) return next();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`VietQR ${r.status}`);
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="QR-${order.code}.png"`,
      'Cache-Control': 'private, max-age=600',
    });
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error('[qr] tải ảnh lỗi:', err.message);
    res.redirect(url); // dự phòng: mở thẳng ảnh gốc, khách nhấn giữ để lưu
  }
});

router.get('/don-hang/:code', async (req, res, next) => {
  const code = String(req.params.code).toUpperCase();
  const order = await db('orders').where({ code }).first();
  if (!order) return next();
  if (!canView(req, order)) return res.redirect(`/tra-cuu-don?ma=${encodeURIComponent(code)}`);
  const items = await db('order_items').where({ order_id: order.id });
  res.locals.seo.title = `Đơn hàng ${order.code} · Lunar Lucky`;
  res.locals.seo.noindex = true;
  res.render('shop/order', {
    order, items, qr: qrFor(order, res.locals.s), payee: payment.accountForOrder(order, res.locals.s), isNew: req.query.moi === '1',
    autoConfirm: bankPayments.enabled(), holdHours: bankPayments.holdHours(res.locals.s),
  });
});

router.get('/tra-cuu-don', (req, res) => {
  res.locals.seo.title = 'Tra cứu đơn hàng · Lunar Lucky';
  res.render('shop/track', { values: { code: String(req.query.ma || '').slice(0, 20), phone: '' }, error: null });
});

router.post('/tra-cuu-don', trackLimiter, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 20);
  const phone = normalizePhone(req.body.phone);
  const order = code && phone ? await db('orders').where({ code }).first() : null;
  const match = order && (normalizePhone(order.phone) === phone || normalizePhone(order.recipient_phone) === phone);
  if (!match) {
    res.status(404);
    res.locals.seo.title = 'Tra cứu đơn hàng · Lunar Lucky';
    return res.render('shop/track', {
      values: { code, phone: req.body.phone || '' },
      error: 'Không tìm thấy đơn hàng khớp với mã và số điện thoại này.',
    });
  }
  rememberOrder(req, order.code);
  res.redirect(`/don-hang/${order.code}`);
});

module.exports = router;
module.exports.PROVINCES = PROVINCES;
