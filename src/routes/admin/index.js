const express = require('express');
const db = require('../../db');
const settings = require('../../lib/settings');
const notify = require('../../lib/notify');
const resource = require('./resource');
const { requireAdmin } = require('../../middleware/auth');
const { flash } = require('../../middleware/locals');
const { toDate, todayVN } = require('../../lib/format');

const router = express.Router();

router.use(requireAdmin, (req, res, next) => {
  res.locals.seo.noindex = true;
  res.locals.layout = 'admin';
  next();
});

const { ORDER_STATUS, PAYMENT_STATUS, loadOrder, updateOrder } = require('../../lib/orders');
// Chờ tiền: chuyển khoản chưa trả, hoặc COD chờ cọc
const awaiting = (w) => w.where('payment_status', 'pending').andWhere((x) => x.where('payment_method', 'bank').orWhere('deposit_amount', '>', 0));
// Cần xử lý: đơn mới đã sẵn sàng (COD không cọc, hoặc đã trả/đã cọc)
const readyNew = (w) => w.where({ status: 'new' }).andWhere((x) => x.whereIn('payment_status', ['paid', 'deposit']).orWhere((y) => y.where({ payment_method: 'cod', deposit_amount: 0 })));
const QUOTE_STATUS = { new: 'Mới', contacted: 'Đã liên hệ', won: 'Chốt đơn', lost: 'Không thành' };

router.use((req, res, next) => {
  Object.assign(res.locals, { ORDER_STATUS, PAYMENT_STATUS, QUOTE_STATUS });
  next();
});

/* ---------- Tổng quan ---------- */
router.get('/', async (req, res) => {
  const since = new Date(Date.now() - 32 * 86400000); // đủ cả tháng này (tháng 31 ngày)
  const recentAll = await db('orders').where('created_at', '>=', since).select('total', 'status', 'created_at', 'payment_method', 'payment_status', 'deposit_amount', 'source');
  const { awaitingMoney } = require('../../lib/payment');
  const days = [];
  for (let i = 13; i >= 0; i--) days.push({ day: todayVN(-i), total: 0, count: 0 });
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(toDate(d));
  const today = todayVN();
  const monthPrefix = today.slice(0, 7);
  let revenueToday = 0;
  let revenueMonth = 0;
  let ordersToday = 0;
  let waitingToday = 0;
  const byChannel = {}; // 30 ngày gần nhất, đơn đã chốt (không tính hủy / chờ tiền)
  for (const o of recentAll) {
    if (o.status === 'cancelled') continue;
    // Đơn chưa trả tiền/chưa cọc có thể tự hủy → chưa tính là doanh thu
    if (awaitingMoney(o)) {
      if (dayKey(o.created_at) === today) waitingToday += o.total;
      continue;
    }
    const k = dayKey(o.created_at);
    const d = days.find((x) => x.day === k);
    if (d) {
      d.total += o.total;
      d.count += 1;
    }
    if (k === today) {
      revenueToday += o.total;
      ordersToday += 1;
    }
    if (k.startsWith(monthPrefix)) revenueMonth += o.total;
    const src = o.source || 'web';
    const c = byChannel[src] || (byChannel[src] = { n: 0, total: 0 });
    c.n += 1;
    c.total += o.total;
  }
  const [newOrders, unpaidBank, newQuotes, lowStock, recent, topProducts] = await Promise.all([
    db('orders').where(readyNew).count({ n: '*' }).first(),
    db('orders').where(awaiting).whereNot({ status: 'cancelled' }).count({ n: '*' }).first(),
    db('quotes').where({ status: 'new' }).count({ n: '*' }).first(),
    settings.all().then((s) => db('products').where({ is_active: true }).andWhere('stock', '<=', Number(s.low_stock_threshold) || 5).orderBy('stock').limit(6)),
    db('orders').orderBy('id', 'desc').limit(8),
    db('products').orderBy('sold', 'desc').limit(5),
  ]);
  res.render('admin/dashboard', {
    title: 'Tổng quan',
    stats: {
      revenueToday, revenueMonth, ordersToday, waitingToday,
      newOrders: Number(newOrders.n), unpaidBank: Number(unpaidBank.n), newQuotes: Number(newQuotes.n),
    },
    days, lowStock, recent, topProducts, byChannel,
  });
});

