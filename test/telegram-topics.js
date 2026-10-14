/**
 * Kiểm thử bot Telegram (giả lập API Telegram, không gửi tin thật):
 * lệnh kho, chủ đề (Topics) cho đơn hàng / kho, đổi mã nhóm khi bật Topics.
 * Chạy: node test/telegram-topics.js   (dùng database local, không cần server)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const settings = require('../src/lib/settings');
const config = require('../src/config');
const tg = require('../src/lib/telegram-orders');
const notify = require('../src/lib/notify');

if (db.isMysql && !process.env.ALLOW_REMOTE) {
  console.error('Test này đổi dữ liệu kho — chỉ chạy với database local.');
  process.exit(1);
}

const OLD = -5000001;
const GROUP = -1005000001;
const sent = [];
let failThread = false;
let migrateFrom = null; // giả lập: gửi vào mã nhóm cũ → Telegram báo đã lên supergroup
const MIGRATED = -1009000009;
config.telegram.token = 'test-token';
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body || '{}');
  const method = url.split('/').pop();
  if (migrateFrom && String(body.chat_id) === String(migrateFrom)) {
    return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: MIGRATED } }) };
  }
  if (failThread && body.message_thread_id) {
    return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: message thread not found' }) };
  }
  if (url.includes('/file/bot')) {
    // ảnh JPEG giả (đủ "magic bytes")
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0]) };
  }
  if (method === 'getFile') return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'photos/a.jpg' } }) };
  sent.push({ method, body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }) };
};

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};
let mid = 1;
const msg = (text, extra = {}) => ({
  message: { message_id: ++mid, chat: { id: GROUP, type: 'supergroup', title: 'Nhóm thử', is_forum: true }, from: { first_name: 'Lan' }, text, ...extra },
});
const lastSend = () => [...sent].reverse().find((x) => x.method === 'sendMessage');

(async () => {
  await db.migrate.latest();
  const backup = await settings.all();
  await settings.save({ telegram_chat_id: String(OLD), telegram_order_thread: '', telegram_stock_thread: '' });

  // 1. Bật Topics → nhóm đổi mã
  await tg.handleUpdate({ message: { message_id: 1, chat: { id: OLD, type: 'group' }, migrate_to_chat_id: GROUP } });
  ok(String(await notify.telegramChatId()) === String(GROUP), 'Nhóm đổi mã khi bật Topics → bot tự nhận mã mới');

  // 2. Chọn chủ đề
  sent.length = 0;
  await tg.handleUpdate(msg('/chondon', { is_topic_message: true, message_thread_id: 11 }));
  ok(lastSend()?.body.message_thread_id === 11 && /đơn hàng mới/.test(lastSend().body.text), '/chondon trả lời trong chủ đề Đơn hàng');
  await tg.handleUpdate(msg('/chonkho', { is_topic_message: true, message_thread_id: 22 }));
  const s = await settings.all();
  ok(s.telegram_order_thread === '11' && s.telegram_stock_thread === '22', 'Lưu chủ đề Đơn hàng = 11, Kho hàng = 22');
  sent.length = 0;
  await tg.handleUpdate(msg('/chondon'));
  ok(/bên trong/.test(lastSend()?.body.text || ''), '/chondon gõ ngoài chủ đề → hướng dẫn');

  // 3. Đơn mới → chủ đề Đơn hàng
  const o = await db('orders').orderBy('id', 'desc').first();
  const items = await db('order_items').where({ order_id: o.id });
  sent.length = 0;
  await tg.sendNewOrder(o, items);
  ok(lastSend()?.body.message_thread_id === 11 && /ĐƠN MỚI/.test(lastSend().body.text), 'Đơn mới gửi vào chủ đề Đơn hàng');

  // 4. Cảnh báo kho → chủ đề Kho hàng
  const p = await db('products').whereNotNull('sku').first();
  const stock0 = p.stock;
  await db('products').where({ id: p.id }).update({ stock: 3 });
  sent.length = 0;
  await tg.stockAlertsAfterOrder([{ product_id: p.id, qty: 4 }]);
  ok(lastSend()?.body.message_thread_id === 22 && /Sắp hết/.test(lastSend().body.text), 'Cảnh báo sắp hết gửi vào chủ đề Kho hàng');

  // 5. Lệnh kho trả lời đúng chủ đề đang gõ
  sent.length = 0;
  await tg.handleUpdate(msg('/ton', { is_topic_message: true, message_thread_id: 22 }));
  ok(lastSend()?.body.message_thread_id === 22 && /TỒN KHO/.test(lastSend().body.text), '/ton trả lời trong chủ đề Kho hàng');
  sent.length = 0;
  await tg.handleUpdate(msg(`/nhap ${p.sku} 10`, { is_topic_message: true, message_thread_id: 22 }));
  ok((await db('products').where({ id: p.id }).first()).stock === 13, `/nhap ${p.sku} 10 → 3 + 10 = 13`);

  // 6. Chủ đề bị xóa → vẫn gửi vào nhóm chung
  failThread = true;
  sent.length = 0;
  await notify.telegram('Tin thử');
  ok(lastSend() && lastSend().body.message_thread_id === undefined, 'Chủ đề bị xóa → tin vẫn gửi vào nhóm chung');
  failThread = false;

  // 7. Nhóm lạ không dùng được lệnh
  sent.length = 0;
  await tg.handleUpdate({ message: { message_id: 999, chat: { id: -1, type: 'group' }, from: { first_name: 'X' }, text: `/nhap ${p.sku} 50` } });
  ok(!lastSend() && (await db('products').where({ id: p.id }).first()).stock === 13, 'Nhóm lạ gõ lệnh → bỏ qua');

  // Hủy đơn đã HOÀN TẤT từ Telegram → đơn trên web cũng hủy, trả kho; khôi phục phải xác nhận
  {
    const prod = await db('products').where({ id: p.id }).first();
    const [oidRaw] = await db('orders').insert({
      code: 'LN261014TGXQ', customer_name: 'Thử hủy', phone: '0912345678', address: 'x', province: 'Hà Nội', delivery_date: '2026-12-01',
      payment_method: 'bank', payment_status: 'paid', status: 'completed', subtotal: 100000, discount: 0, shipping_fee: 0, total: 100000,
      tg_chat_id: String(GROUP), tg_message_id: 99,
    });
    const oid = typeof oidRaw === 'object' ? oidRaw.id : oidRaw;
    await db('order_items').insert({ order_id: oid, product_id: p.id, name: prod.name, price: 100000, qty: 2, line_total: 200000 });
    const kb0 = JSON.stringify(require('../src/lib/telegram-orders').keyboard({ id: oid, code: 'LN261014TGXQ', status: 'completed' }));
    ok(kb0.includes(`o:${oid}:x`), 'Đơn đã Hoàn tất vẫn có nút ❌ Hủy trên Telegram');
    const press = (data) => tg.handleUpdate({ callback_query: { id: 'q', data, from: { first_name: 'Lan' }, message: { message_id: 99, chat: { id: GROUP } } } });
    await press(`o:${oid}:x`);
    ok((await db('orders').where({ id: oid }).first()).status === 'completed', 'Bấm Hủy lần 1 → chỉ hỏi xác nhận, chưa hủy');
    sent.length = 0;
    await press(`o:${oid}:xx`);
    const cancelled = await db('orders').where({ id: oid }).first();
    ok(cancelled.status === 'cancelled', 'Bấm "Có, hủy đơn" → đơn trên web chuyển Đã hủy');
    ok((await db('products').where({ id: p.id }).first()).stock === prod.stock + 2, 'Hủy đơn → trả 2 giỏ về kho');
    ok(sent.some((x) => x.method === 'answerCallbackQuery' && /hoàn tiền/.test(x.body.text)), 'Đơn đã thanh toán bị hủy → nhắc hoàn tiền');
    ok(sent.some((x) => x.method === 'editMessageText' && /cần hoàn tiền/.test(x.body.text)), 'Tin đơn trong nhóm ghi "cần hoàn tiền"');
    await press(`o:${oid}:r`);
    ok((await db('orders').where({ id: oid }).first()).status === 'cancelled', 'Bấm Khôi phục lần 1 → chỉ hỏi xác nhận');
    await press(`o:${oid}:rr`);
    ok((await db('orders').where({ id: oid }).first()).status === 'confirmed', 'Bấm "Có, khôi phục" → đơn sống lại');
    await db('order_items').where({ order_id: oid }).del();
    await db('orders').where({ id: oid }).del();
    await db('products').where({ id: p.id }).update({ stock: prod.stock });
  }

  // Shipper gửi ảnh giao hàng: ảnh + chú thích /anhgiao MÃĐƠN lời khen → lưu web, chờ duyệt
  {
    const [oRaw] = await db('orders').insert({
      code: 'LN261014PHTQ', customer_name: 'Nguyễn Thanh Huyền', phone: '0912345678', address: 'x', province: 'Cầu Giấy, Hà Nội',
      delivery_date: '2026-12-01', payment_method: 'cod', payment_status: 'paid', status: 'completed', subtotal: 1, discount: 0, shipping_fee: 0, total: 1,
    });
    const oId = typeof oRaw === 'object' ? oRaw.id : oRaw;
    await db('order_items').insert({ order_id: oId, product_id: p.id, name: p.name, price: 1, qty: 1, line_total: 1 });
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 50, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'small', width: 90, height: 90, file_size: 100 }, { file_id: 'big', width: 1280, height: 1280, file_size: 90000 }],
      caption: '/anhgiao ln261014phtq Giỏ đẹp lắm, cảm ơn shop!' } });
    const t = await db('testimonials').where({ order_code: 'LN261014PHTQ' }).first();
    ok(t && t.image_id && t.is_active == false, 'Ảnh giao hàng từ Telegram → lưu vào web ở trạng thái chờ duyệt');
    ok(t && t.customer_name === 'Thanh H. · Cầu Giấy' && t.content === 'Giỏ đẹp lắm, cảm ơn shop!', `Tên khách được ẩn bớt: "${t && t.customer_name}"`);
    ok(t && t.product_id === p.id, 'Tự gắn giỏ quà của đơn');
    ok(sent.some((x) => x.method === 'sendMessage' && /chờ duyệt/.test(x.body.text)), 'Bot trả lời "đã lưu, chờ duyệt"');
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 51, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'x', width: 90, height: 90 }], caption: '/anhgiao LN000000ZZZZ' } });
    ok(sent.some((x) => /Không tìm thấy đơn/.test(x.body.text || '')), 'Sai mã đơn → bot báo lại');
    // Cách dự phòng: gửi ảnh trước, rồi TRẢ LỜI ảnh bằng tin chữ /anhgiao MÃĐƠN
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 52, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Shipper' },
      text: '/anhgiao LN261014PHTQ', reply_to_message: { message_id: 49, photo: [{ file_id: 'r', width: 800, height: 800, file_size: 5000 }] } } });
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 2, 'Trả lời (reply) vào ảnh bằng /anhgiao MÃĐƠN → cũng lưu được');
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 53, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Shipper' }, text: '/anhgiao LN261014PHTQ' } });
    ok(sent.some((x) => /Chưa thấy ảnh/.test(x.body.text || '')), 'Gõ /anhgiao không kèm ảnh → bot hướng dẫn cách gửi');
    const listed = await require('../src/lib/testimonials').listActive();
    ok(!listed.some((x) => x.id === t.id), 'Ảnh chưa duyệt không hiện trên web');
    await db('testimonials').where({ order_code: 'LN261014PHTQ' }).del();
    if (t) await db('media').where({ id: t.image_id }).del();
    await db('order_items').where({ order_id: oId }).del();
    await db('orders').where({ id: oId }).del();
  }

  // /giao 25/1: danh sách giao cho shipper — chỉ đơn sẵn sàng (COD/đã trả), cảnh báo đơn CK chưa trả
  {
    const day = `${new Date().getFullYear()}-01-25`;
    const mk = async (over) => {
      const [x] = await db('orders').insert({ customer_name: 'Khách', phone: '0912000000', address: '1 Phố Huế', province: 'Hà Nội', delivery_date: day,
        payment_method: 'cod', payment_status: 'pending', status: 'new', subtotal: 1, discount: 0, shipping_fee: 0, total: 500000, ...over });
      const id = typeof x === 'object' ? x.id : x;
      await db('order_items').insert({ order_id: id, product_id: p.id, name: p.name, price: 500000, qty: 1, line_total: 500000 });
      return id;
    };
    const ids = [
      await mk({ code: 'LN260125GA2A' }),
      await mk({ code: 'LN260125GB2B', payment_method: 'bank', payment_status: 'paid', is_gift: true, recipient_name: 'Chú Hai', recipient_phone: '0987', recipient_address: '5 Hàng Bông' }),
      await mk({ code: 'LN260125GC2C', payment_method: 'bank', payment_status: 'pending' }),
      await mk({ code: 'LN260125GD2D', status: 'cancelled' }),
    ];
    sent.length = 0;
    await tg.handleUpdate(msg('/giao 25/1', { is_topic_message: true, message_thread_id: 11 }));
    const t = lastSend()?.body.text || '';
    ok(/GIAO NGÀY 25\/01/.test(t) && /2 đơn/.test(t), '/giao 25/1 → đếm đúng 2 đơn sẵn sàng giao');
    ok(/LN260125GA2A[\s\S]*thu 500\.000/.test(t), 'Đơn COD ghi số tiền cần thu');
    ok(/LN260125GB2B<\/b> 🎁 tặng[\s\S]*Chú Hai[\s\S]*5 Hàng Bông/.test(t), 'Đơn tặng ghi người nhận + địa chỉ nhận');
    ok(/chưa thanh toán[\s\S]*LN260125GC2C/.test(t) && !/LN260125GD2D/.test(t), 'Đơn CK chưa trả → cảnh báo; đơn hủy không hiện');
    await db('order_items').whereIn('order_id', ids).del();
    await db('orders').whereIn('id', ids).del();
  }

  // COD chờ cọc: nút "💰 Đã nhận cọc" (xác nhận tay khi khách chuyển ngoài SePay)
  {
    const [x] = await db('orders').insert({ code: 'LN261014DPQQ', customer_name: 'Cọc', phone: '0912', address: 'x', province: 'Hà Nội', delivery_date: '2026-12-01',
      payment_method: 'cod', payment_status: 'pending', status: 'new', subtotal: 1, discount: 0, shipping_fee: 0, total: 1000000, deposit_amount: 300000, tg_chat_id: String(GROUP), tg_message_id: 98 });
    const id = typeof x === 'object' ? x.id : x;
    const kb = JSON.stringify(require('../src/lib/telegram-orders').keyboard(await db('orders').where({ id }).first()));
    ok(kb.includes(`o:${id}:dp`), 'Đơn COD chờ cọc có nút "💰 Đã nhận cọc"');
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${id}:dp`, from: { first_name: 'Lan' }, message: { message_id: 98, chat: { id: GROUP } } } });
    ok((await db('orders').where({ id }).first()).payment_status === 'deposit', 'Bấm "Đã nhận cọc" → đơn chuyển "Đã cọc"');
    await db('orders').where({ id }).del();
  }

  // Khách để lại SĐT → báo nhóm; bấm "✅ Đã gọi" → đánh dấu xong, sửa tin
  sent.length = 0;
  const cbReq = await require('../src/lib/callbacks').create({ name: 'Chị Mai', phone: '0912345678', interest: 'Giỏ An Khang', source: 'san-pham' });
  const cbMsg = lastSend();
  ok(cbMsg && /KHÁCH CẦN GỌI LẠI/.test(cbMsg.body.text) && cbMsg.body.message_thread_id === 11, 'Khách để lại SĐT → báo vào chủ đề Đơn hàng');
  const kb = JSON.stringify(cbMsg.body.reply_markup || {});
  ok(kb.includes(`g:${cbReq.id}:d`), 'Tin gọi lại có nút "✅ Đã gọi"');
  sent.length = 0;
  await tg.handleUpdate({ callback_query: { id: 'q1', data: `g:${cbReq.id}:d`, from: { first_name: 'Lan' }, message: { message_id: 1, chat: { id: GROUP } } } });
  const after = await db('callback_requests').where({ id: cbReq.id }).first();
  ok(after.status === 'done' && after.handled_by === 'Lan', 'Bấm "Đã gọi" → lưu trạng thái và người xử lý');
  ok(sent.some((x) => x.method === 'editMessageText' && /Đã gọi · Lan/.test(x.body.text)), 'Tin trong nhóm cập nhật "Đã gọi · Lan"');
  await db('callback_requests').where({ id: cbReq.id }).del();

  // Nhóm đổi mã mà web không nhận được tin báo → lúc gửi đơn tự chuyển sang mã mới
  await settings.save({ telegram_chat_id: String(OLD), telegram_order_thread: '', telegram_stock_thread: '' });
  migrateFrom = OLD;
  sent.length = 0;
  const r = await notify.telegram('<b>Đơn thử</b>');
  ok(r && String(lastSend()?.body.chat_id) === String(MIGRATED), 'Gửi vào mã nhóm cũ → tự gửi lại vào mã mới');
  ok(String(await notify.telegramChatId()) === String(MIGRATED), 'Lưu mã nhóm mới cho các lần sau');
  migrateFrom = null;

  // khôi phục
  await db('products').where({ id: p.id }).update({ stock: stock0 });
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
  await db.destroy(); // không treo tiến trình khi lỗi
});
