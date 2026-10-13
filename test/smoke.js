/**
 * Kiểm thử nhanh toàn bộ luồng chính trên server đang chạy.
 * Cách dùng:  npm run dev   (cửa sổ khác)   rồi   npm test
 * Mặc định http://localhost:3000, đổi bằng biến BASE_URL. Cần ADMIN_EMAIL/ADMIN_PASSWORD trong .env.
 * KHÔNG chạy với website thật: bài test tạo đơn, tài khoản và yêu cầu báo giá thử.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE) && !process.env.ALLOW_REMOTE) {
  console.error('Từ chối chạy test trên', BASE, '(sẽ tạo dữ liệu thử). Đặt ALLOW_REMOTE=1 nếu chắc chắn.');
  process.exit(1);
}

function client() {
  let cookie = '';
  return async (p, { method = 'GET', form, json } = {}) => {
    const r = await fetch(BASE + p, {
      method,
      headers: { cookie, ...(json ? { accept: 'application/json' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
      redirect: 'manual',
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  };
}
const csrf = (h) => (h.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};
const deliveryDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

async function addToCart(c, slug, qty = 1) {
  const p = await c(`/san-pham/${slug}`);
  const t = csrf(p.text);
  const pid = p.text.match(/name="product_id" value="(\d+)"/)[1];
  const r = await c('/gio-hang/them', { method: 'POST', json: true, form: { _csrf: t, product_id: pid, qty } });
  return { t, r };
}

(async () => {
  const c = client();

  // 1. Trang công khai
  for (const p of ['/', '/bo-suu-tap', '/san-pham/gio-an-khang', '/qua-tang-doanh-nghiep', '/blog', '/gioi-thieu',
    '/lien-he', '/cau-hoi-thuong-gap', '/chinh-sach-giao-hang', '/tim-kiem?q=tr%C3%A0', '/tra-cuu-don', '/dang-nhap',
    '/sitemap.xml', '/robots.txt', '/healthz?db=1']) {
    const r = await c(p);
    ok(r.status === 200, `GET ${p} → ${r.status}`);
  }
  ok((await c('/khong-ton-tai')).status === 404, 'Trang không tồn tại → 404');
  ok((await c('/tu-tao-gio-qua')).status === 404, 'Tính năng tự tạo giỏ đã gỡ → 404');

  // 2. Bảo mật cơ bản
  ok((await c('/gio-hang/them', { method: 'POST', form: { product_id: 1, qty: 1 } })).status === 403, 'POST thiếu CSRF bị chặn');
  ok((await c('/admin')).status === 302, 'Admin chưa đăng nhập → chuyển trang đăng nhập');
  ok((await c('/telegram/webhook', { method: 'POST', form: {} })).status === 403, 'Webhook Telegram sai khóa bị chặn');

  // 3. Giỏ hàng + mã giảm giá
  const { t, r: add } = await addToCart(c, 'gio-an-khang', 2);
  ok(add.status === 200 && JSON.parse(add.text).count === 2, 'Thêm 2 giỏ vào giỏ hàng');
  await c('/gio-hang/ma-giam-gia', { method: 'POST', form: { _csrf: t, code: 'SAIMA' } });
  ok(/không tồn tại/.test((await c('/gio-hang')).text), 'Mã giảm giá sai báo lỗi');

  // 4. Thanh toán: lỗi, rồi đơn bán lẻ
  const bad = await c('/thanh-toan', { method: 'POST', form: { _csrf: t, customer_name: 'A', phone: '123', province: 'Hà Nội' } });
  ok(bad.status === 422 && /aria-invalid="true"/.test(bad.text), 'Thiếu thông tin thanh toán → báo lỗi tại ô');
  const place = await c('/thanh-toan', { method: 'POST', form: {
    _csrf: t, customer_name: 'Khách Thử', phone: '0912345678', province: 'Hà Nội', address: '12 Phố Huế',
    delivery_date: deliveryDate, card_message: 'Chúc mừng năm mới', payment_method: 'bank' } });
  ok(place.status === 302 && /^\/don-hang\/LN/.test(place.location || ''), `Đặt đơn bán lẻ → ${place.location}`);
  const code = (place.location || '').split('/')[2]?.split('?')[0];
  const orderPage = await c(place.location);
  ok(orderPage.status === 200, 'Trang đơn hàng hiển thị');

  // 5. Tra cứu đơn từ phiên khác
  const c2 = client();
  ok((await c2(`/don-hang/${code}`)).status === 302, 'Người lạ không xem được đơn');
  const tk = csrf((await c2('/tra-cuu-don')).text);
  ok((await c2('/tra-cuu-don', { method: 'POST', form: { _csrf: tk, code, phone: '0900000001' } })).status === 404, 'Tra cứu sai SĐT bị từ chối');
  ok((await c2('/tra-cuu-don', { method: 'POST', form: { _csrf: tk, code, phone: '0912 345 678' } })).status === 302, 'Tra cứu đúng SĐT');

  // 6. Đơn xuất VAT: bắt buộc chuyển khoản, lưu thông tin công ty
  const c3 = client();
  const { t: t3 } = await addToCart(c3, 'gio-an-khang', 1);
  const vatBad = await c3('/thanh-toan', { method: 'POST', form: { _csrf: t3, customer_name: 'Kế toán', phone: '0912345678',
    province: 'Hà Nội', address: '1 Tràng Tiền', delivery_date: deliveryDate, needs_vat: '1', vat_company: 'Cty X',
    vat_tax_code: '123', vat_address: '1 Tràng Tiền', vat_email: 'kt@x.vn', payment_method: 'bank' } });
  ok(vatBad.status === 422 && /Mã số thuế gồm 10 số/.test(vatBad.text), 'Mã số thuế sai → báo lỗi');
  const vat = await c3('/thanh-toan', { method: 'POST', form: { _csrf: t3, customer_name: 'Kế toán', phone: '0912345678',
    province: 'Hà Nội', address: '1 Tràng Tiền', delivery_date: deliveryDate, needs_vat: '1', vat_company: 'Công ty TNHH Thử',
    vat_tax_code: '0101234567', vat_address: '1 Tràng Tiền, Hà Nội', vat_email: 'kt@thu.vn', payment_method: 'cod' } });
  ok(vat.status === 302, 'Đặt đơn VAT (chọn COD vẫn được chuyển sang chuyển khoản)');
  ok(/Hóa đơn VAT|tài khoản công ty/.test((await c3(vat.location)).text), 'Trang đơn VAT ghi rõ thanh toán TK công ty');

  // 7. Báo giá doanh nghiệp
  const biz = await c2('/qua-tang-doanh-nghiep');
  const q = await c2('/qua-tang-doanh-nghiep', { method: 'POST', form: { _csrf: csrf(biz.text), company: 'Công ty ABC',
    contact_name: 'Chị Lan', phone: '0909123456', quantity: '120', budget: 'Cần tư vấn' } });
  ok(q.status === 200 && /đã nhận yêu cầu/.test(q.text), 'Gửi yêu cầu báo giá');

  // 8. Admin
  const a = client();
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.log('… bỏ qua phần admin (chưa có ADMIN_EMAIL/ADMIN_PASSWORD trong .env)');
  } else {
    const lp = await a('/dang-nhap');
    const li = await a('/dang-nhap', { method: 'POST', form: { _csrf: csrf(lp.text), email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    ok(li.status === 302 && li.location === '/admin', 'Admin đăng nhập');
    for (const p of ['/admin', '/admin/don-hang', '/admin/bao-gia', '/admin/san-pham', '/admin/san-pham/moi', '/admin/danh-muc',
      '/admin/ma-giam-gia', '/admin/bai-viet', '/admin/khach-hang', '/admin/telegram', '/admin/cai-dat']) {
      const r = await a(p);
      ok(r.status === 200, `GET ${p} → ${r.status}`);
    }
    const prods = await a('/admin/san-pham');
    ok(/LL\d{3}/.test(prods.text), 'Danh sách sản phẩm có cột Mã SP');
    const list = await a(`/admin/don-hang?q=${code}`);
    const oid = (list.text.match(/href="\/admin\/don-hang\/(\d+)"/) || [])[1];
    const od = await a(`/admin/don-hang/${oid}`);
    ok(/Lịch sử xử lý/.test(od.text), 'Chi tiết đơn có lịch sử xử lý');
    await a(`/admin/don-hang/${oid}`, { method: 'POST', form: { _csrf: csrf(od.text), status: 'cancelled', payment_status: 'pending' } });
    const after = await a(`/admin/don-hang/${oid}`);
    ok(/Đã hủy/.test(after.text), 'Hủy đơn thử trong admin');
  }

  console.log(fails ? `\n${fails} kiểm thử thất bại` : '\nTất cả kiểm thử đều đạt');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
