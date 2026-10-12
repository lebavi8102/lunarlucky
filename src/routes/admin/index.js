const express = require('express');
const db = require('../../db');
const settings = require('../../lib/settings');
const notify = require('../../lib/notify');
const resource = require('./resource');
const { requireAdmin } = require('../../middleware/auth');
const { flash } = require('../../middleware/locals');
const { parseJson, toDate, todayVN } = require('../../lib/format');

const router = express.Router();

router.use(requireAdmin, (req, res, next) => {
  res.locals.seo.noindex = true;
  res.locals.layout = 'admin';
  next();
});

const ORDER_STATUS = {
  new: 'Mới',
  confirmed: 'Đã xác nhận',
  packing: 'Đang đóng gói',
  shipping: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
};
const PAYMENT_STATUS = { pending: 'Chưa thanh toán', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền' };
const QUOTE_STATUS = { new: 'Mới', contacted: 'Đã liên hệ', won: 'Chốt đơn', lost: 'Không thành' };

router.use((req, res, next) => {
  Object.assign(res.locals, { ORDER_STATUS, PAYMENT_STATUS, QUOTE_STATUS });
  next();
});

/* ---------- Tổng quan ---------- */
router.get('/', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const recentAll = await db('orders').where('created_at', '>=', since).select('total', 'status', 'created_at');
  const days = [];
  for (let i = 13; i >= 0; i--) days.push({ day: todayVN(-i), total: 0, count: 0 });
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(toDate(d));
  const today = todayVN();
  const monthPrefix = today.slice(0, 7);
  let revenueToday = 0;
  let revenueMonth = 0;
  let ordersToday = 0;
  for (const o of recentAll) {
    if (o.status === 'cancelled') continue;
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
  }
  const [newOrders, unpaidBank, newQuotes, lowStock, recent, topProducts] = await Promise.all([
    db('orders').where({ status: 'new' }).count({ n: '*' }).first(),
    db('orders').where({ payment_method: 'bank', payment_status: 'pending' }).whereNot({ status: 'cancelled' }).count({ n: '*' }).first(),
    db('quotes').where({ status: 'new' }).count({ n: '*' }).first(),
    db('products').where({ is_active: true }).andWhere('stock', '<=', 5).orderBy('stock').limit(6),
    db('orders').orderBy('id', 'desc').limit(8),
    db('products').orderBy('sold', 'desc').limit(5),
  ]);
  res.render('admin/dashboard', {
    title: 'Tổng quan',
    stats: {
      revenueToday, revenueMonth, ordersToday,
      newOrders: Number(newOrders.n), unpaidBank: Number(unpaidBank.n), newQuotes: Number(newQuotes.n),
    },
    days, lowStock, recent, topProducts,
  });
});