/* ---------- Đơn hàng ---------- */
router.get('/don-hang', async (req, res) => {
  const status = ORDER_STATUS[req.query.status] ? req.query.status : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const page = Math.max(1, Number(req.query.trang) || 1);
  let query = db('orders');
  if (status) query = query.where({ status });
  if (req.query.chua_tt) query = query.where(awaiting).whereNot('status', 'cancelled');
  // Cần xử lý: đơn mới đã sẵn sàng (COD hoặc đã thanh toán) — không lẫn đơn chuyển khoản chưa trả tiền
  if (req.query.can_xu_ly) query = query.where(readyNew);
  const ngay = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.ngay || '')) ? String(req.query.ngay) : '';
  const nguon = require('../../lib/format').SOURCES[req.query.nguon] ? String(req.query.nguon) : '';
  if (nguon === 'web') query = query.where((w) => w.where({ source: 'web' }).orWhereNull('source'));
  else if (nguon) query = query.where({ source: nguon });
  if (ngay) query = query.where({ delivery_date: ngay });
  if (q) query = query.andWhere((w) => w.where('code', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`).orWhere('customer_name', 'like', `%${q}%`));
  const [{ n }] = await query.clone().count({ n: '*' });
  const orders = await query.orderBy('id', 'desc').limit(30).offset((page - 1) * 30);
  const [{ n: todo }] = await db('orders').where(readyNew).count({ n: '*' });
  const counts = Object.fromEntries(
    (await db('orders').select('status').count({ n: '*' }).groupBy('status')).map((r) => [r.status, Number(r.n)]),
  );
  res.render('admin/orders', {
    title: 'Đơn hàng', orders, status, q, page, pages: Math.max(1, Math.ceil(Number(n) / 30)), counts,
    unpaidOnly: !!req.query.chua_tt, todoOnly: !!req.query.can_xu_ly, todo: Number(todo), ngay, nguon,
  });
});

router.get('/don-hang/:id', async (req, res, next) => {
  const data = await loadOrder(req.params.id);
  if (!data) return next();
  const payment = require('../../lib/payment');
  const s = await settings.all();
  res.render('admin/order', {
    title: `Đơn ${data.order.code}`, ...data, payee: payment.accountForOrder(data.order, s),
    companyReady: payment.isConfigured(payment.accountFromSettings('company', s)),
  });
});

router.get('/don-hang/:id/in', async (req, res, next) => {
  const data = await loadOrder(req.params.id);
  if (!data) return next();
  res.render('admin/order-print', { ...data });
});

router.post('/don-hang/:id', async (req, res, next) => {
  const r = await updateOrder(
    req.params.id,
    {
      status: req.body.status,
      payment_status: req.body.payment_status,
      admin_note: String(req.body.admin_note || '').slice(0, 500) || null,
    },
    { by: req.session.user.name },
  );
  if (!r) return next();
  require('../../lib/telegram-orders').refreshOrderMessage(r.order.id);
  if (r.negativeStock && r.negativeStock.length) {
    flash(req, 'error', `Đã khôi phục đơn nhưng kho không đủ: ${r.negativeStock.map((p) => `${p.name} còn ${p.stock}`).join(', ')}. Kiểm hàng hoặc nhập thêm.`);
  } else flash(req, 'success', 'Đã cập nhật đơn hàng.');
  res.redirect(`/admin/don-hang/${r.order.id}`);
});

// Sửa thông tin giao: ngày, buổi, địa chỉ, SĐT, lời chúc…
router.post('/don-hang/:id/giao', async (req, res, next) => {
  const order = await db('orders').where({ id: Number(req.params.id) }).first();
  if (!order) return next();
  const { Form } = require('../../lib/validate');
  const f = new Form(req.body);
  const changes = {
    delivery_date: f.date('delivery_date', { label: 'ngày giao', required: true, minOffset: -30, maxOffset: 365 }),
    delivery_slot: f.oneOf('delivery_slot', ['', 'sang', 'chieu', 'toi'], ''),
    card_message: f.text('card_message', { max: 300 }),
    note: f.text('note', { max: 500 }),
  };
  if (order.is_gift) {
    changes.recipient_name = f.text('recipient_name', { label: 'tên người nhận', required: true, min: 2, max: 120 });
    changes.recipient_phone = f.phone('recipient_phone', { label: 'SĐT người nhận' });
    changes.recipient_address = f.text('recipient_address', { label: 'địa chỉ người nhận', required: true, min: 6, max: 300 });
  } else {
    changes.phone = f.phone('phone');
    changes.address = f.text('address', { label: 'địa chỉ', required: true, min: 6, max: 300 });
  }
  if (!f.ok) {
    flash(req, 'error', Object.values(f.errors)[0]);
    return res.redirect(`/admin/don-hang/${order.id}#sua-giao`);
  }
  const r = await require('../../lib/orders').updateDelivery(order.id, changes, { by: req.session.user.name });
  flash(req, 'success', r.changed ? `Đã lưu: ${r.events.join('; ')}` : 'Không có gì thay đổi.');
  res.redirect(`/admin/don-hang/${order.id}`);
});

