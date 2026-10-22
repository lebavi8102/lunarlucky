const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { limiterKey } = require('../lib/client-ip');
const db = require('../db');
const cart = require('../lib/cart');
const notify = require('../lib/notify');
const payment = require('../lib/payment');
const bankPayments = require('../lib/bank-payments');
const { Form } = require('../lib/validate');
const { normalizePhone, todayVN, SOURCES } = require('../lib/format');
const { flash } = require('../middleware/locals');

const router = express.Router();

const PROVINCES = [
  'TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế', 'An Giang', 'Bắc Ninh',
  'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh',
  'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Nghệ An', 'Ninh Bình',
  'Phú Thọ', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh', 'Thái Nguyên',
  'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long',
];

const isStaff = (req) => !!(req.session.user && req.session.user.role === 'admin');
const orderLimiter = rateLimit({ ...limiterKey, windowMs: 10 * 60000, limit: 10, skipFailedRequests: true, skip: isStaff, standardHeaders: true, legacyHeaders: false });
const trackLimiter = rateLimit({ ...limiterKey, windowMs: 10 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false });

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

/** Hà Nội giao sớm (Ahamove/tự giao); tỉnh khác đi chuyển phát 2–4 ngày → ngày giao sớm nhất muộn hơn. */
const isHanoi = (province) => /hà nội/i.test(String(province || '').normalize('NFC'));
/**
 * Đơn nhiều giỏ cần thời gian chuẩn bị → ngày giao sớm nhất lùi lại. 3 mức (Cài đặt):
 * mức 1 (mặc định 5–20 giỏ): 2–3 ngày · mức 2 (21–99): 5–10 ngày tùy tình hình thực tế
 * · mức 3 (từ 100): Lunar Lucky xem xét rồi báo lại thời gian chuẩn bị.
 * days = số ngày tối thiểu (chặn chọn ngày sớm hơn), maxDays = để báo khách khoảng thời gian.
 */
function bulkTiers(s) {
  const n = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
  const t1 = { qty: n(s.bulk_min_qty, 5) || 5, days: n(s.bulk_min_days, 2) || 2, kind: 'fixed' };
  t1.maxDays = Math.max(t1.days, n(s.bulk_max_days, 3));
  const tiers = [t1];
  const t2 = { qty: n(s.bulk2_min_qty, 21), days: n(s.bulk2_min_days, 5), kind: 'estimate' };
  t2.maxDays = Math.max(t2.days, n(s.bulk2_max_days, 10));
  if (t2.qty > t1.qty && t2.days > 0) tiers.push(t2);
  const last = tiers[tiers.length - 1];
  const t3 = { qty: n(s.bulk3_min_qty, 100), days: last.days, maxDays: last.maxDays, kind: 'review' };
  if (t3.qty > last.qty) tiers.push(t3);
  return tiers;
}
/** Mức áp dụng cho số giỏ; không truyền qty → mức 1 (để mô tả quy định). */
function bulkRule(s, qty) {
  const tiers = bulkTiers(s);
  if (qty === undefined) return tiers[0];
  return tiers.filter((t) => qty >= t.qty).pop() || null;
}
const daysText = (t) => (t.maxDays > t.days ? `${t.days}–${t.maxDays}` : `${t.days}`);
/** Mô tả 1 mức: "cần 2–3 ngày chuẩn bị" / "… tùy tình hình thực tế" / "Lunar Lucky xem xét và báo lại …". */
function tierText(t) {
  if (t.kind === 'review') return 'Lunar Lucky sẽ xem xét và báo lại thời gian chuẩn bị cụ thể';
  return `cần ${daysText(t)} ngày chuẩn bị${t.kind === 'estimate' ? ' tùy tình hình thực tế' : ''}`;
}
/** Danh sách mức kèm khoảng số giỏ: [{ range: '5–20', text, tier }] — dùng cho FAQ, chính sách, AI. */
function bulkTierList(s) {
  const tiers = bulkTiers(s);
  return tiers.map((t, i) => ({ range: tiers[i + 1] ? `${t.qty}–${tiers[i + 1].qty - 1}` : `từ ${t.qty}`, text: tierText(t), tier: t }));
}
/** Câu báo thời gian chuẩn bị cho đơn qty giỏ ('' nếu đơn ít). */
function bulkNoteFor(s, qty) {
  const t = bulkRule(s, qty);
  if (!t) return '';
  if (t.kind === 'review') return `Đơn ${qty} giỏ: ${tierText(t)} — ngày giao bạn chọn là ngày mong muốn, chuyên viên sẽ gọi xác nhận.`;
  return `Đơn ${qty} giỏ ${tierText(t)}${t.kind === 'estimate' ? ' — Lunar Lucky sẽ gọi xác nhận ngày giao cụ thể' : ''}.`;
}
function minDaysFor(province, s, qty = 0) {
  const hn = Number(s.min_delivery_days) || 1;
  const base = isHanoi(province) ? hn : Math.max(hn, Number(s.province_min_days) || 3);
  const t = bulkRule(s, qty);
  return t ? Math.max(base, t.days) : base;
}
/** Những ngày nghỉ Tết (không giao). */
function tetClosed(s) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  return ok(s.tet_closed_from) && ok(s.tet_closed_to) ? { from: s.tet_closed_from, to: s.tet_closed_to } : null;
}
const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
/** Ngày rơi vào kỳ nghỉ Tết → dời sang ngày mở cửa lại. */
function openDay(d, s) {
  const c = tetClosed(s);
  return c && d >= c.from && d <= c.to ? nextDay(c.to) : d;
}
/** full: Set ngày đã kín lịch giao (giới hạn số giỏ/ngày) → bỏ qua khi gợi ý. */
function dateCtx(s, province, qty = 0, full = new Set()) {
  const minDays = minDaysFor(province, s, qty);
  const free = (d) => { let x = openDay(d, s); for (let i = 0; i < 60 && full.has(x); i++) x = openDay(nextDay(x), s); return x; };
  const quickDates = [];
  for (let d = free(todayVN(minDays)); quickDates.length < 3; d = free(nextDay(d))) quickDates.push(d);
  const c = tetClosed(s);
  const fullList = [...full].filter((d) => d >= todayVN() && d <= todayVN(120)).sort();
  return {
    quickDates,
    minDate: quickDates[0], maxDate: todayVN(180),
    bulkNote: bulkNoteFor(s, qty),
    fullDates: fullList,
    dateRules: { hn: free(todayVN(minDaysFor('Hà Nội', s, qty))), tinh: free(todayVN(minDaysFor('', s, qty))), closedFrom: c ? c.from : '', closedTo: c ? c.to : '', full: fullList },
  };
}
const fullFor = (req, s, qty) => (isStaff(req) ? Promise.resolve(new Set()) : require('../lib/capacity').fullDates(s, qty));