/* ---------- Đơn hàng ---------- */
router.get('/don-hang', async (req, res) => {
  const status = ORDER_STATUS[req.query.status] ? req.query.status : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const page = Math.max(1, Number(req.query.trang) || 1);
  let query = db('orders');
  if (status) query = query.where({ status });
  if (req.query.chua_tt) query = query.where({ payment_method: 'bank', payment_status: 'pending' });
  if (q) query = query.andWhere((w) => w.where('code', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`).orWhere('customer_name', 'like', `%${q}%`));
  const [{ n }] = await query.clone().count({ n: '*' });
  const orders = await query.orderBy('id', 'desc').limit(30).offset((page - 1) * 30);
  const counts = Object.fromEntries(
    (await db('orders').select('status').count({ n: '*' }).groupBy('status')).map((r) => [r.status, Number(r.n)]),
  );
  res.render('admin/orders', {
    title: 'Đơn hàng', orders, status, q, page, pages: Math.max(1, Math.ceil(Number(n) / 30)), counts,
    unpaidOnly: !!req.query.chua_tt,
  });
});

async function loadOrder(id) {
  const order = await db('orders').where({ id: Number(id) }).first();
  if (!order) return null;
  const items = (await db('order_items').where({ order_id: order.id })).map((i) => ({ ...i, details: parseJson(i.details, null) }));
  return { order, items };
}

router.get('/don-hang/:id', async (req, res, next) => {
  const data = await loadOrder(req.params.id);
  if (!data) return next();
  res.render('admin/order', { title: `Đơn ${data.order.code}`, ...data });
});

router.get('/don-hang/:id/in', async (req, res, next) => {
  const data = await loadOrder(req.params.id);
  if (!data) return next();
  res.render('admin/order-print', { ...data });
});

router.post('/don-hang/:id', async (req, res, next) => {
  const data = await loadOrder(req.params.id);
  if (!data) return next();
  const { order, items } = data;
  const status = ORDER_STATUS[req.body.status] ? req.body.status : order.status;
  const payment_status = PAYMENT_STATUS[req.body.payment_status] ? req.body.payment_status : order.payment_status;
  const admin_note = String(req.body.admin_note || '').slice(0, 500) || null;

  await db.transaction(async (trx) => {
    const goingCancelled = status === 'cancelled' && order.status !== 'cancelled';
    const leavingCancelled = order.status === 'cancelled' && status !== 'cancelled';
    if (goingCancelled || leavingCancelled) {
      const sign = goingCancelled ? 1 : -1;
      for (const i of items.filter((x) => x.product_id)) {
        await trx('products').where({ id: i.product_id }).update({
          stock: trx.raw('stock + ?', [sign * i.qty]),
          sold: trx.raw('CASE WHEN sold - ? < 0 THEN 0 ELSE sold - ? END', [sign * i.qty, sign * i.qty]),
        });
      }
    }
    await trx('orders').where({ id: order.id }).update({ status, payment_status, admin_note, updated_at: new Date() });
  });

  if (status !== order.status && order.email && ['confirmed', 'shipping', 'completed', 'cancelled'].includes(status)) {
    notify.sendMail({
      to: order.email,
      subject: `Đơn hàng ${order.code}: ${ORDER_STATUS[status]}`,
      template: 'order-status',
      data: { order: { ...order, status }, statusLabel: ORDER_STATUS[status], s: res.locals.s },
    });
  }
  flash(req, 'success', 'Đã cập nhật đơn hàng.');
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
  const users = await db('users')
    .leftJoin('orders', 'orders.user_id', 'users.id')
    .where('users.role', 'customer')
    .groupBy('users.id', 'users.name', 'users.email', 'users.phone', 'users.created_at')
    .select('users.id', 'users.name', 'users.email', 'users.phone', 'users.created_at')
    .count({ orders: 'orders.id' })
    .sum({ spent: 'orders.total' })
    .orderBy('users.id', 'desc')
    .limit(300);
  res.render('admin/customers', { title: 'Khách hàng', users });
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
  ['Chuyển khoản VietQR', [
    ['bank_id', 'Mã ngân hàng (VD: VCB, TCB, MB, ACB, VPB)'], ['bank_name', 'Tên ngân hàng hiển thị'],
    ['bank_account', 'Số tài khoản'], ['bank_holder', 'Chủ tài khoản (IN HOA, không dấu)'],
  ]],
  ['Giao hàng', [
    ['shipping_fee', 'Phí giao hàng (₫)'], ['free_ship_threshold', 'Miễn phí giao cho đơn từ (₫)'],
    ['min_delivery_days', 'Số ngày chuẩn bị tối thiểu trước khi giao'],
  ]],
  ['Trang chủ', [
    ['announcement', 'Dòng thông báo trên cùng'], ['hero_eyebrow', 'Dòng nhỏ trên tiêu đề'],
    ['hero_title', 'Tiêu đề lớn'], ['hero_subtitle', 'Mô tả dưới tiêu đề', 'textarea'],
  ]],
];

router.get('/cai-dat', async (req, res) => {
  res.render('admin/settings', { title: 'Cài đặt', groups: SETTING_GROUPS, values: await settings.all() });
});

router.post('/cai-dat', async (req, res) => {
  const values = {};
  for (const [, fields] of SETTING_GROUPS) for (const [k] of fields) values[k] = String(req.body[k] ?? '').trim().slice(0, 2000);
  await settings.save(values);
  flash(req, 'success', 'Đã lưu cài đặt.');
  res.redirect('/admin/cai-dat');
});

/* ---------- CRUD ---------- */
const categoryOptions = async () =>
  (await db('categories').orderBy('sort')).map((c) => ({ value: c.id, label: c.name }));

router.use(
  resource({
    path: 'san-pham', table: 'products', title: 'Sản phẩm', singular: 'sản phẩm', titleField: 'name',
    searchable: ['name', 'slug'],
    orderBy: [{ column: 'sort' }, { column: 'id', order: 'desc' }],
    viewUrl: (p) => `/san-pham/${p.slug}`,
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'name', label: 'Tên', format: 'title' },
      { key: 'category_id', label: 'Danh mục', format: 'lookup', lookup: 'categories' },
      { key: 'price', label: 'Giá', format: 'money' },
      { key: 'stock', label: 'Tồn kho', format: 'stock' },
      { key: 'sold', label: 'Đã bán' },
      { key: 'is_active', label: 'Hiển thị', format: 'bool' },
    ],
    lookups: async () => ({ categories: Object.fromEntries((await db('categories')).map((c) => [c.id, c.name])) }),
    fields: [
      { name: 'name', label: 'Tên sản phẩm', type: 'text', required: true, max: 160 },
      { name: 'slug', label: 'Đường dẫn (slug)', type: 'slug', help: 'Để trống để tự tạo từ tên.' },
      { name: 'category_id', label: 'Danh mục', type: 'select', options: categoryOptions, numeric: true },
      { name: 'price', label: 'Giá bán (₫)', type: 'money', required: true },
      { name: 'compare_price', label: 'Giá gốc (₫)', type: 'money', help: 'Hiển thị gạch ngang nếu lớn hơn giá bán.' },
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
    validate: (v) => {
      const e = {};
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
    path: 'hop-qua', table: 'builder_boxes', title: 'Hộp quà (Tự tạo giỏ)', singular: 'hộp quà', titleField: 'name',
    orderBy: [{ column: 'sort' }],
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'name', label: 'Tên', format: 'title' },
      { key: 'price', label: 'Giá hộp', format: 'money' },
      { key: 'capacity', label: 'Sức chứa' },
      { key: 'is_active', label: 'Hiển thị', format: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Tên hộp', type: 'text', required: true },
      { name: 'description', label: 'Mô tả', type: 'textarea', max: 300 },
      { name: 'price', label: 'Giá hộp (₫)', type: 'money', required: true },
      { name: 'capacity', label: 'Số món tối đa', type: 'number', required: true, default: 6 },
      { name: 'image_id', label: 'Ảnh', type: 'image' },
      { name: 'sort', label: 'Thứ tự', type: 'number', default: 0 },
      { name: 'is_active', label: 'Hiển thị', type: 'checkbox', default: true },
    ],
    validate: (v) => { if (v.sort == null) v.sort = 0; return {}; },
  }),
);

router.use(
  resource({
    path: 'mon-qua', table: 'builder_items', title: 'Món quà (Tự tạo giỏ)', singular: 'món quà', titleField: 'name',
    searchable: ['name', 'group_name'],
    orderBy: [{ column: 'group_name' }, { column: 'sort' }],
    columns: [
      { key: 'image_id', label: '', format: 'image' },
      { key: 'name', label: 'Tên', format: 'title' },
      { key: 'group_name', label: 'Nhóm' },
      { key: 'price', label: 'Giá', format: 'money' },
      { key: 'is_active', label: 'Hiển thị', format: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Tên món', type: 'text', required: true },
      { name: 'group_name', label: 'Nhóm', type: 'text', required: true, help: 'VD: Trà & Cà phê, Rượu vang, Bánh mứt, Hạt dinh dưỡng, Đặc sản' },
      { name: 'description', label: 'Mô tả ngắn', type: 'text', max: 300 },
      { name: 'price', label: 'Giá (₫)', type: 'money', required: true },
      { name: 'image_id', label: 'Ảnh', type: 'image' },
      { name: 'sort', label: 'Thứ tự', type: 'number', default: 0 },
      { name: 'is_active', label: 'Hiển thị', type: 'checkbox', default: true },
    ],
    validate: (v) => { if (v.sort == null) v.sort = 0; return {}; },
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

module.exports = router;