router.post('/don-hang/:id/tai-khoan', async (req, res, next) => {
  const payment = require('../../lib/payment');
  const order = await db('orders').where({ id: Number(req.params.id) }).first();
  if (!order) return next();
  const type = req.body.pay_account === 'company' ? 'company' : 'personal';
  const acc = payment.accountFromSettings(type, await settings.all());
  if (!payment.isConfigured(acc)) {
    flash(req, 'error', `Chưa cài đặt đủ ${type === 'company' ? 'tài khoản công ty' : 'tài khoản bán lẻ'} trong Cài đặt.`);
    return res.redirect(`/admin/don-hang/${order.id}`);
  }
  const label = type === 'company' ? 'Đổi sang TK công ty' : 'Đổi sang TK bán lẻ';
  const log = [order.handled_log, `${require('../../lib/orders').logTime()} · ${label} · ${req.session.user.name}`]
    .filter(Boolean)
    .join('\n');
  await db('orders').where({ id: order.id }).update({ ...payment.snapshot(acc), handled_log: log, updated_at: new Date() });
  require('../../lib/telegram-orders').refreshOrderMessage(order.id);
  flash(req, 'success', `${label}. Trang đơn của khách đã hiện mã QR mới — hãy gửi lại link đơn cho khách.`);
  res.redirect(`/admin/don-hang/${order.id}`);
});

/* ---------- Báo giá doanh nghiệp ---------- */
router.get('/bao-gia', async (req, res) => {
  const quotes = await db('quotes').orderBy('id', 'desc').limit(200);
  res.render('admin/quotes', { title: 'Báo giá doanh nghiệp', quotes });
});

router.post('/bao-gia/:id', async (req, res) => {
  const status = QUOTE_STATUS[req.body.status] ? req.body.status : 'new';
  await db('quotes').where({ id: Number(req.params.id) }).update({
    status, admin_note: String(req.body.admin_note || '').slice(0, 500) || null, updated_at: new Date(),
  });
  flash(req, 'success', 'Đã cập nhật yêu cầu báo giá.');
  res.redirect('/admin/bao-gia');
});

/* ---------- Khách hàng ---------- */
router.get('/khach-hang', async (req, res) => {
  // Người đã mua (gom theo SĐT) — phần lớn khách đặt không cần tài khoản
  const orders = await db('orders').select('id', 'phone', 'customer_name', 'email', 'address', 'province', 'created_at', 'vat_company', 'status', 'total', 'user_id');
  let rows = await require('../../lib/backup').customerRows(orders);
  const total = rows.length;
  const repeat = rows.filter((c) => c.orders >= 2).length;
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q) {
    const fold = require('../../lib/search').fold;
    const f = fold(q);
    const d = q.replace(/\D/g, '');
    rows = rows.filter((c) => fold(`${c.name} ${c.email || ''} ${c.company || ''}`).includes(f) || (d.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(d)));
  }
  const sort = ['chi-tieu', 'gan-day', 'so-don'].includes(req.query.sap_xep) ? req.query.sap_xep : 'chi-tieu';
  const t = (x) => new Date(x || 0).getTime();
  if (sort === 'gan-day') rows.sort((a, b) => t(b.last) - t(a.last));
  if (sort === 'so-don') rows.sort((a, b) => b.orders - a.orders || b.spent - a.spent);
  res.render('admin/customers', { title: 'Khách hàng', rows: rows.slice(0, 300), total, repeat, q, sort });
});

