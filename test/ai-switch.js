/**
 * Kiểm thử công tắc bật/tắt AI Fanpage trên Telegram (/ai và nút bấm). Giả lập Telegram, chỉ dùng DB local.
 * Chạy: node test/ai-switch.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const settings = require('../src/lib/settings');
const config = require('../src/config');
const tg = require('../src/lib/telegram-orders');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }

const GROUP = -1005000001;
const sent = [];
config.telegram.token = 'test-token';
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body || '{}');
  const method = url.split('/').pop();
  if (method === 'getChatMember') return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: body.user_id === 777 ? 'member' : 'administrator' } }) };
  sent.push({ method, body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }) };
};
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const msg = (text, uid = 1) => ({ message: { text, chat: { id: GROUP, type: 'supergroup' }, from: { id: uid, first_name: 'Vi' }, message_id: 5 } });
const cbq = (data, uid = 1) => ({ callback_query: { id: 'c1', data, from: { id: uid, first_name: 'Vi' }, message: { message_id: 9, chat: { id: GROUP, type: 'supergroup' } } } });

(async () => {
  await db.migrate.latest();
  await settings.save({ telegram_chat_id: String(GROUP), messenger_ai_enabled: '1' });
  await tg.handleUpdate(msg('/ai'));
  let last = sent[sent.length - 1];
  ok(/BẬT/.test(last.body.text) && last.body.reply_markup.inline_keyboard[0][0].callback_data === 'ai:set:0', '/ai khi đang bật → nút "Tắt"');
  await tg.handleUpdate(cbq('ai:set:0'));
  ok(String((await settings.all()).messenger_ai_enabled) === '0', 'Bấm nút Tắt → setting = 0');
  last = sent.filter((s) => s.method === 'editMessageText').pop();
  ok(/TẮT/.test(last.body.text) && last.body.reply_markup.inline_keyboard[0][0].callback_data === 'ai:set:1', 'Tin được sửa thành "đang TẮT" + nút Bật');
  await tg.handleUpdate(cbq('ai:set:1', 777));
  ok(String((await settings.all()).messenger_ai_enabled) === '0', 'Người không phải quản trị bấm → không đổi được');
  await tg.handleUpdate(cbq('ai:set:1'));
  ok(String((await settings.all()).messenger_ai_enabled) === '1', 'Quản trị bấm Bật → setting = 1');
  await tg.handleUpdate(msg('/ai tat'));
  ok(String((await settings.all()).messenger_ai_enabled) === '0', '/ai tat → tắt luôn');
  await tg.handleUpdate(msg('/ai bat', 777));
  ok(String((await settings.all()).messenger_ai_enabled) === '0', 'Người thường gõ /ai bat → bị chặn');
  // Đổi mô hình AI
  await settings.save({ messenger_ai_enabled: '1', ai_model: 'claude-haiku-5-5' });
  await tg.handleUpdate(msg('/ai'));
  last = sent[sent.length - 1];
  ok(/Haiku/.test(last.body.text) && last.body.reply_markup.inline_keyboard[1].length === 4, '/ai hiện mô hình hiện tại + 4 nút chọn');
  ok(last.body.reply_markup.inline_keyboard[1][0].text.startsWith('✅'), 'Haiku được đánh dấu ✅');
  await tg.handleUpdate(cbq('ai:m:opus'));
  ok((await settings.all()).ai_model === 'claude-opus-5-5', 'Bấm Opus → ai_model = claude-opus-5-5');
  last = sent.filter((s) => s.method === 'editMessageText').pop();
  ok(/Opus/.test(last.body.text) && last.body.reply_markup.inline_keyboard[1][2].text.startsWith('✅'), 'Tin sửa lại, ✅ chuyển sang Opus');
  await tg.handleUpdate(cbq('ai:m:auto'));
  ok((await settings.all()).ai_model === 'auto', 'Bấm Tự động → ai_model = auto');
  await tg.handleUpdate(cbq('ai:m:sonnet', 777));
  ok((await settings.all()).ai_model === 'auto', 'Người thường bấm đổi model → bị chặn');
  await settings.save({ messenger_ai_enabled: '1', ai_model: 'claude-haiku-5-5' });
  console.log(fails ? `\n${fails} lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
