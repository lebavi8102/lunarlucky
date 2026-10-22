/**
 * Kiểm thử bot tự nhắc việc vận hành (tin sáng, nhắc đơn bị bỏ quên, tin chốt ngày).
 * Chạy: node test/ops-digest.js   (dùng database local, giả lập Telegram)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const config = require('../src/config');
const settings = require('../src/lib/settings');
const { todayVN } = require('../src/lib/format');

if (db.isMysql && !process.env.ALLOW_REMOTE) {
  console.error('Test này tạo/xóa đơn thử — chỉ chạy với database local.');
  process.exit(1);
}
config.telegram.token = 'test-token';
const sent = [];
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body || '{}');
  if (url.endsWith('/getChatMember')) return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: body.user_id === 777 ? 'member' : 'administrator' } }) };
  sent.push({ method: url.split('/').pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }) };
};
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};

(async () => {
  await db.migrate.latest();
  const before = await settings.all();
  await settings.save({ telegram_chat_id: '-100777', province_min_days: '3' });
  const digest = require('../src/lib/ops-digest');
  const p = await db('products').first();
  const ids = [];
  const mk = async (o) => {
    const [r] = await db('orders').insert({ customer_name: 'Khách', phone: '0955000111', address: 'x', province: 'Hà Nội', payment_method: 'cod',
      payment_status: 'pending', deposit_amount: 0, status: 'confirmed', subtotal: 1000000, discount: 0, shipping_fee: 0, total: 1000000, ...o });
    const id = typeof r === 'object' ? r.id : r;
    await db('order_items').insert({ order_id: id, product_id: p.id, name: p.name, price: 1000000, qty: 2, line_total: 2000000 });
    ids.push(id);
    return id;
  };
  try {
    const today = todayVN();
    await mk({ code: 'LN26OPS0SANG', delivery_date: today, delivery_slot: 'sang' });
    await mk({ code: 'LN26OPS0CHIE', delivery_date: today, delivery_slot: 'chieu', status: 'shipping', shipper: 'Hùng' });
    await mk({ code: 'LN26OPS0TINH', delivery_date: todayVN(2), province: 'Đà Nẵng' });
    await mk({ code: 'LN26OPS0TRE1', delivery_date: todayVN(-2) });
    await mk({ code: 'LN26OPS0MAI1', delivery_date: todayVN(1) });
    await mk({ code: 'LN26OPS0QUEN', status: 'new', delivery_date: todayVN(3), created_at: new Date(Date.now() - 3 * 3600000) });

    const m = await digest.morning(today);
    ok(/VIỆC HÔM NAY/.test(m) && /Giao <b>2 đơn · 4 giỏ<\/b> \(Sáng 1 · Chiều 1\)/.test(m), 'Tin sáng: số đơn, số giỏ, chia theo buổi');
    ok(!/thiệp/i.test(m), 'Tin sáng: không còn nhắc thiệp viết tay');
    ok(/Gửi chuyển phát hôm nay \(1 đơn tỉnh\)/.test(m) && /LN26OPS0TINH · Đà Nẵng/.test(m), 'Tin sáng: đơn tỉnh phải gửi chuyển phát hôm nay');
    ok(/Quá ngày giao chưa hoàn tất/.test(m) && /LN26OPS0TRE1/.test(m), 'Tin sáng: đơn quá ngày giao chưa xong');
    ok(/Ngày mai [^:]+: \d+ đơn · \d+ giỏ<\/b> — soạn trước/.test(m), 'Tin sáng: soạn trước cho ngày mai');
    ok(/đơn mới chưa xác nhận/.test(m), 'Tin sáng: còn đơn mới chưa xác nhận');

    sent.length = 0;
    await digest.remindStale();
    ok(sent.some((x) => /quá 2 giờ chưa ai xác nhận/.test(x.body.text) && /LN26OPS0QUEN/.test(x.body.text)), 'Đơn mới quá 2 giờ chưa xác nhận → nhắc nhóm');
    sent.length = 0;
    await digest.remindStale();
    ok(!sent.some((x) => /LN26OPS0QUEN/.test(x.body.text || '')), 'Chỉ nhắc 1 lần mỗi đơn');

    const ev = await digest.evening(today);
    ok(/CHỐT NGÀY/.test(ev) && /đã giao 0\/2 đơn/.test(ev) && /LN26OPS0CHIE · Khách · 🛵 Hùng/.test(ev) && /chưa ai nhận giao/.test(ev), 'Tin tối: đơn chưa giao xong + ai đang giữ');
    ok(/TIỀN COD NGÀY/.test(ev), 'Tin tối: kèm đối soát tiền COD');

    // Chủ đề nhắc việc: chưa chọn → vào chủ đề đơn hàng; /chonnhac → vào chủ đề riêng
    await settings.save({ telegram_order_thread: '11', telegram_ops_thread: '' });
    await db('orders').where({ code: 'LN26OPS0QUEN' }).update({ ops_reminded_at: null });
    sent.length = 0;
    await digest.remindStale();
    ok(sent.some((x) => x.body.message_thread_id === 11), 'Chưa /chonnhac → tin nhắc vào chủ đề đơn hàng');
    const tg = require('../src/lib/telegram-orders');
    await tg.handleUpdate({ message: { message_id: 9, chat: { id: -100777, type: 'supergroup' }, is_topic_message: true, message_thread_id: 77, from: { first_name: 'Chủ' }, text: '/chonnhac' } });
    ok((await settings.all()).telegram_ops_thread === '77', '/chonnhac lưu chủ đề nhắc việc');
    await db('orders').where({ code: 'LN26OPS0QUEN' }).update({ ops_reminded_at: null });
    sent.length = 0;
    await digest.remindStale();
    ok(sent.some((x) => x.method === 'sendMessage' && x.body.message_thread_id === 77 && /quá 2 giờ/.test(x.body.text)), 'Sau /chonnhac → tin nhắc vào chủ đề riêng');

    // Sao lưu tự động qua email: file Excel đính kèm
    const notify = require('../src/lib/notify');
    const realMail = notify.sendMail;
    const mails = [];
    notify.sendMail = async (m) => { mails.push(m); };
    await digest.sendBackup({ shop_email: 'shop@example.test' }, todayVN());
    notify.sendMail = realMail;
    const bk = mails[0];
    ok(bk && bk.to === 'shop@example.test' && /\[Sao lưu\]/.test(bk.subject) && bk.attachments[0].content.slice(0, 2).toString() === 'PK',
      'Sao lưu: email kèm file Excel (.xlsx) gửi vào email cửa hàng');
    const html = await require('ejs').renderFile(require('path').join(__dirname, '../views/emails/backup.ejs'), { ...bk.data, ymd: require('../src/lib/format').ymd, money: require('../src/lib/format').money, siteUrl: 'x' });
    ok(/Sao lưu dữ liệu ngày/.test(html), 'Email sao lưu hiển thị đúng');

    // Tin chờ chuyển khoản → chủ đề TIỀN VỀ (/chontien), không vào chủ đề đơn hàng của kho
    await tg.handleUpdate({ message: { message_id: 10, chat: { id: -100777, type: 'supergroup' }, is_topic_message: true, message_thread_id: 36, from: { first_name: 'Chủ' }, text: '/chontien' } });
    ok((await settings.all()).telegram_money_thread === '36', '/chontien lưu chủ đề tiền về');
    // Shipper (không phải quản trị) không đổi được chủ đề, không sửa được tồn kho
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 11, chat: { id: -100777, type: 'supergroup' }, is_topic_message: true, message_thread_id: 99, from: { id: 777, first_name: 'Ship' }, text: '/chontien' } });
    const pBefore = await db('products').first();
    await tg.handleUpdate({ message: { message_id: 12, chat: { id: -100777, type: 'supergroup' }, from: { id: 777, first_name: 'Ship' }, text: `/dat ${pBefore.sku || pBefore.id} 1` } });
    ok((await settings.all()).telegram_money_thread === '36' && (await db('products').where({ id: pBefore.id }).first()).stock === pBefore.stock
      && sent.some((x) => /chỉ dành cho quản trị viên/.test(x.body.text || '')), 'Shipper gõ /chontien, /dat → bị từ chối, không đổi gì');
    sent.length = 0;
    await require('../src/lib/bank-payments').notifyWaiting({ id: -1, code: 'LN26OPSWAIT', customer_name: 'K', phone: '0900', total: 100000, payment_method: 'bank', payment_status: 'pending', deposit_amount: 0, delivery_date: today, created_at: new Date() });
    ok(sent.some((x) => x.method === 'sendMessage' && x.body.message_thread_id === 36), 'Tin "chờ chuyển khoản" vào chủ đề TIỀN VỀ');

    // Không gửi trùng khi máy chủ khởi động lại
    await settings.save({ ops_morning_last: today, ops_evening_last: today });
    sent.length = 0;
    await digest.tick();
    ok(!sent.some((x) => /VIỆC HÔM NAY|CHỐT NGÀY/.test(x.body.text || '')), 'Đã gửi trong ngày → không gửi lại');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await db('order_items').whereIn('order_id', ids).del();
    await db('orders').whereIn('id', ids).del();
    await settings.save({ telegram_order_thread: before.telegram_order_thread, telegram_ops_thread: before.telegram_ops_thread, telegram_money_thread: before.telegram_money_thread });
    await settings.save({ telegram_chat_id: before.telegram_chat_id, ops_morning_last: before.ops_morning_last, ops_evening_last: before.ops_evening_last });
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
