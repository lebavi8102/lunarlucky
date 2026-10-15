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
  // Ô "Để lại SĐT – gọi lại"
  const cbBad = await c('/goi-lai', { method: 'POST', json: true, form: { _csrf: t, name: 'Lan', phone: '123', source: 'thanh-toan' } });
  ok(cbBad.status === 422, 'Gọi lại: số điện thoại sai → báo lỗi');
  const cbOk = await c('/goi-lai', { method: 'POST', json: true, form: { _csrf: t, name: 'Chị Lan Thử', phone: '0912345678', source: 'thanh-toan' } });
  ok(cbOk.status === 200 && /gọi lại/.test(cbOk.text), 'Gọi lại: gửi tên + SĐT thành công');
  const place = await c('/thanh-toan', { method: 'POST', form: {
    _csrf: t, customer_name: 'Khách Thử', phone: '0912345678', province: 'Hà Nội', address: '12 Phố Huế',
    delivery_date: deliveryDate, card_message: 'Chúc mừng năm mới', payment_method: 'bank' } });
  ok(place.status === 302 && /^\/don-hang\/LN/.test(place.location || ''), `Đặt đơn bán lẻ → ${place.location}`);
  const code = (place.location || '').split('/')[2]?.split('?')[0];
  const orderPage = await c(place.location);
  ok(orderPage.status === 200, 'Trang đơn hàng hiển thị');
  ok(/Lưu mã QR về máy/.test(orderPage.text) && /Quét QR/.test(orderPage.text), 'Trang đơn có nút lưu QR + hướng dẫn 3 bước');
  const qrDl = await c(`/don-hang/${code}/qr.png`);
  ok(qrDl.status === 200 || qrDl.status === 302, `Tải ảnh QR của đơn mình → ${qrDl.status}`);

  // 4b. Mất phiên khi đang đặt (mở lâu, Zalo/Facebook xóa cookie) → không mất thông tin, bấm lại là đặt được
  {
    const fresh = client();
    const prod = (await c('/bo-suu-tap')).text.match(/name="product_id" value="(\d+)"/)[1];
    const lost = await fresh('/thanh-toan', { method: 'POST', form: {
      _csrf: 'het-han', cart_snapshot: JSON.stringify([{ id: Number(prod), qty: 2 }]),
      customer_name: 'Khách Mất Phiên', phone: '0912345678', province: 'Hà Nội', address: '9 Phố Huế', delivery_date: deliveryDate, payment_method: 'cod' } });
    ok(lost.status === 409 && /Khách Mất Phiên/.test(lost.text) && /cần xác nhận lại/.test(lost.text), 'Hết phiên khi đặt → hiện lại form, giữ nguyên thông tin đã điền');
    ok(/summary-items[\s\S]*?data-checkout-qty="[^"]+"[^>]*value="2"|value="2"[^>]*data-checkout-qty/.test(lost.text), 'Giỏ hàng được dựng lại (2 giỏ)');
    const again = await fresh('/thanh-toan', { method: 'POST', form: {
      _csrf: csrf(lost.text), customer_name: 'Khách Mất Phiên', phone: '0912345678', province: 'Hà Nội', address: '9 Phố Huế', delivery_date: deliveryDate, payment_method: 'cod' } });
    ok(again.status === 302 && /\/don-hang\//.test(again.location || ''), 'Bấm "Đặt hàng" lần nữa → tạo đơn thành công');
  }

  // 4c. Đơn gửi tặng chọn COD → tự chuyển khoản (không để tài xế thu tiền người được tặng)
  {
    const g = client();
    const prod = (await c('/bo-suu-tap')).text.match(/name="product_id" value="(\d+)"/)[1];
    const gp = await g('/san-pham/gio-an-khang');
    await g('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(gp.text), product_id: prod, qty: 1 } });
    const ck = await g('/thanh-toan');
    const gift = await g('/thanh-toan', { method: 'POST', form: { _csrf: csrf(ck.text), customer_name: 'Người Tặng', phone: '0912345678', province: 'Hà Nội',
      is_gift: '1', recipient_name: 'Chú Hai', recipient_phone: '0987654321', recipient_address: '5 Hàng Bông', delivery_date: deliveryDate, payment_method: 'cod' } });
    const gpage = await g(gift.location || '/');
    ok(gift.status === 302 && /Chuyển khoản · /.test(gpage.text) && !/COD · /.test(gpage.text), 'Đơn gửi tặng chọn COD → tự chuyển sang chuyển khoản');
  }

  // 4c2. Giao tỉnh (chuyển phát 2–4 ngày) → không cho chọn giao ngày mai
  {
    const g = client();
    const { t } = await addToCart(g, 'gio-an-khang', 1);
    const tomorrow = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const r = await g('/thanh-toan', { method: 'POST', form: { _csrf: t, customer_name: 'Khách Sài Gòn', phone: '0912345678', province: 'TP. Hồ Chí Minh',
      address: '1 Lê Lợi, Quận 1', delivery_date: tomorrow, payment_method: 'bank' } });
    ok(r.status === 422 && /Giao ngoài Hà Nội đi chuyển phát/.test(r.text), 'Giao TP.HCM chọn ngày mai → báo cần chọn từ ngày sớm nhất cho tỉnh');
  }

  // 4c2b. Nghỉ Tết (mặc định 06–10/02/2027) → không nhận giao những ngày đó
  {
    const g = client();
    const { t } = await addToCart(g, 'gio-an-khang', 1);
    const r = await g('/thanh-toan', { method: 'POST', form: { _csrf: t, customer_name: 'Khách Mùng Hai', phone: '0912345678', province: 'Hà Nội',
      address: '1 Tràng Tiền', delivery_date: '2027-02-07', payment_method: 'bank' } });
    ok(r.status === 422 && /nghỉ Tết từ 06\/02 đến 10\/02/.test(r.text), 'Chọn giao mùng 2 Tết → báo shop nghỉ Tết, chọn ngày khác');
  }

  // 4c2c. Đơn từ 5 giỏ cần 2 ngày chuẩn bị → không cho giao ngày mai
  {
    const g = client();
    const { t } = await addToCart(g, 'gio-an-khang', 5);
    const tomorrow = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const r = await g('/thanh-toan', { method: 'POST', form: { _csrf: t, customer_name: 'Công ty Thử', phone: '0912345678', province: 'Hà Nội',
      address: '1 Tràng Tiền', delivery_date: tomorrow, payment_method: 'bank' } });
    ok(r.status === 422 && /cần 2 ngày chuẩn bị/.test(r.text), 'Đặt 5 giỏ giao ngày mai → báo cần 2 ngày chuẩn bị');
  }

  // 4c3. Buổi giao (Hà Nội): lưu và hiện trên trang đơn
  {
    const g = client();
    const { t } = await addToCart(g, 'gio-an-khang', 1);
    const r = await g('/thanh-toan', { method: 'POST', form: { _csrf: t, customer_name: 'Khách Buổi Chiều', phone: '0912345678', province: 'Hà Nội',
      address: '1 Tràng Tiền', delivery_date: deliveryDate, delivery_slot: 'chieu', payment_method: 'bank' } });
    ok(r.status === 302 && /Chiều \(13h–17h\)/.test((await g(r.location)).text), 'Chọn buổi chiều → trang đơn ghi "Chiều (13h–17h)"');
  }

  // 4d. Cọc COD: 2 giỏ → phải cọc 30%; 1 giỏ dưới 1 triệu → không cọc
  {
    const cheap = (await c('/bo-suu-tap?sap_xep=gia-tang')).text.match(/name="product_id" value="(\d+)"/)[1];
    const place = async (qty) => {
      const g = client();
      const gp = await g('/bo-suu-tap');
      await g('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(gp.text), product_id: cheap, qty } });
      const ck = await g('/thanh-toan');
      const r = await g('/thanh-toan', { method: 'POST', form: { _csrf: csrf(ck.text), customer_name: 'Khách COD', phone: '0912345678', province: 'Hà Nội', address: '3 Phố Huế', delivery_date: deliveryDate, payment_method: 'cod' } });
      return { ck: ck.text, page: (await g(r.location || '/')).text };
    };
    const two = await place(2);
    ok(/Đặt cọc trước \(COD\)/.test(two.ck), 'Trang đặt hàng 2 giỏ: hiện dòng "Đặt cọc trước"');
    ok(/Đặt cọc [\d.]+₫ để giữ đơn/.test(two.page) && /Trả khi nhận hàng/.test(two.page), 'Đơn COD 2 giỏ → trang đơn yêu cầu đặt cọc, ghi phần trả khi nhận');
    const one = await place(1);
    ok(!/để giữ đơn/.test(one.page) && !/Đặt cọc trước/.test(one.ck), 'Đơn COD 1 giỏ dưới 1 triệu → không cọc');
  }

  // 5. Tra cứu đơn từ phiên khác
  const c2 = client();
  ok((await c2(`/don-hang/${code}`)).status === 302, 'Người lạ không xem được đơn');
  ok((await c2(`/don-hang/${code}/qr.png`)).status === 404, 'Người lạ không tải được ảnh QR của đơn');
  const tk = csrf((await c2('/tra-cuu-don')).text);
  ok((await c2('/tra-cuu-don', { method: 'POST', form: { _csrf: tk, code, phone: '0900000001' } })).status === 404, 'Tra cứu sai SĐT bị từ chối');
  ok((await c2('/tra-cuu-don', { method: 'POST', form: { _csrf: tk, code, phone: '0912 345 678' } })).status === 302, 'Tra cứu đúng SĐT');

  // 5b. Đặt trước, tạo tài khoản sau: tra cứu (kể cả gõ +84) → đơn vào lịch sử tài khoản
  {
    const u = client();
    const rg = await u('/dang-ky');
    const pw = require('crypto').randomBytes(9).toString('base64url');
    const reg = await u('/dang-ky', { method: 'POST', form: { _csrf: csrf(rg.text), name: 'Khách Thử', email: `smoke-${Date.now()}@example.test`, password: pw } });
    ok(reg.status === 302, 'Tạo tài khoản khách');
    const d0 = (await u('/tai-khoan')).text;
    ok(!d0.includes(code) && /Tra cứu bằng mã đơn \+ SĐT/.test(d0), 'Tài khoản mới: chưa có đơn, có hướng dẫn thêm đơn cũ');
    const tk2 = csrf((await u('/tra-cuu-don')).text);
    ok((await u('/tra-cuu-don', { method: 'POST', form: { _csrf: tk2, code, phone: '+84 912 345 678' } })).status === 302, 'Tra cứu bằng SĐT dạng +84');
    ok((await u('/tai-khoan')).text.includes(code), 'Đơn đặt trước khi có tài khoản → hiện trong lịch sử đơn');
  }

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
  const vatPage = (await c3(vat.location)).text;
  ok(/Hóa đơn VAT/.test(vatPage) && !/tài khoản công ty bên dưới/.test(vatPage), 'Trang đơn VAT: thu vào TK bán lẻ, không lộ TK công ty');
  const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
  const sub = num((vatPage.match(/Tạm tính<\/span><span>([\d.]+)₫/) || [])[1]);
  const ship = /Phí giao hàng<\/span><span>Miễn phí/.test(vatPage) ? 0 : num((vatPage.match(/Phí giao hàng<\/span><span>([\d.]+)₫/) || [])[1]);
  const fee = num((vatPage.match(/Phí xuất hóa đơn VAT[^<]*<\/span><span>([\d.]+)₫/) || [])[1]);
  const total = num((vatPage.match(/Tổng cộng<\/span><span>([\d.]+)₫/) || [])[1]);
  const disc = num((vatPage.match(/class="disc">−([\d.]+)₫/) || [])[1]);
  ok(fee === Math.round((sub - disc) * 0.11) && total === sub - disc + ship + fee,
    `Đơn VAT phí 11% chỉ trên tiền hàng: ${sub} − ${disc} + ship ${ship} + ${fee} = ${total}`);
  await addToCart(c3, 'gio-an-khang', 1);
  const ck = (await c3('/thanh-toan')).text;
  ok(/Về hóa đơn VAT/.test(ck) && /data-with-vat="\d+"/.test(ck), 'Trang thanh toán có mục giải thích phí VAT + tổng đã cộng phí');
  ok(!/Phí xuất hóa đơn VAT[^<]*<\/span><span>[\d.]+₫/.test(orderPage.text), 'Đơn bán lẻ không có phí VAT');

  // 7. Báo giá doanh nghiệp
  const biz = await c2('/qua-tang-doanh-nghiep');
  const q = await c2('/qua-tang-doanh-nghiep', { method: 'POST', form: { _csrf: csrf(biz.text), company: 'Công ty ABC',
    contact_name: 'Chị Lan', phone: '0909123456', quantity: '120', budget: 'Cần tư vấn' } });
  ok(q.status === 303 && q.location === '/qua-tang-doanh-nghiep?da-gui=1#bao-gia', 'Gửi yêu cầu báo giá → chuyển trang (tải lại không gửi trùng)');
  const qd = await c2('/qua-tang-doanh-nghiep?da-gui=1');
  ok(qd.status === 200 && /đã nhận yêu cầu/.test(qd.text), 'Trang báo đã nhận yêu cầu báo giá');

  // 8. Admin
  const a = client();
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.log('… bỏ qua phần admin (chưa có ADMIN_EMAIL/ADMIN_PASSWORD trong .env)');
  } else {
    const lp = await a('/dang-nhap');
    const li = await a('/dang-nhap', { method: 'POST', form: { _csrf: csrf(lp.text), email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    ok(li.status === 302 && li.location === '/admin', 'Admin đăng nhập');
    for (const p of ['/admin', '/admin/don-hang', '/admin/bao-gia', '/admin/san-pham', '/admin/san-pham/moi', '/admin/danh-muc',
      '/admin/ma-giam-gia', '/admin/bai-viet', '/admin/khach-hang', '/admin/telegram', '/admin/cai-dat', '/admin/bao-cao', '/admin/bao-cao?ky=nam-nay', '/admin/bao-cao?tu=2026-01-01&den=2026-12-31', '/admin/chi-phi', '/admin/chi-phi/moi', '/admin/sao-luu', '/admin/goi-lai', '/admin/khach-nhan-qua', '/admin/khach-nhan-qua/moi', '/admin/giao-hang', '/admin/giao-hang?ngay=2026-12-01', '/admin/giao-hang/in', '/admin/don-hang?can_xu_ly=1', '/admin/don-hang?ngay=2026-12-01']) {
      const r = await a(p);
      ok(r.status === 200, `GET ${p} → ${r.status}`);
    }
    const gx = await a('/admin/giao-hang/excel');
    ok(gx.status === 200 && gx.text.startsWith('PK'), 'Excel danh sách giao trong ngày');
    for (const loai of ['tat-ca', 'don-hang', 'khach-hang']) {
      const x = await a(`/admin/sao-luu/tai-ve?loai=${loai}`);
      ok(x.status === 200 && x.text.startsWith('PK'), `Tải Excel sao lưu (${loai}) → file .xlsx`);
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