/* ---------- Cài đặt ---------- */
const SETTING_GROUPS = [
  ['Thông tin cửa hàng', [
    ['shop_name', 'Tên cửa hàng'], ['shop_tagline', 'Khẩu hiệu'], ['shop_phone', 'Hotline'],
    ['shop_email', 'Email'], ['shop_hours', 'Giờ làm việc'],
  ]],
  ['Kênh liên hệ', [
    ['fanpage_url', 'Link fanpage Facebook'], ['messenger_url', 'Link Messenger (m.me/...)'], ['zalo_url', 'Link Zalo (zalo.me/...)'],
  ]],
  ['Tài khoản bán lẻ (cá nhân)', [
    ['bank_id', 'Ngân hàng', 'bank'], ['bank_name', 'Tên ngân hàng hiển thị cho khách'],
    ['bank_account', 'Số tài khoản'], ['bank_holder', 'Chủ tài khoản (IN HOA, không dấu)'],
  ], 'qr:bank'],
  ['Thanh toán & hóa đơn VAT', [
    ['payment_hold_hours', 'Giữ hàng cho đơn chuyển khoản / chờ cọc chưa trả tiền (giờ) — quá hạn tự hủy, trả lại kho. Chỉ áp dụng khi đã nối SePay'],
    ['cod_deposit_percent', 'Đơn COD cần cọc: tỉ lệ cọc (%) — để 0 nếu không thu cọc'],
    ['cod_deposit_min_total', 'Đơn COD cần cọc khi tiền hàng TRÊN (₫)'],
    ['cod_deposit_min_qty', 'Hoặc khi số giỏ TỪ (giỏ trở lên)'],
    ['vat_fee_percent', 'Phí xuất hóa đơn VAT khách chịu (%) — cộng vào tổng đơn, VD: 11. Tiền thu vào tài khoản bán lẻ ở trên'],
  ]],
  ['Giao hàng', [
    ['shipping_fee', 'Phí giao hàng (₫)'], ['free_ship_threshold', 'Miễn phí giao cho đơn từ (₫)'],
    ['min_delivery_days', 'Số ngày chuẩn bị tối thiểu trước khi giao'],
    ['province_min_days', 'Số ngày tối thiểu khi giao ngoài Hà Nội (chuyển phát)'],
    ['order_deadline', 'Hạn chót nhận đơn giao trước Tết (YYYY-MM-DD, vd 2027-01-30) — để trống thì không hiện'],
  ]],
  ['Kho hàng', [
    ['low_stock_threshold', 'Cảnh báo "sắp hết" trên Telegram khi tồn kho còn ≤ (giỏ)'],
    ['ops_digest', 'Bot tự nhắc việc: tin sáng (việc hôm nay), nhắc đơn quá 2 giờ chưa xác nhận, tin tối (chốt ngày + tiền COD) — 1 = bật, 0 = tắt'],
    ['backup_email', 'Tự gửi file sao lưu Excel vào email cửa hàng lúc 23h mỗi ngày — 1 = bật, 0 = tắt'],
    ['ops_morning_hour', 'Giờ gửi tin sáng (0–23)'], ['ops_evening_hour', 'Giờ gửi tin chốt ngày (0–23)'],
    ['telegram_admin_only', 'Chỉ QUẢN TRỊ VIÊN nhóm Telegram được hủy đơn / xác nhận đã nhận tiền (1 = bật, 0 = ai trong nhóm cũng bấm được)'],
  ]],
  ['Trang chủ', [
    ['announcement', 'Dòng thông báo trên cùng'], ['hero_eyebrow', 'Dòng nhỏ trên tiêu đề'],
    ['hero_title', 'Tiêu đề lớn'], ['hero_subtitle', 'Mô tả dưới tiêu đề', 'textarea'],
  ]],
];

router.get('/cai-dat', async (req, res) => {
  res.render('admin/settings', {
    title: 'Cài đặt', groups: SETTING_GROUPS, values: await settings.all(), banks: require('../../lib/payment').BANKS,
    mailReady: !!(config.mail.host && config.mail.user && config.mail.pass), mailFrom: config.mail.from,
  });
});

