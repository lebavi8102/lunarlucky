/**
 * Phễu đơn chung: khách vào từ link kênh (?nguon=zalo) tự đặt; nhân viên đặt hộ khách trên web; gửi link đơn cho khách.
 * Chạy: BASE_URL=http://localhost:3000 node test/order-funnel.js   (máy chủ local + database local, cần ADMIN_EMAIL/ADMIN_PASSWORD trong .env)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');

const BASE = process.env.BASE_URL || 'http://localhost:3999';
if (!/localhost|127\.0\.0\.1/.test(BASE) || db.isMysql) {
  console.error('Chỉ chạy với máy chủ + database local.');
  process.exit(1);
}
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};
function client() {
  let cookie = '';
  return async (p, { method = 'GET', form } = {}) => {
    const r = await fetch(BASE + p, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  };
}
const csrf = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];
const deliveryDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
async function addToCart(c) {
  const p = await c('/san-pham/gio-an-khang');
  const pid = p.text.match(/name="product_id" value="(\d+)"/)[1];
  await c('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(p.text), product_id: pid, qty: 1 } });
}

(async () => {
  const codes = [];
  try {
    // 1. Khách bấm link trong bio Zalo → tự đặt → đơn ghi kênh Zalo
    const k = client();
    await k('/?nguon=zalo');
    await addToCart(k);
    const ck = await k('/thanh-toan');
    ok(!/Đang đặt hộ khách/.test(ck.text), 'Khách tự đặt: không thấy khung "đặt hộ"');
    const r1 = await k('/thanh-toan', { method: 'POST', form: { _csrf: csrf(ck.text), customer_name: 'Khách Zalo', phone: '0966111222', province: 'Hà Nội',
      address: '2 Hàng Bài', delivery_date: deliveryDate, payment_method: 'cod' } });
    const code1 = (/\/don-hang\/(LN\w+)/.exec(r1.location || '') || [])[1];
    codes.push(code1);
    const o1 = await db('orders').where({ code: code1 }).first();
    ok(o1 && o1.source === 'zalo' && !o1.created_by, `Khách vào từ link ?nguon=zalo → đơn ghi kênh Zalo (${o1 && o1.source})`);

    // Hết hàng đúng lúc đặt: không bán lố, không âm thầm đặt đơn khác ý khách, luôn có lời báo
    {
      const kn = await db('products').where({ slug: 'gio-kim-ngan' }).first();
      const ak = await db('products').where({ slug: 'gio-an-khang' }).first();
      const stockKn = kn.stock;
      const X = client();
      const pg = await X('/san-pham/gio-kim-ngan');
      await X('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(pg.text), product_id: kn.id, qty: 1 } });
      await X('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(pg.text), product_id: ak.id, qty: 1 } });
      const ck = await X('/thanh-toan');
      await db('products').where({ id: kn.id }).update({ stock: 0 }); // khách khác vừa mua mất
      const form = { _csrf: csrf(ck.text), customer_name: 'Khách Hai Mẫu', phone: '0966777888', province: 'Hà Nội', address: '3 Lý Thái Tổ', delivery_date: deliveryDate, payment_method: 'bank', card_message: 'Chúc mừng năm mới' };
      const r1 = await X('/thanh-toan', { method: 'POST', form });
      ok(r1.status === 409 && /Giỏ hàng vừa thay đổi/.test(r1.text) && /Giỏ Kim Ngân/.test(r1.text) && /Khách Hai Mẫu/.test(r1.text) && /Chúc mừng năm mới/.test(r1.text),
        'Giỏ 2 mẫu, 1 mẫu vừa hết → KHÔNG tự đặt; báo rõ, giữ nguyên thông tin đã điền');
      const r2 = await X('/thanh-toan', { method: 'POST', form: { ...form, _csrf: csrf(r1.text) } });
      const code2b = (/\/don-hang\/(LN\w+)/.exec(r2.location || '') || [])[1];
      codes.push(code2b);
      ok(r2.status === 302 && code2b, 'Khách xem lại rồi bấm Đặt hàng → đặt được mẫu còn lại');
      // Chỉ còn đúng mẫu vừa hết → về giỏ hàng kèm lời báo (không phải "giỏ trống" không lý do)
      const Y = client();
      await db('products').where({ id: kn.id }).update({ stock: 1 });
      const pg2 = await Y('/san-pham/gio-kim-ngan');
      await Y('/gio-hang/them', { method: 'POST', form: { _csrf: csrf(pg2.text), product_id: kn.id, qty: 1 } });
      const ck2 = await Y('/thanh-toan');
      await db('products').where({ id: kn.id }).update({ stock: 0 });
      const r3 = await Y('/thanh-toan', { method: 'POST', form: { ...form, _csrf: csrf(ck2.text) } });
      const cartPage = await Y(r3.location || '/gio-hang');
      ok(r3.status === 302 && /vừa hết hàng/.test(cartPage.text) && /chọn mẫu khác/.test(cartPage.text), 'Mẫu duy nhất vừa hết → về giỏ hàng có lời báo rõ ràng');
      await db('products').where({ id: kn.id }).update({ stock: stockKn });
    }

    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      console.log('… bỏ qua phần đặt hộ (chưa có ADMIN_EMAIL/ADMIN_PASSWORD trong .env)');
    } else {
      // 2. Nhân viên đặt hộ khách nhắn qua Facebook
      const a = client();
      const lp = await a('/dang-nhap');
      await a('/dang-nhap', { method: 'POST', form: { _csrf: csrf(lp.text), email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
      await addToCart(a);
      const ack = await a('/thanh-toan');
      ok(/Đang đặt hộ khách/.test(ack.text) && /name="order_source"/.test(ack.text), 'Quản trị mở trang đặt hàng → khung "Đang đặt hộ khách" + chọn kênh');
      ok(/id="customer_name"[^>]*value=""/.test(ack.text) || !/id="customer_name"[^>]*value="[^"]+"/.test(ack.text), 'Đặt hộ: ô tên khách để trống (không điền tên nhân viên)');
      const r2 = await a('/thanh-toan', { method: 'POST', form: { _csrf: csrf(ack.text), order_source: 'facebook', customer_name: 'Chị Mai FB', phone: '0966333444',
        province: 'Hà Nội', address: '8 Lý Thường Kiệt', delivery_date: deliveryDate, payment_method: 'bank' } });
      const code2 = (/\/don-hang\/(LN\w+)/.exec(r2.location || '') || [])[1];
      codes.push(code2);
      const o2 = await db('orders').where({ code: code2 }).first();
      ok(o2 && o2.source === 'facebook' && o2.created_by && !o2.user_id, 'Đơn đặt hộ: kênh Facebook, ghi tên nhân viên, không gắn vào tài khoản nhân viên');
      ok(o2 && o2.status === 'new', 'Đơn đặt hộ chưa chuyển khoản → giữ "Mới" (vẫn tự hủy nếu khách không trả)');
      await require('../src/lib/orders').updateOrder(o2.id, { payment_status: 'paid' }, { by: 'SePay thử' });
      ok((await db('orders').where({ id: o2.id }).first()).status === 'confirmed', 'Tiền về → đơn đặt hộ tự "Đã xác nhận", kho soạn ngay');
      const page = await a(r2.location);
      const link = (/(http[^"<\s]+\/don-hang\/LN\w+\?k=[\w-]+)/.exec(page.text) || [])[1];
      ok(/Gửi đơn cho khách/.test(page.text) && link, 'Trang đơn (nhân viên) có tin nhắn + link gửi khách');

      // 3. Khách mở link được gửi (máy khác, chưa từng đặt) → xem được đơn
      const g = client();
      const path = link.replace(/^https?:\/\/[^/]+/, '');
      const view = await g(path);
      ok(view.status === 200 && view.text.includes(code2) && !/Gửi đơn cho khách/.test(view.text), 'Khách mở link → xem được đơn (không thấy phần của nhân viên)');
      ok((await g(`/don-hang/${code2}`)).status === 200, 'Mở lại sau đó không cần link');
      const bad = await client()(`/don-hang/${code2}?k=sai-ma-khoa`);
      ok(bad.status === 302, 'Link sai khóa → không xem được');

      const adm = await a(`/admin/don-hang?nguon=facebook`);
      ok(adm.text.includes(code2) && !adm.text.includes(code1), 'Admin lọc đơn theo kênh Facebook');
      const dash = await a('/admin');
      ok(/Đơn theo kênh/.test(dash.text) && /\?nguon=zalo/.test(dash.text), 'Tổng quan: đơn theo kênh + link đặt hàng cho từng kênh');
    }
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    const ids = (await db('orders').whereIn('code', codes.filter(Boolean))).map((o) => o.id);
    await db('order_items').whereIn('order_id', ids).del();
    await db('orders').whereIn('id', ids).del();
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
