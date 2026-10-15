/**
 * Kiểm thử bot Telegram (giả lập API Telegram, không gửi tin thật):
 * lệnh kho, chủ đề (Topics) cho đơn hàng / kho, đổi mã nhóm khi bật Topics.
 * Chạy: node test/telegram-topics.js   (dùng database local, không cần server)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const settings = require('../src/lib/settings');
const { todayVN } = require('../src/lib/format');
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
  if (method === 'getChatMember') return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: body.user_id === 777 ? 'member' : 'administrator' } }) };
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
    ok(sent.some((x) => x.method === 'editMessageText' && /cần hoàn /.test(x.body.text)), 'Tin đơn trong nhóm ghi "cần hoàn tiền"');
    await press(`o:${oid}:r`);
    ok((await db('orders').where({ id: oid }).first()).status === 'cancelled', 'Bấm Khôi phục lần 1 → chỉ hỏi xác nhận');
    await press(`o:${oid}:rr`);
    ok((await db('orders').where({ id: oid }).first()).status === 'confirmed', 'Bấm "Có, khôi phục" → đơn sống lại');
    await db('order_items').where({ order_id: oid }).del();
    await db('orders').where({ id: oid }).del();
    await db('products').where({ id: p.id }).update({ stock: prod.stock });
  }

  // Bàn giao người xử lý ↔ shipper: nhận đi giao, giao xong + thu COD, giao không được, /thu
  {
    const [r1] = await db('orders').insert({ code: 'LN261015SHIP', customer_name: 'Khách Ship', phone: '0944555666', address: 'x', province: 'Hà Nội',
      delivery_date: todayVN(), payment_method: 'cod', payment_status: 'pending', status: 'packing', subtotal: 1040000, discount: 0, shipping_fee: 0, total: 1040000,
      tg_chat_id: String(GROUP), tg_message_id: 501 });
    const sid = typeof r1 === 'object' ? r1.id : r1;
    const tap = (data, who = 'Tuấn') => tg.handleUpdate({ callback_query: { id: 'q', data, from: { first_name: who }, message: { message_id: 501, chat: { id: GROUP } } } });
    const lastKb = () => [...sent].reverse().find((x) => x.method === 'editMessageText');
    const kbText = () => lastKb().body.reply_markup.inline_keyboard.flat().map((b) => b.text).join(' | ');
    sent.length = 0;
    await tap(`o:${sid}:s`);
    let o = await db('orders').where({ id: sid }).first();
    ok(o.status === 'shipping' && o.shipper === 'Tuấn', 'Bấm "Nhận đi giao" → ghi tên shipper');
    ok(/Đang giao: Tuấn/.test(lastKb().body.text) && /Đã giao xong/.test(kbText()) && /Giao không được/.test(kbText()), 'Tin đơn hiện shipper + 2 nút "Đã giao xong" / "Giao không được"');
    await tap(`o:${sid}:f`);
    ok(/Khách hẹn giao ngày khác/.test(kbText()), 'Bấm "Giao không được" → hiện lý do để chọn');
    sent.length = 0;
    await tap(`o:${sid}:f2`);
    o = await db('orders').where({ id: sid }).first();
    ok(o.status === 'confirmed' && !o.shipper && /Không liên lạc được/.test(o.handled_log), 'Chọn lý do → đơn về "Đã xác nhận", ghi lý do vào lịch sử');
    ok(sent.some((x) => x.method === 'sendMessage' && /giao không được/.test(x.body.text) && /0944555666/.test(x.body.text)), 'Báo nhóm: giao không được + SĐT khách để gọi lại');
    await tap(`o:${sid}:s`, 'Hùng');
    await tap(`o:${sid}:d`, 'Hùng');
    ok(/Đã thu 1\.040\.000₫ — giao xong/.test(kbText()), 'Giao xong đơn COD → hỏi "Đã thu 1.040.000₫?"');
    await tap(`o:${sid}:dc`, 'Hùng');
    o = await db('orders').where({ id: sid }).first();
    ok(o.status === 'completed' && o.payment_status === 'paid' && o.cod_collected_by === 'Hùng' && Number(o.cod_collected_amount) === 1040000, 'Đã thu → hoàn tất, ghi Hùng thu 1.040.000₫');
    // Đơn thứ 2: giao xong nhưng chưa thu
    const [r2] = await db('orders').insert({ code: 'LN261015OWE1', customer_name: 'Khách Nợ', phone: '0944555777', address: 'x', province: 'Hà Nội',
      delivery_date: todayVN(), payment_method: 'cod', payment_status: 'pending', status: 'shipping', subtotal: 500000, discount: 0, shipping_fee: 0, total: 500000,
      tg_chat_id: String(GROUP), tg_message_id: 502 });
    const oid2 = typeof r2 === 'object' ? r2.id : r2;
    await tap(`o:${oid2}:dn`, 'Hùng');
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 600, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Chủ' }, text: '/thu' } });
    const rep = sent.find((x) => x.method === 'sendMessage');
    ok(rep && /Hùng<\/b>: 1\.040\.000₫ \(1 đơn\)/.test(rep.body.text), '/thu → Hùng đã thu 1.040.000₫');
    ok(rep && /CHƯA thu tiền/.test(rep.body.text) && /LN261015OWE1/.test(rep.body.text), '/thu → liệt kê đơn đã giao mà chưa thu');
    // Quyền: shipper (không phải quản trị nhóm) không hủy đơn / không xác nhận chuyển khoản được
    const [r3] = await db('orders').insert({ code: 'LN261015PERM', customer_name: 'Khách Quyền', phone: '0944555888', address: '9 Phố Huế', province: 'Hà Nội',
      delivery_date: todayVN(), payment_method: 'bank', payment_status: 'pending', status: 'confirmed', subtotal: 1, discount: 0, shipping_fee: 0, total: 1,
      tg_chat_id: String(GROUP), tg_message_id: 503 });
    const pid3 = typeof r3 === 'object' ? r3.id : r3;
    const tapAs = (data, uid) => tg.handleUpdate({ callback_query: { id: 'q', data, from: { id: uid, first_name: 'Ship' }, message: { message_id: 503, chat: { id: GROUP, type: 'supergroup' } } } });
    sent.length = 0;
    await tapAs(`o:${pid3}:xx`, 777);
    await tapAs(`o:${pid3}:$`, 777);
    let p3 = await db('orders').where({ id: pid3 }).first();
    ok(p3.status === 'confirmed' && p3.payment_status === 'pending' && sent.some((x) => x.method === 'answerCallbackQuery' && /Chỉ quản trị viên/.test(x.body.text)),
      'Shipper (không phải quản trị nhóm) bấm Hủy / Đã nhận CK → bị chặn, có giải thích');
    await tapAs(`o:${pid3}:s`, 777);
    ok((await db('orders').where({ id: pid3 }).first()).status === 'shipping', 'Shipper vẫn bấm "Nhận đi giao" được');
    // Đổi ngày giao: /doingay MÃĐƠN dd/mm buổi
    await db('orders').where({ id: pid3 }).update({ status: 'confirmed', delivery_date: '2026-12-20' });
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 610, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Lan' }, text: '/doingay LN261015PERM 22/12 chieu' } });
    p3 = await db('orders').where({ id: pid3 }).first();
    ok(String(p3.delivery_date).slice(0, 10) === '2026-12-22' && p3.delivery_slot === 'chieu' && /Đổi ngày giao: 20\/12\/2026 → 22\/12\/2026/.test(p3.handled_log),
      '/doingay → đổi ngày + buổi, ghi lịch sử');
    ok(sent.some((x) => x.method === 'sendMessage' && /đổi sang giao <b>22\/12\/2026 · Chiều/.test(x.body.text)), 'Bot xác nhận ngày mới');
    ok(sent.some((x) => x.method === 'editMessageText'), 'Tin đơn trong nhóm được cập nhật ngày mới');
    await tg.handleUpdate({ message: { message_id: 611, chat: { id: GROUP, type: 'supergroup' }, from: { first_name: 'Lan' }, text: '/doingay 0944 555 888 23/12' } });
    ok(String((await db('orders').where({ id: pid3 }).first()).delivery_date).slice(0, 10) === '2026-12-23', '/doingay bằng SĐT khách cũng được');
    // Đơn đã trả tiền bị hủy → nút "Đã hoàn tiền"; khôi phục đơn khi kho không đủ → cảnh báo
    await db('orders').where({ id: pid3 }).update({ status: 'cancelled', payment_status: 'paid' });
    sent.length = 0;
    await tg.refreshOrderMessage(pid3);
    const kb = sent.find((x) => x.method === 'editMessageText');
    ok(/cần hoàn 1₫/.test(kb.body.text) && kb.body.reply_markup.inline_keyboard.flat().some((b) => /Đã hoàn tiền/.test(b.text)), 'Đơn đã trả tiền bị hủy → nhắc số tiền cần hoàn + nút "Đã hoàn tiền"');
    await tapAs(`o:${pid3}:rf`, 1);
    ok((await db('orders').where({ id: pid3 }).first()).payment_status === 'refunded', 'Bấm "Đã hoàn tiền" → trạng thái Đã hoàn tiền');
    const prodX = await db('products').first();
    await db('order_items').insert({ order_id: pid3, product_id: prodX.id, name: prodX.name, price: 1, qty: 3, line_total: 3 });
    const stockX = prodX.stock;
    await db('products').where({ id: prodX.id }).update({ stock: 1 });
    sent.length = 0;
    await tapAs(`o:${pid3}:rr`, 1);
    ok(sent.some((x) => x.method === 'answerCallbackQuery' && /Kho không đủ/.test(x.body.text)), 'Khôi phục đơn khi kho không đủ → cảnh báo kiểm hàng');
    await db('products').where({ id: prodX.id }).update({ stock: stockX });
    await db('order_items').where({ order_id: pid3 }).del();
    await db('orders').whereIn('id', [sid, oid2, pid3]).del();
  }

  // Luồng gọn: mỗi lúc 1 nút; kho "Đã soạn xong" → thẻ giao hàng sang chủ đề SHIPPER
  {
    await tg.handleUpdate({ message: { message_id: 700, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 88, from: { first_name: 'Chủ' }, text: '/chonship' } });
    ok((await settings.all()).telegram_ship_thread === '88', '/chonship lưu chủ đề shipper');
    const [rr] = await db('orders').insert({ code: 'LN261015FLOW', customer_name: 'Khách Luồng', phone: '0977000111', address: '12 Láng Hạ', province: 'Hà Nội',
      delivery_date: todayVN(), delivery_slot: 'chieu', payment_method: 'cod', payment_status: 'pending', status: 'confirmed', subtotal: 990000, discount: 0,
      shipping_fee: 50000, total: 1040000, tg_chat_id: String(GROUP), tg_message_id: 701 });
    const fid = typeof rr === 'object' ? rr.id : rr;
    await db('order_items').insert({ order_id: fid, product_id: null, name: 'Giỏ Cát Tường', price: 990000, qty: 1, line_total: 990000 });
    const btns = (m) => m.body.reply_markup.inline_keyboard.flat().map((b) => b.text);
    sent.length = 0;
    await tg.refreshOrderMessage(fid);
    let main = sent.find((x) => x.method === 'editMessageText');
    ok(JSON.stringify(btns(main)) === JSON.stringify(['📦 Đã soạn xong', '⋯ Thêm']) && /KHO soạn hàng/.test(main.body.text), 'Đơn đã xác nhận: chỉ 1 nút "Đã soạn xong" + "⋯ Thêm"');
    sent.length = 0;
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${fid}:m`, from: { id: 5, first_name: 'Chủ' }, message: { message_id: 701, chat: { id: GROUP, type: 'supergroup' } } } });
    ok(/Hủy đơn/.test(btns(sent.find((x) => x.method === 'editMessageText')).join()), '"⋯ Thêm" → hiện Hủy đơn / nhảy bước / mở admin');
    sent.length = 0;
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${fid}:p`, from: { id: 6, first_name: 'Kho Hà' }, message: { message_id: 701, chat: { id: GROUP, type: 'supergroup' } } } });
    const card = sent.find((x) => x.method === 'sendMessage' && x.body.message_thread_id === 88);
    ok(card && /GIAO HÀNG/.test(card.body.text) && /Chiều \(13h–17h\)/.test(card.body.text) && /THU 1\.040\.000₫/.test(card.body.text) && !/990\.000/.test(card.body.text),
      'Kho bấm "Đã soạn xong" → thẻ giao hàng vào chủ đề SHIPPER (buổi, tiền thu, không giá từng món)');
    ok(card && JSON.stringify(btns(card)) === JSON.stringify(['🚚 Nhận đi giao']), 'Thẻ shipper chỉ có nút "Nhận đi giao"');
    await db('orders').where({ id: fid }).update({ tg_ship_message_id: 1 }); // giả lập Telegram trả message_id = 1
    sent.length = 0;
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${fid}:s`, from: { id: 7, first_name: 'Hùng' }, message: { message_id: 1, chat: { id: GROUP, type: 'supergroup' } } } });
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${fid}:d`, from: { id: 7, first_name: 'Hùng' }, message: { message_id: 1, chat: { id: GROUP, type: 'supergroup' } } } });
    const shipEdit = [...sent].reverse().find((x) => x.method === 'editMessageText' && x.body.message_id === 1);
    ok(shipEdit && /Đã thu 1\.040\.000₫/.test(btns(shipEdit).join()), 'Shipper bấm trên thẻ → hỏi đã thu tiền ngay trên thẻ của mình');
    await tg.handleUpdate({ callback_query: { id: 'q', data: `o:${fid}:dc`, from: { id: 7, first_name: 'Hùng' }, message: { message_id: 1, chat: { id: GROUP, type: 'supergroup' } } } });
    const f1 = await db('orders').where({ id: fid }).first();
    ok(f1.status === 'completed' && f1.cod_collected_by === 'Hùng', 'Giao xong + đã thu → hoàn tất, ghi Hùng thu tiền');
    await settings.save({ telegram_ship_thread: '' });
    await db('order_items').where({ order_id: fid }).del();
    await db('orders').where({ id: fid }).del();
  }

  // Ghi chú cho người xử lý: ngoài Hà Nội, khách quen, hay hủy, có thể trùng đơn
  {
    const mk = async (o) => {
      const [r] = await db('orders').insert({ customer_name: 'Khách', phone: '0933111222', address: 'x', delivery_date: '2026-12-20', payment_method: 'cod',
        payment_status: 'pending', status: 'new', subtotal: 1, discount: 0, shipping_fee: 0, total: 1, province: 'Hà Nội', ...o });
      return typeof r === 'object' ? r.id : r;
    };
    const ids = [];
    const days = (n) => new Date(Date.now() - n * 86400000);
    ids.push(await mk({ code: 'LN251201OLD1', status: 'completed', created_at: days(300) }));
    ids.push(await mk({ code: 'LN251201CAN1', status: 'cancelled', created_at: days(200) }));
    ids.push(await mk({ code: 'LN251201CAN2', status: 'cancelled', created_at: days(100) }));
    ids.push(await mk({ code: 'LN261015DUP1', created_at: new Date(Date.now() - 20 * 60000) }));
    ids.push(await mk({ code: 'LN261015HCM1', province: 'TP. Hồ Chí Minh', created_at: new Date() }));
    const o = await db('orders').where({ id: ids[4] }).first();
    const notes = await tg.opsNotes(o);
    ok(/Ngoài Hà Nội.*muộn nhất 18\/12\/2026/.test(notes), 'Đơn ngoài Hà Nội → nhắc gửi chuyển phát muộn nhất 2 ngày trước ngày giao');
    ok(/Khách quen · đã mua 1 đơn trước/.test(notes), 'Khách đã mua trước → "Khách quen"');
    ok(/2 đơn hủy/.test(notes), 'SĐT từng hủy 2 đơn → cảnh báo gọi xác nhận');
    ok(/Có thể trùng đơn<\/b> LN261015DUP1/.test(notes), 'Cùng SĐT đặt 2 đơn gần nhau → cảnh báo trùng đơn');
    const text = tg.messageText(o, [{ name: 'Giỏ', qty: 1, line_total: 1 }], notes);
    ok(/Phí giao: miễn phí/.test(text) && /Ngoài Hà Nội/.test(text), 'Tin đơn hiện ghi chú + "Phí giao: miễn phí"');
    const plain = await tg.opsNotes({ id: -1, phone: '0900000999', province: 'Hà Nội', delivery_date: '2026-12-20', status: 'new', created_at: new Date() });
    ok(plain === null, 'Khách mới ở Hà Nội → không có ghi chú thừa');
    await db('orders').whereIn('id', ids).del();
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
    // Chủ đề ảnh giao hàng: /chonanh, rồi chỉ cần ảnh + mã đơn (không gõ lệnh)
    await tg.handleUpdate({ message: { message_id: 60, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'A' }, text: '/chonanh' } });
    ok((await settings.all()).telegram_photo_thread === '65', '/chonanh lưu chủ đề ảnh giao hàng');
    await tg.handleUpdate({ message: { message_id: 61, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'p', width: 800, height: 800, file_size: 5000 }], caption: 'đã giao ln261014phtq khách khen đẹp' } });
    const t3 = await db('testimonials').where({ order_code: 'LN261014PHTQ' }).orderBy('id', 'desc').first();
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 3 && t3.content === 'đã giao khách khen đẹp', 'Trong chủ đề ảnh: ảnh + mã đơn → tự lưu, không cần /anhgiao');
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 62, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'q', width: 800, height: 800 }] } });
    ok(sent.some((x) => /chưa có <b>SĐT khách/.test(x.body.text || '') && x.body.message_thread_id === 65), 'Ảnh không mã/SĐT → nhắc trả lời bằng SĐT khách, ngay trong chủ đề');
    await tg.handleUpdate({ message: { message_id: 63, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      text: 'LN261014PHTQ', reply_to_message: { message_id: 62, photo: [{ file_id: 'q', width: 800, height: 800 }] } } });
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 4, 'Trả lời ảnh bằng mã đơn → lưu');
    // Shipper ghi SĐT khách thay mã đơn (có dấu cách/chấm cũng được)
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 70, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      photo: [{ file_id: 's', width: 800, height: 800 }], caption: '0912.345.678 khách khen' } });
    const t5 = await db('testimonials').where({ order_code: 'LN261014PHTQ' }).orderBy('id', 'desc').first();
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 5 && t5.content === 'khách khen', 'Ảnh + SĐT khách → tự tìm đúng đơn, lưu lời khen');
    ok(sent.some((x) => /LN261014PHTQ<\/b> · Nguyễn Thanh Huyền/.test(x.body.text || '')), 'Bot báo lại mã đơn + tên khách để đối chiếu');
    await tg.handleUpdate({ message: { message_id: 71, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      text: '+84 912 345 678', reply_to_message: { message_id: 62, photo: [{ file_id: 'q', width: 800, height: 800 }] } } });
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 6, 'Trả lời ảnh bằng SĐT dạng +84 → cũng khớp');
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 72, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 65, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'u', width: 800, height: 800 }], caption: '0987000111' } });
    ok(sent.some((x) => /Không tìm thấy đơn nào có SĐT/.test(x.body.text || '')), 'SĐT không có đơn → bot báo lại');
    // Đơn tặng: SĐT người nhận cũng khớp; nhiều đơn cùng SĐT → ưu tiên đơn đang giao
    const [gRaw] = await db('orders').insert({
      code: 'LN261014GIFT', customer_name: 'Trần Văn B', phone: '0900000001', address: 'x', province: 'Hà Nội', is_gift: true,
      recipient_name: 'Lê Thị C', recipient_phone: '0977111222', recipient_address: 'y',
      delivery_date: todayVN(), payment_method: 'cod', payment_status: 'pending', status: 'shipping', subtotal: 1, discount: 0, shipping_fee: 0, total: 1,
    });
    const [oldRaw] = await db('orders').insert({
      code: 'LN250101OLDD', customer_name: 'Lê Thị C', phone: '0977111222', address: 'z', province: 'Hà Nội',
      delivery_date: '2025-01-01', payment_method: 'cod', payment_status: 'paid', status: 'completed', subtotal: 1, discount: 0, shipping_fee: 0, total: 1,
    });
    const found = await require('../src/lib/testimonials').findOrderByPhone('0977 111 222');
    ok(found && found.code === 'LN261014GIFT', `SĐT người nhận quà khớp, ưu tiên đơn đang giao hôm nay (${found && found.code})`);
    await db('orders').whereIn('id', [gRaw, oldRaw].map((x) => (typeof x === 'object' ? x.id : x))).del();
    sent.length = 0;
    await tg.handleUpdate({ message: { message_id: 64, chat: { id: GROUP, type: 'supergroup' }, is_topic_message: true, message_thread_id: 36, from: { first_name: 'Shipper' },
      photo: [{ file_id: 'z', width: 80, height: 80 }], caption: 'LN261014PHTQ' } });
    ok((await db('testimonials').where({ order_code: 'LN261014PHTQ' })).length === 6 && !sent.length, 'Ảnh ở chủ đề khác → bot bỏ qua');
    await settings.save({ telegram_photo_thread: '' });
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