router.post('/email-thu', async (req, res) => {
  const to = String(req.body.to || req.session.user.email || '').trim();
  try {
    const info = await notify.testMail(to);
    flash(req, 'success', `Gmail đã nhận thư gửi tới ${to} (${String(info.response).slice(0, 60)}). Kiểm tra hộp thư của đúng địa chỉ này, cả mục Spam.`);
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect('/admin/cai-dat');
});

router.post('/cai-dat', async (req, res) => {
  const values = {};
  for (const [, fields] of SETTING_GROUPS) for (const [k] of fields) values[k] = String(req.body[k] ?? '').trim().slice(0, 2000);
  await settings.save(values);
  flash(req, 'success', 'Đã lưu cài đặt.');
  res.redirect('/admin/cai-dat');
});

/* ---------- Thông báo Telegram ---------- */
const config = require('../../config');

async function telegramPage(res, extra = {}) {
  const s = await settings.all();
  res.render('admin/telegram', {
    title: 'Thông báo Telegram',
    hasToken: !!config.telegram.token,
    envChatId: config.telegram.chatId || '',
    chatId: await notify.telegramChatId(),
    savedChatId: s.telegram_chat_id || '',
    discover: null,
    error: null,
    ...extra,
  });
}

router.get('/telegram', (req, res) => telegramPage(res));

router.post('/telegram/tim', async (req, res) => {
  try {
    await telegramPage(res, { discover: await notify.telegramDiscover() });
  } catch (err) {
    await telegramPage(res, { error: err.message });
  }
});

router.post('/telegram/chon', async (req, res) => {
  const id = String(req.body.chat_id || '').trim();
  if (!/^-?\d{3,20}$/.test(id)) {
    flash(req, 'error', 'Chat ID không hợp lệ.');
    return res.redirect('/admin/telegram');
  }
  const prev = String(await notify.telegramChatId());
  await settings.save(prev === id ? { telegram_chat_id: id } : { telegram_chat_id: id, telegram_order_thread: '', telegram_stock_thread: '' });
  try {
    await require('../../lib/telegram-orders').ensureWebhook();
    await notify.telegram('✅ <b>Lunar Lucky</b> đã kết nối. Từ giờ đơn hàng mới và yêu cầu báo giá sẽ được báo tại đây.', id);
    flash(req, 'success', 'Đã kết nối và gửi tin nhắn thử. Hãy kiểm tra Telegram.');
  } catch (err) {
    flash(req, 'error', `Đã lưu chat nhưng gửi tin thử thất bại: ${err.message}`);
  }
  res.redirect('/admin/telegram');
});

router.post('/telegram/thu', async (req, res) => {
  const id = await notify.telegramChatId();
  try {
    if (!id) throw new Error('Chưa chọn cuộc trò chuyện nhận thông báo.');
    await notify.telegram(`🔔 Tin nhắn thử từ <b>Lunar Lucky</b> lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`, id);
    flash(req, 'success', 'Đã gửi tin nhắn thử. Hãy kiểm tra Telegram.');
  } catch (err) {
    flash(req, 'error', `Gửi thất bại: ${err.message}`);
  }
  res.redirect('/admin/telegram');
});

/* ---------- CRUD ---------- */
const categoryOptions = async () =>
  (await db('categories').orderBy('sort')).map((c) => ({ value: c.id, label: c.name }));

router.use(
  resource({
    path: 'san-pham', table: 'products', title: 'Sản phẩm', singular: 'sản phẩm', titleField: 'name',
    searchable: ['name', 'slug', 'sku'],
    orderBy: [{ column: 'sort' }, { column: 'id', order: 'desc' }],
    viewUrl: (p) => `/san-pham/${p.slug}`,
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'sku', label: 'Mã SP' },
      { key: 'name', label: 'Tên', format: 'title' },
      { key: 'category_id', label: 'Danh mục', format: 'lookup', lookup: 'categories' },
      { key: 'price', label: 'Giá', format: 'money' },
      { key: 'cost_price', label: 'Giá vốn', format: 'money' },
      { key: 'stock', label: 'Tồn kho', format: 'stock' },
      { key: 'sold', label: 'Đã bán' },
      { key: 'is_active', label: 'Hiển thị', format: 'bool' },
    ],
    lookups: async () => ({ categories: Object.fromEntries((await db('categories')).map((c) => [c.id, c.name])) }),
    fields: [
      { name: 'name', label: 'Tên sản phẩm', type: 'text', required: true, max: 160 },
      { name: 'sku', label: 'Mã SP', type: 'text', max: 40, help: 'Dùng cho lệnh kho trên Telegram, VD: /nhap LL001 20. Để trống để tự tạo.' },
      { name: 'slug', label: 'Đường dẫn (slug)', type: 'slug', help: 'Để trống để tự tạo từ tên.' },
      { name: 'category_id', label: 'Danh mục', type: 'select', options: categoryOptions, numeric: true },
      { name: 'price', label: 'Giá bán (₫)', type: 'money', required: true },
      { name: 'compare_price', label: 'Giá gốc (₫)', type: 'money', help: 'Hiển thị gạch ngang nếu lớn hơn giá bán.' },
      { name: 'cost_price', label: 'Giá vốn / giá nhập (₫)', type: 'money', help: 'Chỉ hiện trong admin, dùng để tính lợi nhuận. Khách không thấy.' },
      { name: 'stock', label: 'Tồn kho', type: 'number', required: true, default: 0 },
      { name: 'badge', label: 'Nhãn', type: 'text', max: 40, help: 'VD: Bán chạy, Mới, Giới hạn' },
      { name: 'short_desc', label: 'Mô tả ngắn', type: 'textarea', max: 300 },
      { name: 'contents', label: 'Thành phần giỏ quà', type: 'textarea', help: 'Mỗi dòng một món.' },
      { name: 'description', label: 'Mô tả chi tiết', type: 'markdown' },
      { name: 'image_id', label: 'Ảnh chính', type: 'image' },
      { name: 'gallery', label: 'Thư viện ảnh', type: 'gallery' },
      { name: 'is_featured', label: 'Nổi bật trên trang chủ', type: 'checkbox' },
      { name: 'is_active', label: 'Đang bán', type: 'checkbox', default: true },
      { name: 'sort', label: 'Thứ tự', type: 'number', default: 0 },
      { name: 'seo_title', label: 'Tiêu đề SEO', type: 'text', max: 180 },
      { name: 'seo_desc', label: 'Mô tả SEO', type: 'textarea', max: 300 },
    ],
    validate: async (v, existing) => {
      const e = {};
      if (v.sku) {
        v.sku = String(v.sku).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const dup = await db('products').where({ sku: v.sku }).modify((q) => existing && q.whereNot({ id: existing.id })).first();
        if (dup) e.sku = `Mã ${v.sku} đã dùng cho "${dup.name}".`;
      } else {
        v.sku = (existing && existing.sku) || (await require('../../lib/inventory').nextSku());
      }
      if (v.price != null && v.price < 0) e.price = 'Giá không hợp lệ.';
      if (v.stock == null) v.stock = 0;
      if (v.sort == null) v.sort = 0;
      return e;
    },
  }),
);

