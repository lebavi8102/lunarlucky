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
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