/** Link xem đơn gửi cho khách (đơn đặt hộ qua Zalo/Facebook): có chữ ký nên người khác không đoán được. */
function orderKey(code) {
  return require('crypto').createHmac('sha256', `order-link:${require('../config').sessionSecret}`).update(String(code)).digest('base64url').slice(0, 16);
}
function shareLink(code) {
  return `${require('../config').publicUrl}/don-hang/${code}?k=${orderKey(code)}`;
}

function checkoutDefaults(req) {
  // Nhân viên đặt hộ khách: để trống, không điền thông tin của chính mình
  const u = isStaff(req) ? null : req.session.user;
  return {
    customer_name: u ? u.name : '', phone: u ? u.phone || '' : '', email: u ? u.email : '',
    address: u ? u.address || '' : '', province: 'Hà Nội', payment_method: 'bank', is_gift: false,
  };
}

router.get('/thanh-toan', async (req, res) => {
  const priced = await cart.priceCart(cart.getCart(req));
  if (!priced.lines.length) {
    // Giỏ vừa hết hàng (khách khác mua mất) → mang lời báo về trang giỏ, không để khách thấy giỏ trống không lý do
    if (priced.notices.length) flash(req, 'error', `${priced.notices.join(' ')} Mời bạn chọn mẫu khác hoặc nhắn Lunar Lucky để được gợi ý.`);
    return res.redirect('/gio-hang');
  }
  res.locals.seo.title = 'Thanh toán · Lunar Lucky';
  res.locals.seo.noindex = true;
  // AI tư vấn đã chuẩn bị đơn → điền sẵn, khách chỉ cần kiểm tra và bấm Đặt hàng
  const defaults = { ...checkoutDefaults(req), ...(req.session.aiPrefill || {}) };
  const dc = dateCtx(res.locals.s, defaults.province, priced.count, await fullFor(req, res.locals.s, priced.count));
  res.locals.track.events.push({ name: 'begin_checkout', value: priced.total, items: priced.lines.map((l) => ({ item_id: l.productId || l.key, item_name: l.name, price: l.price, quantity: l.qty })) });
  res.render('shop/checkout', {
    cart: priced, values: { delivery_date: dc.minDate, ...defaults }, errors: {}, fromAi: !!req.session.aiPrefill, provinces: PROVINCES, vatPercent: payment.vatFeePercent(res.locals.s),
    ...dc,
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
  if (!priced.lines.length) {
    // Giỏ vừa hết hàng (khách khác mua mất) → mang lời báo về trang giỏ, không để khách thấy giỏ trống không lý do
    if (priced.notices.length) flash(req, 'error', `${priced.notices.join(' ')} Mời bạn chọn mẫu khác hoặc nhắn Lunar Lucky để được gợi ý.`);
    return res.redirect('/gio-hang');
  }

  const minDays = minDaysFor(req.body.province, res.locals.s, priced.count);
  // Hết phiên, hoặc giỏ vừa thay đổi do hết hàng (khách khác mua mất) → không tự đặt đơn khác với ý khách:
  // hiện lại form với thông tin đã điền + lời báo, khách xem lại rồi bấm Đặt hàng
  if (req.csrfFailed || priced.notices.length) {
    res.status(409);
    res.locals.seo.title = 'Thanh toán · Lunar Lucky';
    res.locals.seo.noindex = true;
    res.locals.flash = req.csrfFailed
      ? { type: 'info', message: 'Trang đã mở khá lâu nên cần xác nhận lại. Thông tin của bạn vẫn còn — kiểm tra rồi bấm "Đặt hàng" lần nữa.' }
      : { type: 'error', message: `Giỏ hàng vừa thay đổi: ${priced.notices.join(' ')} Bạn kiểm tra lại đơn rồi bấm "Đặt hàng" lần nữa.` };
    const values = { ...checkoutDefaults(req), ...req.body };
    delete values._csrf;
    delete values.cart_snapshot;
    return res.render('shop/checkout', {
      cart: priced, values, errors: {}, provinces: PROVINCES, vatPercent: payment.vatFeePercent(res.locals.s),
      ...dateCtx(res.locals.s, req.body.province, priced.count, await fullFor(req, res.locals.s, priced.count)),
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
  if (f.errors.delivery_date && bulkRule(res.locals.s, priced.count) && delivery_date && delivery_date < todayVN(minDays)) {
    f.errors.delivery_date = `${bulkNoteFor(res.locals.s, priced.count).replace(/\.$/, '')} — vui lòng chọn giao từ ${todayVN(minDays).split('-').reverse().join('/')} trở đi.`;
  } else if (f.errors.delivery_date && !isHanoi(req.body.province) && delivery_date && delivery_date < todayVN(minDays)) {
    f.errors.delivery_date = `Giao ngoài Hà Nội đi chuyển phát mất 2–4 ngày — vui lòng chọn từ ${todayVN(minDays).split('-').reverse().join('/')} trở đi.`;
  }
  const closed = tetClosed(res.locals.s);
  if (!f.errors.delivery_date && closed && delivery_date >= closed.from && delivery_date <= closed.to) {
    const vn = (d) => d.split('-').reverse().slice(0, 2).join('/');
    f.errors.delivery_date = `Lunar Lucky nghỉ Tết từ ${vn(closed.from)} đến ${vn(closed.to)}. Vui lòng chọn giao trước ${vn(closed.from)} hoặc từ ${vn(nextDay(closed.to))}.`;
  }
  // Ngày đã kín lịch giao (giới hạn số giỏ/ngày) → mời chọn ngày khác. Chủ shop đặt hộ được nhận vượt.
  if (!f.errors.delivery_date && delivery_date && !isStaff(req)) {
    const full = await fullFor(req, res.locals.s, priced.count);
    if (full.has(delivery_date)) {
      let alt = openDay(nextDay(delivery_date), res.locals.s);
      for (let i = 0; i < 60 && full.has(alt); i++) alt = openDay(nextDay(alt), res.locals.s);
      const vn = (d) => d.split('-').reverse().join('/');
      f.errors.delivery_date = `Ngày ${vn(delivery_date)} Lunar Lucky đã nhận đủ đơn, không kịp giao thêm ${priced.count} giỏ.${alt ? ` Ngày gần nhất còn nhận: ${vn(alt)}.` : ''} Cần đúng ngày này, anh/chị nhắn Zalo để được hỗ trợ.`;
    }
  }
  // Buổi giao: chỉ hẹn được ở Hà Nội (tỉnh khác đi chuyển phát)
  const delivery_slot = isHanoi(req.body.province) ? f.oneOf('delivery_slot', ['', 'sang', 'chieu', 'toi'], '') || null : null;
  const note = f.text('note', { max: 500 });
  // Xuất hóa đơn VAT không đặt trên web nữa: doanh nghiệp nhắn Zalo để báo giá (chủ shop chốt 2026-10-20)
  const needs_vat = false;
  const vat = {};
  let payment_method = f.oneOf('payment_method', ['cod', 'bank'], 'bank');
  if ((needs_vat || is_gift) && payment_method === 'cod') {
    payment_method = 'bank'; // VAT: phải chuyển khoản; gửi tặng: không thu tiền người nhận quà
    f.values.payment_method = 'bank';
  }
  const invoice_info = needs_vat
    ? `${vat.vat_company} · MST ${vat.vat_tax_code} · ${vat.vat_address} · ${vat.vat_email}`.slice(0, 500)
    : null;

  // Đặt hộ: chỉnh giá khi khách đổi món (dương = đắt hơn, âm = rẻ hơn), bắt buộc ghi lý do
  let adjustment = 0;
  let adjustment_note = null;
  if (isStaff(req)) {
    const raw = String(req.body.price_adjustment || '').trim();
    f.values.price_adjustment = raw;
    if (raw) {
      const n = Number(raw.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''));
      const goodsBase = priced.subtotal - priced.discount;
      if (!Number.isFinite(n)) f.errors.price_adjustment = 'Số tiền điều chỉnh không hợp lệ (vd: 150000 hoặc -80000).';
      else if (n < -goodsBase) f.errors.price_adjustment = 'Giảm nhiều hơn tiền hàng — kiểm tra lại số tiền.';
      else if (n > 100000000) f.errors.price_adjustment = 'Số tiền điều chỉnh quá lớn.';
      else adjustment = n;
    }
    adjustment_note = f.text('adjustment_note', { label: 'lý do điều chỉnh', max: 200 }) || null;
    if (adjustment && !adjustment_note) f.errors.adjustment_note = 'Ghi lý do điều chỉnh (vd: đổi rượu vang sang trà Shan tuyết).';
  }

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
      ...dateCtx(res.locals.s, req.body.province, priced.count, await fullFor(req, res.locals.s, priced.count)),
    });
  }

  const order = {
    code: newCode(),
    user_id: req.session.user && !isStaff(req) ? req.session.user.id : null,
    // Kênh: nhân viên chọn khi đặt hộ; khách tự đặt → kênh khách đến (link ?nguon=, Facebook, Zalo…)
    source: isStaff(req) ? f.oneOf('order_source', Object.keys(SOURCES), 'phone') : req.session.aiPrefill ? (req.session.aiPrefill.source === 'ai_fb' ? 'ai_fb' : 'ai') : req.session.source || 'web',
    messenger_psid: !isStaff(req) && req.session.aiPrefill && /^\d{5,40}$/.test(String(req.session.aiPrefill.psid || '')) ? String(req.session.aiPrefill.psid) : null,
    created_by: isStaff(req) ? req.session.user.name : null,
    customer_name, phone, email: email || null, address, province,
    is_gift, recipient_name, recipient_phone, recipient_address, delivery_date, delivery_slot,
    note: note || null, invoice_info,
    needs_vat, vat_company: vat.vat_company || null, vat_tax_code: vat.vat_tax_code || null,
    vat_address: vat.vat_address || null, vat_email: vat.vat_email || null,
    ...payment.snapshot(payment.accountFromSettings('personal', res.locals.s)),
    payment_method, payment_status: 'pending',
    // Chủ shop đặt hộ = đã chốt với khách → bỏ bước "Xác nhận", kho soạn ngay
    // (đơn còn chờ chuyển khoản/cọc giữ "Mới" để vẫn tự hủy khi quá hạn; tiền về sẽ tự xác nhận)
    status: 'new',
    subtotal: priced.subtotal, discount: priced.discount, shipping_fee: priced.shippingFee,
    adjustment, adjustment_note,
    vat_fee: needs_vat ? payment.vatFee(priced.subtotal - priced.discount + adjustment, res.locals.s) : 0,
    vat_fee_percent: needs_vat ? payment.vatFeePercent(res.locals.s) : null,
    total: priced.total + adjustment + (needs_vat ? payment.vatFee(priced.subtotal - priced.discount + adjustment, res.locals.s) : 0),
    coupon_code: priced.coupon ? priced.coupon.code : null,
  };
  order.deposit_amount = order.payment_method === 'cod'
    ? payment.depositFor({ goods: priced.subtotal - priced.discount + adjustment, qty: priced.count, total: order.total }, res.locals.s)
    : 0;
  if (isStaff(req) && !payment.awaitingMoney(order)) {
    order.status = 'confirmed';
    order.handled_log = `${require('../lib/orders').logTime()} · Đã xác nhận (đặt hộ) · ${req.session.user.name}`;
  }
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
  delete req.session.aiPrefill;
  rememberOrder(req, order.code);

  const tgOrders = require('../lib/telegram-orders');
  // Đơn chuyển khoản (đã bật tự xác nhận) chỉ báo nhóm khi nhận được tiền; COD báo ngay
  const holdForPayment = payment.awaitingMoney({ ...order, status: 'new' }) && require('../lib/bank-payments').enabled();
  (holdForPayment ? require('../lib/bank-payments').notifyWaiting(order) : tgOrders.sendNewOrder(order, items))
    .then(() => tgOrders.stockAlertsAfterOrder(items))
    .catch(() => {});
  // Đơn từ cuộc trò chuyện bắt đầu bằng quảng cáo → ghi mã quảng cáo (báo cáo quảng cáo nào ra đơn)
  if (order.messenger_psid) {
    const th = await db('messenger_threads').where({ psid: order.messenger_psid }).first().catch(() => null);
    if (th && th.ad_id) await db('orders').where({ code: order.code }).update({ ad_id: th.ad_id }).catch(() => {});
  }
  // Đơn từ AI Fanpage → xác nhận ngay trên Messenger (khách Fanpage thường không để email)
  if (order.messenger_psid) {
    const until = holdForPayment ? require('../lib/bank-payments').holdUntil(order, res.locals.s) : '';
    require('../lib/messenger').orderUpdate(order, 'placed', { until }).catch(() => {});
  }
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
  // Link có chữ ký (nhân viên gửi cho khách) → mở được, và nhớ luôn để xem lại
  if (req.query && req.query.k && req.query.k === orderKey(order.code)) {
    rememberOrder(req, order.code);
    return true;
  }
  return (req.session.myOrders || []).includes(order.code) || (u && (u.role === 'admin' || u.id === order.user_id));
}

// Trang đơn hỏi định kỳ: đã nhận tiền chưa? (để tự chuyển sang "Đã thanh toán")
router.get('/don-hang/:code/thanh-toan', async (req, res) => {
  const order = await db('orders').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!order || !canView(req, order)) return res.status(404).json({});
  res.set('Cache-Control', 'no-store').json({ paid: ['paid', 'deposit'].includes(order.payment_status), cancelled: order.status === 'cancelled' });
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
  // Đặt hàng thành công (khách tự đặt, không phải đơn đặt hộ) → báo Meta/Google; trùng (tải lại trang) được lọc theo mã đơn
  if (req.query.moi === '1' && !order.created_by) {
    res.locals.track.events.push({ name: 'purchase', id: order.code, transaction_id: order.code, value: Number(order.total), items: items.filter((i) => i.product_id).map((i) => ({ item_id: i.product_id, item_name: i.name, price: i.price, quantity: i.qty })) });
  }
  res.render('shop/order', {
    order, items, qr: qrFor(order, res.locals.s), payee: payment.accountForOrder(order, res.locals.s), isNew: req.query.moi === '1',
    staffShare: isStaff(req) ? shareLink(order.code) : null,
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
  // So 9 số cuối: khách gõ 0912…, +84 912… hay 84912… đều khớp
  const same = (a, b) => { const x = String(a || '').replace(/\D/g, '').slice(-9); return x.length === 9 && x === String(b || '').replace(/\D/g, '').slice(-9); };
  const match = order && (same(order.phone, phone) || same(order.recipient_phone, phone));
  if (!match) {
    res.status(404);
    res.locals.seo.title = 'Tra cứu đơn hàng · Lunar Lucky';
    return res.render('shop/track', {
      values: { code, phone: req.body.phone || '' },
      error: 'Không tìm thấy đơn hàng khớp với mã và số điện thoại này.',
    });
  }
  rememberOrder(req, order.code);
  // Đang đăng nhập + đúng SĐT người đặt → thêm đơn (đặt trước khi có tài khoản) vào lịch sử
  const u = req.session.user;
  if (u && u.role !== 'admin' && !order.user_id && same(order.phone, phone)) {
    await db('orders').where({ id: order.id }).update({ user_id: u.id });
  }
  res.redirect(`/don-hang/${order.code}`);
});

module.exports = router;
module.exports.PROVINCES = PROVINCES;
module.exports.shareLink = shareLink;
module.exports.orderKey = orderKey;
module.exports.dateCtx = dateCtx;
module.exports.bulkRule = bulkRule;
module.exports.bulkTiers = bulkTiers;
module.exports.bulkNoteFor = bulkNoteFor;
module.exports.bulkTierList = bulkTierList;
module.exports.minDaysFor = minDaysFor;
module.exports.isHanoi = isHanoi;
module.exports.tetClosed = tetClosed;