router.use(
  resource({
    path: 'danh-muc', table: 'categories', title: 'Danh mục', singular: 'danh mục', titleField: 'name',
    searchable: ['name'], orderBy: [{ column: 'sort' }],
    viewUrl: (c) => `/bo-suu-tap/${c.slug}`,
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'name', label: 'Tên', format: 'title' },
      { key: 'tagline', label: 'Mô tả ngắn' },
      { key: 'sort', label: 'Thứ tự' },
      { key: 'is_active', label: 'Hiển thị', format: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Tên danh mục', type: 'text', required: true, max: 120 },
      { name: 'slug', label: 'Đường dẫn (slug)', type: 'slug', help: 'Để trống để tự tạo từ tên.' },
      { name: 'tagline', label: 'Mô tả ngắn', type: 'text' },
      { name: 'description', label: 'Giới thiệu', type: 'textarea' },
      { name: 'image_id', label: 'Ảnh đại diện', type: 'image' },
      { name: 'sort', label: 'Thứ tự', type: 'number', default: 0 },
      { name: 'is_active', label: 'Hiển thị', type: 'checkbox', default: true },
    ],
    validate: (v) => { if (v.sort == null) v.sort = 0; return {}; },
  }),
);

router.use(
  resource({
    path: 'ma-giam-gia', table: 'coupons', title: 'Mã giảm giá', singular: 'mã giảm giá', titleField: 'code',
    searchable: ['code'],
    columns: [
      { key: 'code', label: 'Mã', format: 'title' },
      { key: 'type', label: 'Loại', format: 'coupon' },
      { key: 'min_order', label: 'Đơn tối thiểu', format: 'money' },
      { key: 'used_count', label: 'Đã dùng', format: 'uses' },
      { key: 'ends_at', label: 'Hết hạn', format: 'ymd' },
      { key: 'is_active', label: 'Kích hoạt', format: 'bool' },
    ],
    fields: [
      { name: 'code', label: 'Mã', type: 'text', required: true, max: 40, help: 'Chữ in hoa, không dấu, VD: TET2027' },
      { name: 'description', label: 'Ghi chú', type: 'text', max: 200 },
      { name: 'type', label: 'Loại giảm', type: 'select', required: true, options: [{ value: 'percent', label: 'Phần trăm (%)' }, { value: 'fixed', label: 'Số tiền cố định (₫)' }], default: 'percent' },
      { name: 'value', label: 'Giá trị', type: 'money', required: true, help: 'Nhập 10 cho 10%, hoặc 100000 cho 100.000₫' },
      { name: 'max_discount', label: 'Giảm tối đa (₫)', type: 'money', help: 'Chỉ áp dụng cho loại phần trăm. Để trống nếu không giới hạn.' },
      { name: 'min_order', label: 'Đơn tối thiểu (₫)', type: 'money', default: 0 },
      { name: 'max_uses', label: 'Số lượt dùng tối đa', type: 'number', help: 'Để trống nếu không giới hạn.' },
      { name: 'starts_at', label: 'Bắt đầu', type: 'date' },
      { name: 'ends_at', label: 'Kết thúc', type: 'date' },
      { name: 'is_active', label: 'Kích hoạt', type: 'checkbox', default: true },
    ],
    validate: async (v, existing) => {
      const e = {};
      if (v.code) {
        v.code = String(v.code).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const dup = await db('coupons').where({ code: v.code }).modify((q) => existing && q.whereNot({ id: existing.id })).first();
        if (dup) e.code = 'Mã này đã tồn tại.';
      }
      if (v.type === 'percent' && v.value > 100) e.value = 'Phần trăm tối đa là 100.';
      if (v.min_order == null) v.min_order = 0;
      return e;
    },
  }),
);

router.use(
  resource({
    path: 'bai-viet', table: 'posts', title: 'Bài viết', singular: 'bài viết', titleField: 'title',
    searchable: ['title'], orderBy: [{ column: 'id', order: 'desc' }],
    viewUrl: (p) => `/blog/${p.slug}`,
    columns: [
      { key: 'cover_id', label: '', format: 'image' },
      { key: 'title', label: 'Tiêu đề', format: 'title' },
      { key: 'published_at', label: 'Ngày đăng', format: 'date' },
      { key: 'is_published', label: 'Đã đăng', format: 'bool' },
    ],
    fields: [
      { name: 'title', label: 'Tiêu đề', type: 'text', required: true, max: 200 },
      { name: 'slug', label: 'Đường dẫn (slug)', type: 'slug', help: 'Để trống để tự tạo từ tiêu đề.' },
      { name: 'excerpt', label: 'Tóm tắt', type: 'textarea', max: 400 },
      { name: 'content', label: 'Nội dung', type: 'markdown' },
      { name: 'cover_id', label: 'Ảnh bìa', type: 'image' },
      { name: 'is_published', label: 'Đăng bài', type: 'checkbox' },
      { name: 'seo_title', label: 'Tiêu đề SEO', type: 'text', max: 180 },
      { name: 'seo_desc', label: 'Mô tả SEO', type: 'textarea', max: 300 },
    ],
    transform: (v, existing) => {
      if (v.is_published && !(existing && existing.published_at)) v.published_at = new Date();
    },
  }),
);

