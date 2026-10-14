/**
 * Kiểm thử tự xác nhận chuyển khoản (SePay) — giả lập SePay và Telegram, không gửi gì thật.
 * Chạy: node test/bank-payments.js   (dùng database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const config = require('../src/config');
const settings = require('../src/lib/settings');
const bank = require('../src/lib/bank-payments');

if (db.isMysql && !process.env.ALLOW_REMOTE) {
  console.error('Test này tạo/xóa đơn thử — chỉ chạy với database local.');
  process.exit(1);
}

config.sepay.apiKey = 'khoa-thu-123';
config.telegram.token = 'test-token';
const sent = [];
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body || '{}');
  sent.push({ method: url.split('/').pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77, chat: { id: body.chat_id } } }) };
};

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};
const texts = () => sent.filter((x) => x.method === 'sendMessage').map((x) => x.body.text);

let seq = 0;
async function makeOrder(over = {}) {
  const p = await db('products').first();
  const code = `LN261013T${'ABCDEFGHJKLMNPRSTUVW'[++seq]}XY`;
  const [id] = await db('orders').insert({
    code, customer_name: 'Khách thử', phone: '0912345678', address: '1 Phố Huế', province: 'Hà Nội',
    delivery_date: '2027-01-20', payment_method: 'bank', payment_status: 'pending', status: 'new',
    subtotal: 100000, discount: 0, shipping_fee: 0, total: 100000, ...over,
  });
  const orderId = typeof id === 'object' ? id.id : id;
  await db('order_items').insert({ order_id: orderId, product_id: p.id, name: p.name, price: 100000, qty: 2, line_total: 200000 });
  return { id: orderId, code, product: p };
}
const tx = (n, amount, content, type = 'in') => ({ id: 900000 + n, transferType: type, transferAmount: amount, content, referenceCode: `REF${n}` });

(async () => {
  await db.migrate.latest();
  const backup = await settings.all();
  await settings.save({ telegram_chat_id: '-100123', telegram_order_thread: '', telegram_stock_thread: '' });
  const made = [];

  // Đọc mã đơn trong nội dung chuyển khoản
  ok(bank.findCode('MBVCB.123.LN261013ABCD.CT tu 012') === 'LN261013ABCD', 'Đọc mã đơn trong nội dung ngân hàng');
  ok(bank.findCode('ln261013abcd chuyen tien qua') === 'LN261013ABCD', 'Đọc mã đơn viết thường');
  ok(bank.findCode('chuyen tien an trua') === null, 'Nội dung không có mã → bỏ qua');

  // Xác thực khóa SePay
  const req = (h) => ({ get: (k) => (k.toLowerCase() === 'authorization' ? h : undefined) });
  ok(bank.authorized(req('Apikey khoa-thu-123')), 'Đúng khóa API → nhận');
  ok(!bank.authorized(req('Apikey sai')) && !bank.authorized(req(undefined)), 'Sai/thiếu khóa API → từ chối');

  // Đơn CK vừa đặt → nhóm nhận tin "⏳ CHỜ CHUYỂN KHOẢN"; nhận tiền → tin đổi thành "✅ ĐÃ NHẬN TIỀN"
  {
    const ow = await makeOrder();
    made.push(ow.id);
    sent.length = 0;
    await bank.notifyWaiting(await db('orders').where({ id: ow.id }).first());
    ok(texts().some((t) => /CHỜ CHUYỂN KHOẢN/.test(t) && t.includes(ow.code)), 'Đơn CK vừa đặt → nhóm thấy tin "⏳ CHỜ CHUYỂN KHOẢN"');
    ok(Number((await db('orders').where({ id: ow.id }).first()).tg_wait_message_id) === 77, 'Lưu tin chờ để sửa sau');
    sent.length = 0;
    await bank.handleSepay(tx(7, 100000, ow.code));
    ok(sent.some((x) => x.method === 'editMessageText' && /ĐÃ NHẬN TIỀN/.test(x.body.text)), 'Nhận tiền → tin chờ đổi thành "✅ ĐÃ NHẬN TIỀN"');
    ok(texts().some((t) => /ĐƠN MỚI/.test(t) && t.includes(ow.code)), 'Và gửi tin ĐƠN MỚI đầy đủ nút xử lý');
  }

  // Chuyển thiếu
  const o1 = await makeOrder();
  made.push(o1.id);
  sent.length = 0;
  let r = await bank.handleSepay(tx(1, 50000, `${o1.code} chuyen khoan`));
  let row = await db('orders').where({ id: o1.id }).first();
  ok(r.result === 'underpaid' && row.payment_status === 'pending', 'Chuyển thiếu → chưa xác nhận');
  ok(texts().some((t) => /chuyển thiếu/.test(t)), 'Chuyển thiếu → báo nhóm để liên hệ khách');

  // Chuyển đủ → đã thanh toán + báo ĐƠN MỚI lần đầu
  sent.length = 0;
  r = await bank.handleSepay(tx(2, 100000, `IBFT ${o1.code}`));
  row = await db('orders').where({ id: o1.id }).first();
  ok(r.result === 'paid' && row.payment_status === 'paid' && row.paid_at, 'Chuyển đủ → tự đánh dấu Đã thanh toán');
  ok(texts().some((t) => /ĐƠN MỚI/.test(t) && /Đã thanh toán/.test(t)), 'Lúc này mới báo ĐƠN MỚI vào nhóm (kèm Đã thanh toán)');
  ok(String(row.tg_message_id) === '77', 'Lưu tin nhắn đơn để các nút xử lý hoạt động');
  ok(/SePay tự động/.test(row.handled_log || ''), 'Lịch sử ghi "SePay tự động"');

  // Gửi lại cùng giao dịch / tiền ra
  r = await bank.handleSepay(tx(2, 100000, `IBFT ${o1.code}`));
  ok(r.result === 'duplicate', 'SePay gửi lại cùng giao dịch → không xử lý trùng');
  r = await bank.handleSepay(tx(3, 100000, `${o1.code}`, 'out'));
  ok(r.result === 'ignored', 'Giao dịch tiền ra → bỏ qua');

  // Quá hạn chưa trả → tự hủy, trả kho; sau đó khách mới chuyển → khôi phục
  const o2 = await makeOrder({ created_at: new Date(Date.now() - 30 * 3600000) });
  made.push(o2.id);
  const stockBefore = (await db('products').where({ id: o2.product.id }).first()).stock;
  const n = await bank.expireUnpaid();
  row = await db('orders').where({ id: o2.id }).first();
  const stockAfter = (await db('products').where({ id: o2.product.id }).first()).stock;
  ok(n >= 1 && row.status === 'cancelled', 'Quá 24 giờ chưa chuyển khoản → tự hủy');
  ok(stockAfter === stockBefore + 2, 'Hủy đơn → trả lại 2 giỏ vào kho');
  const o3 = await makeOrder();
  made.push(o3.id);
  await bank.expireUnpaid();
  ok((await db('orders').where({ id: o3.id }).first()).status === 'new', 'Đơn mới đặt chưa quá hạn → giữ nguyên');


  sent.length = 0;
  r = await bank.handleSepay(tx(4, 100000, o2.code));
  row = await db('orders').where({ id: o2.id }).first();
  ok(row.status === 'new' && row.payment_status === 'paid', 'Đơn đã tự hủy mà khách vẫn chuyển → khôi phục, đã thanh toán');
  ok((await db('products').where({ id: o2.product.id }).first()).stock === stockBefore, 'Khôi phục đơn → trừ lại kho');

  // Qua nửa thời gian giữ mà chưa trả → email nhắc 1 lần (kèm QR); hết hạn → email báo tự hủy + nút đặt lại
  {
    const notify = require('../src/lib/notify');
    const ejs = require('ejs');
    const realMail = notify.sendMail;
    const mails = [];
    notify.sendMail = async (m) => {
      const html = await ejs.renderFile(require('path').join(__dirname, '../views/emails', `${m.template}.ejs`), { ...m.data, money: require('../src/lib/format').money, ymd: require('../src/lib/format').ymd, siteUrl: 'http://x' });
      mails.push({ ...m, html });
    };
    const o4 = await makeOrder({ email: 'khach@example.com', created_at: new Date(Date.now() - 14 * 3600000) });
    const o5 = await makeOrder({ email: 'moi@example.com' });
    made.push(o4.id, o5.id);
    await bank.remindUnpaid();
    await new Promise((r) => setTimeout(r, 200));
    const rm = mails.filter((m) => m.to === 'khach@example.com');
    ok(rm.length === 1 && /Nhắc thanh toán/.test(rm[0].subject) && /vẫn đang được giữ/.test(rm[0].html) && /Mã VietQR/.test(rm[0].html), 'Quá nửa thời gian giữ chưa chuyển khoản → email nhắc kèm QR');
    ok(!mails.some((m) => m.to === 'moi@example.com'), 'Đơn vừa đặt → chưa nhắc');
    await bank.remindUnpaid();
    await new Promise((r) => setTimeout(r, 200));
    ok(mails.filter((m) => m.to === 'khach@example.com').length === 1, 'Chỉ nhắc 1 lần');
    await db('orders').where({ id: o4.id }).update({ created_at: new Date(Date.now() - 30 * 3600000) });
    await bank.expireUnpaid();
    await new Promise((r) => setTimeout(r, 200));
    const cm = mails.filter((m) => m.to === 'khach@example.com').pop();
    ok(cm && /tự hủy vì quá thời gian giữ/.test(cm.html) && /Đặt lại giỏ quà/.test(cm.html) && !/hoàn tiền/.test(cm.html), 'Tự hủy → email nói rõ lý do, không nhắc "hoàn tiền", có nút đặt lại');
    notify.sendMail = realMail;
  }

  // ĐƠN COD CẦN CỌC: cọc 300k / tổng 1.000.000
  {
    const pay = require('../src/lib/payment');
    const oc = await makeOrder({ payment_method: 'cod', deposit_amount: 300000, total: 1000000, subtotal: 1000000 });
    made.push(oc.id);
    let row = await db('orders').where({ id: oc.id }).first();
    ok(pay.awaitingMoney(row) && pay.amountDue(row) === 300000, 'COD cần cọc: đang chờ cọc, mã QR = 300.000');
    sent.length = 0;
    let r = await bank.handleSepay(tx(20, 100000, oc.code));
    ok(r.result === 'underpaid' && texts().some((t) => /tiền cọc/.test(t)), 'Chuyển thiếu tiền cọc → báo nhóm');
    sent.length = 0;
    r = await bank.handleSepay(tx(21, 300000, oc.code));
    row = await db('orders').where({ id: oc.id }).first();
    ok(r.result === 'deposit' && row.payment_status === 'deposit' && row.deposit_paid_at, 'Nhận đủ cọc → trạng thái "Đã cọc"');
    ok(texts().some((t) => /ĐƠN MỚI/.test(t) && t.includes(oc.code) && /thu 700\.000/.test(t)), 'Báo ĐƠN MỚI, shipper thu 700.000 khi giao');
    ok(pay.codDue(row) === 700000 && !pay.awaitingMoney(row), 'Tiền thu COD = tổng − cọc; đơn sẵn sàng giao');
    r = await bank.handleSepay(tx(22, 700000, oc.code));
    row = await db('orders').where({ id: oc.id }).first();
    ok(r.result === 'paid' && row.payment_status === 'paid' && pay.codDue(row) === 0, 'Khách chuyển nốt phần còn lại → đã thanh toán, shipper không thu');
    // COD chờ cọc quá hạn → tự hủy
    const oe = await makeOrder({ payment_method: 'cod', deposit_amount: 300000, total: 1000000, created_at: new Date(Date.now() - 30 * 3600000) });
    made.push(oe.id);
    await bank.expireUnpaid();
    ok((await db('orders').where({ id: oe.id }).first()).status === 'cancelled', 'COD chờ cọc quá 24 giờ → tự hủy');
    // COD không cần cọc: không bị giữ, không bị tự hủy
    const on = await makeOrder({ payment_method: 'cod', deposit_amount: 0, created_at: new Date(Date.now() - 30 * 3600000) });
    made.push(on.id);
    await bank.expireUnpaid();
    const rn = await db('orders').where({ id: on.id }).first();
    ok(rn.status === 'new' && !pay.awaitingMoney(rn), 'COD 1 giỏ dưới 1 triệu: không chờ cọc, không tự hủy');
  }

  // Mã không có đơn
  sent.length = 0;
  r = await bank.handleSepay(tx(5, 100000, 'LN261013QQQQ'));
  ok(r.result === 'unknown_order' && texts().some((t) => /không tìm thấy đơn/.test(t)), 'Mã đơn không tồn tại → báo nhóm kiểm tra');

  // Gửi Telegram lỗi lúc thanh toán → lần quét sau gửi bù (chỉ đơn cần báo, không gửi đơn CK chưa trả)
  const o4 = await makeOrder({ payment_status: 'paid' });
  const o5 = await makeOrder();
  made.push(o4.id, o5.id);
  sent.length = 0;
  await bank.resendMissed();
  const ids = sent.filter((x) => x.method === 'sendMessage').map((x) => x.body.text);
  ok(ids.some((t) => t.includes(o4.code)) && !ids.some((t) => t.includes(o5.code)), 'Gửi bù đơn đã thanh toán bị lỡ, không gửi đơn chưa trả tiền');
  sent.length = 0;
  await bank.resendMissed();
  ok(!sent.some((x) => x.body.text && x.body.text.includes(o4.code)), 'Đã gửi bù rồi thì không gửi lặp');

  // Dọn dữ liệu thử
  await db('order_items').whereIn('order_id', made).del();
  await db('orders').whereIn('id', made).del();
  await db('bank_transactions').where('id', 'like', 'sepay:9000%').del();
  await settings.save({
    telegram_chat_id: backup.telegram_chat_id || '', telegram_order_thread: backup.telegram_order_thread || '',
    telegram_stock_thread: backup.telegram_stock_thread || '',
  });
  console.log(fails ? `\n${fails} kiểm thử thất bại` : '\nTất cả kiểm thử đều đạt');
  process.exitCode = fails ? 1 : 0;
  await db.destroy();
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await db.destroy();
});