/* ---------- Chi phí & báo cáo lợi nhuận ---------- */
const profit = require('../../lib/profit');

router.use(
  resource({
    path: 'chi-phi', table: 'expenses', title: 'Chi phí', singular: 'khoản chi', titleField: 'category',
    searchable: ['category', 'note'], orderBy: [{ column: 'spent_on', order: 'desc' }, { column: 'id', order: 'desc' }],
    columns: [
      { key: 'spent_on', label: 'Ngày', format: 'ymd' },
      { key: 'category', label: 'Loại chi phí', format: 'title' },
      { key: 'amount', label: 'Số tiền', format: 'money' },
      { key: 'note', label: 'Ghi chú' },
    ],
    fields: [
      { name: 'spent_on', label: 'Ngày chi', type: 'date', required: true, get default() { return todayVN(); } },
      {
        name: 'category', label: 'Loại chi phí', type: 'select', required: true,
        options: profit.EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })), default: profit.EXPENSE_CATEGORIES[0],
      },
      { name: 'amount', label: 'Số tiền (₫)', type: 'money', required: true },
      { name: 'note', label: 'Ghi chú', type: 'text', max: 300, help: 'VD: Ship GHTK 12 đơn tuần 2/12, in 200 thiệp...' },
    ],
    validate: (v) => (v.amount != null && v.amount <= 0 ? { amount: 'Số tiền phải lớn hơn 0.' } : {}),
  }),
);

router.get('/bao-cao', async (req, res) => {
  const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  let range;
  let preset = String(req.query.ky || '');
  if (valid(req.query.tu) && valid(req.query.den) && req.query.tu <= req.query.den) {
    range = { from: req.query.tu, to: req.query.den };
    preset = 'tuy-chon';
  } else {
    if (!['hom-nay', '7-ngay', '30-ngay', 'thang-nay', 'thang-truoc', 'nam-nay'].includes(preset)) preset = 'thang-nay';
    range = profit.presetRange(preset);
  }
  res.render('admin/report', { title: 'Báo cáo lợi nhuận', r: await profit.report(range), preset });
});

/* ---------- Giao hàng theo ngày (mùa cao điểm) ---------- */
const delivery = require('../../lib/delivery');
const pickDay = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(String(q || '')) ? String(q) : todayVN());

router.get('/giao-hang', async (req, res) => {
  const day = pickDay(req.query.ngay);
  const quick = [[todayVN(), 'Hôm nay'], [todayVN(1), 'Ngày mai'], [todayVN(2), 'Ngày kia']];
  res.render('admin/delivery', { title: 'Giao hàng theo ngày', plan: await delivery.forDate(day), quick, shipTo: delivery.shipTo, codDue: delivery.codDue });
});

router.get('/giao-hang/in', async (req, res) => {
  const day = pickDay(req.query.ngay);
  const plan = await delivery.forDate(day);
  res.render('admin/delivery-print', { day, orders: plan.ready });
});

router.get('/giao-hang/excel', async (req, res) => {
  const day = pickDay(req.query.ngay);
  const plan = await delivery.forDate(day);
  const { buildXlsx } = require('../../lib/xlsx');
  const rows = plan.ready.map((o, i) => {
    const t = delivery.shipTo(o);
    return {
      stt: i + 1, code: o.code, name: t.name, phone: t.phone, address: t.address, area: plan.area(o), slot: require('../../lib/format').slotLabel(o.delivery_slot),
      items: o.items.map((x) => `${x.name} × ${x.qty}`).join(', '), cod: delivery.codDue(o),
      gift: o.is_gift ? 'Gửi tặng – không kèm hóa đơn giá' : '', note: o.note || '', card: o.card_message || '',
    };
  });
  const buf = buildXlsx([
    {
      name: `Giao ${day.slice(8)}-${day.slice(5, 7)}`,
      columns: [
        { header: 'STT', key: 'stt', type: 'number', width: 5 },
        { header: 'Mã đơn', key: 'code', width: 15 },
        { header: 'Người nhận', key: 'name', width: 20 },
        { header: 'SĐT', key: 'phone', width: 13 },
        { header: 'Địa chỉ giao', key: 'address', width: 40 },
        { header: 'Khu vực', key: 'area', width: 10 },
        { header: 'Buổi giao', key: 'slot', width: 15 },
        { header: 'Giỏ quà', key: 'items', width: 30 },
        { header: 'Thu COD', key: 'cod', type: 'money', width: 13 },
        { header: 'Lưu ý', key: 'gift', width: 22 },
        { header: 'Ghi chú khách', key: 'note', width: 26 },
        { header: 'Lời chúc trên thiệp', key: 'card', width: 34 },
      ],
      rows,
    },
    { name: 'Soạn hàng', columns: [{ header: 'Giỏ quà', key: 'name', width: 30 }, { header: 'Mã SP', key: 'sku', width: 9 }, { header: 'Số giỏ', key: 'qty', type: 'number', width: 9 }, { header: 'Số đơn', key: 'orders', type: 'number', width: 9 }], rows: plan.picking },
  ]);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="LunarLucky_GiaoHang_${day}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.send(buf);
});

/* ---------- Khách đã nhận quà ---------- */
const productOptions = async () =>
  (await db('products').orderBy('name')).map((p) => ({ value: p.id, label: `${p.sku ? p.sku + ' · ' : ''}${p.name}` }));

router.use(
  resource({
    path: 'khach-nhan-qua', table: 'testimonials', title: 'Khách đã nhận quà', singular: 'ảnh khách nhận quà', titleField: 'customer_name',
    searchable: ['customer_name', 'content', 'order_code'],
    orderBy: [{ column: 'is_active', order: 'asc' }, { column: 'id', order: 'desc' }],
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'customer_name', label: 'Khách', format: 'title' },
      { key: 'content', label: 'Nhận xét' },
      { key: 'order_code', label: 'Mã đơn' },
      { key: 'is_active', label: 'Đang hiển thị', format: 'bool' },
    ],
    fields: [
      { name: 'image_id', label: 'Ảnh giao hàng', type: 'image', help: 'Shipper có thể gửi ảnh vào nhóm Telegram kèm chú thích /anhgiao MÃĐƠN — ảnh tự vào đây.' },
      { name: 'customer_name', label: 'Tên hiển thị', type: 'text', required: true, max: 120, help: 'Nên ẩn bớt, VD: "Chị Huyền · Cầu Giấy".' },
      { name: 'content', label: 'Lời khách nhận xét', type: 'textarea', max: 400 },
      { name: 'product_id', label: 'Giỏ quà trong ảnh', type: 'select', options: productOptions, numeric: true },
      { name: 'order_code', label: 'Mã đơn', type: 'text', max: 20 },
      { name: 'is_active', label: 'Hiển thị trên web (khách đã đồng ý đăng ảnh)', type: 'checkbox' },
      { name: 'sort', label: 'Ưu tiên (số lớn hiện trước)', type: 'number', default: 0 },
    ],
    validate: (v) => { if (v.sort == null) v.sort = 0; return {}; },
  }),
);

/* ---------- Yêu cầu gọi lại ---------- */
router.get('/goi-lai', async (req, res) => {
  const rows = await db('callback_requests').orderByRaw("CASE WHEN status = 'new' THEN 0 ELSE 1 END").orderBy('id', 'desc').limit(200);
  res.render('admin/callbacks', { title: 'Yêu cầu gọi lại', rows });
});

router.post('/goi-lai/:id/xong', async (req, res) => {
  await require('../../lib/callbacks').markDone(req.params.id, req.session.user.name || req.session.user.email);
  flash(req, 'success', 'Đã đánh dấu đã gọi.');
  res.redirect('/admin/goi-lai');
});

/* ---------- Sao lưu: xuất Excel ---------- */
router.get('/sao-luu', async (req, res) => {
  const [orders, customers, products, expenses] = await Promise.all([
    db('orders').count({ n: '*' }).first(), db('orders').countDistinct({ n: 'phone' }).first(),
    db('products').count({ n: '*' }).first(), db('expenses').count({ n: '*' }).first(),
  ]);
  res.render('admin/backup', {
    title: 'Sao lưu dữ liệu',
    counts: { orders: Number(orders.n), customers: Number(customers.n), products: Number(products.n), expenses: Number(expenses.n) },
  });
});

router.get('/sao-luu/tai-ve', async (req, res) => {
  const kind = ['don-hang', 'khach-hang'].includes(req.query.loai) ? req.query.loai : 'tat-ca';
  const buf = await require('../../lib/backup').exportXlsx(kind);
  const name = { 'tat-ca': 'SaoLuu', 'don-hang': 'DonHang', 'khach-hang': 'KhachHang' }[kind];
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="LunarLucky_${name}_${todayVN()}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.send(buf);
});

module.exports = router;
