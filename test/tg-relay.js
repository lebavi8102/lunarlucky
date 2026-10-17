/**
 * Kiểm thử trả lời khách Fanpage ngay trong Telegram — Facebook, Telegram, Claude đều giả lập.
 * Chạy: node test/tg-relay.js   (database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
Object.assign(process.env, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key', FB_PAGE_TOKEN: 'page-tok', FB_APP_SECRET: 'app-secret', FB_VERIFY_TOKEN: 'verify-me' });
const config = require('../src/config');
config.telegram.token = 'test-token';
config.telegram.chatId = '-100777';
const ai = require('../src/lib/ai-sales');
const m = require('../src/lib/messenger');
const notify = require('../src/lib/notify');
const settings = require('../src/lib/settings');
const tgBot = require('../src/lib/telegram-orders');

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };
const PSID = 'relay-psid-' + Date.now();
const CHAT = -100777;
const msg = (text, extra = {}) => ({ object: 'page', entry: [{ messaging: [{ sender: { id: PSID }, recipient: { id: 'PAGE' }, timestamp: Date.now(), message: { mid: 'm' + Math.random(), text, ...extra } }] }] });

(async () => {
  const backup = await settings.all();
  const realTg = notify.telegram; const realApi = notify.tgApi;
  try {
    await db.migrate.latest();
    await settings.save({ telegram_chat_id: String(CHAT), messenger_ai_enabled: '1' });

    // Telegram giả: mỗi tin bot gửi có message_id riêng
    let nextId = 1000;
    const tg = []; const api = [];
    notify.telegram = async (html, c, extra = {}) => { const r = { message_id: ++nextId, chat: { id: CHAT } }; tg.push({ html, extra, id: r.message_id }); return r; };
    notify.tgApi = async (method, body) => { api.push({ method, body }); return true; };
    const sent = [];
    let failNext = null;
    m._setSend(async (b) => { if (failNext) { const e = failNext; failNext = null; return { error: e }; } sent.push(b); return { message_id: 'mid' + sent.length }; });
    m._setPause(async () => {});
    m._setProfile(async () => ({ first: 'Hoa', last: 'Lê' }));
    m._setConversation(async () => null);
    ai._setClient({ beta: { messages: { create: async () => ({ stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Dạ em chào chị.' }] }) } } });

    // 1) Khách đòi gặp người thật → cảnh báo trên Telegram có hướng dẫn reply
    await m.handleWebhook(msg('cho mình gặp nhân viên'));
    const alert = tg.find((t) => /cần gặp người thật/.test(t.html));
    ok(alert && /✍️ Trả lời khách/.test(alert.html) && alert.extra.topic === 'consult', 'Cảnh báo "gặp người thật" có hướng dẫn trả lời ngay trong Telegram');

    // 2) Nhân viên reply cảnh báo → khách nhận tin, AI tạm dừng, có ghi chú cho AI
    sent.length = 0; api.length = 0;
    await tgBot.handleUpdate({ message: { message_id: 1, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9, first_name: 'Mai' }, text: 'Dạ chị Hoa ơi, em là Mai bên Lunar Lucky ạ', reply_to_message: { message_id: alert.id } } });
    const out = sent.find((b) => b.message && b.message.text);
    ok(out && out.recipient.id === PSID && out.message.text.startsWith('Dạ chị Hoa ơi') && out.message.metadata === m.STAFF_TAG && out.messaging_type === 'RESPONSE', 'Reply trong Telegram → gửi đúng khách qua Messenger');
    ok(api.some((a) => a.method === 'setMessageReaction'), 'Gửi xong → bot thả 👍 vào tin của nhân viên');
    const th = await db('messenger_threads').where({ psid: PSID }).first();
    ok(Number(th.paused_until_ms) > Date.now() && /Nhân viên: Dạ chị Hoa ơi/.test(th.notes || ''), 'AI tạm dừng với khách và ghi nhớ lời nhân viên');

    // 3) Facebook gửi echo tin vừa gửi → không bị coi là người khác trả lời trong hộp thư (không chuyển trùng về Telegram)
    tg.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: PSID }, timestamp: Date.now(), message: { is_echo: true, mid: 'mid1', text: out.message.text, metadata: m.STAFF_TAG } }] }] });
    ok(!tg.length, 'Bản sao (echo) tin nhân viên gửi từ Telegram không bị báo trùng');

    // 4) Khách nhắn tiếp lúc AI dừng → hiện trong Telegram, AI không trả lời
    sent.length = 0; tg.length = 0;
    await m.handleWebhook(msg('em gửi chị ảnh giỏ thật nhé', { attachments: [{ type: 'image', payload: { url: 'https://cdn.fb/x.jpg' } }] }));
    const relayed = tg.find((t) => /ảnh giỏ thật/.test(t.html) && /Lê Hoa/.test(t.html));
    ok(relayed && /ảnh giỏ thật/.test(relayed.html) && /cdn\.fb\/x\.jpg/.test(relayed.html) && !sent.some((b) => b.message), 'Tin khách (kèm ảnh) chuyển về Telegram, AI im');

    // 5) Reply vào tin khách vừa chuyển về → cũng gửi được; gửi ảnh từ Telegram
    sent.length = 0;
    m._setDownloadTg(async () => Buffer.from('jpg'));
    m._setUpload(async () => 'att-123');
    await tgBot.handleUpdate({ message: { message_id: 2, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, caption: 'Ảnh giỏ An Khang thật ạ', photo: [{ file_id: 'f1' }], reply_to_message: { message_id: relayed.id } } });
    ok(sent.length === 2 && sent[0].message.attachment.payload.attachment_id === 'att-123' && sent[1].message.text === 'Ảnh giỏ An Khang thật ạ', 'Reply bằng ảnh + chữ → khách nhận ảnh rồi chữ');

    // 6) Quá 24 giờ → báo nhân viên lý do rõ ràng
    api.length = 0;
    failNext = '{"error":{"message":"(#10) This message is sent outside of allowed window.","code":10,"error_subcode":2018278}}';
    m._setSend.call(null, (() => { const queue = [failNext, failNext]; failNext = null; return async (b) => (queue.length ? { error: queue.shift() } : (sent.push(b), true)); })());
    await tgBot.handleUpdate({ message: { message_id: 3, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, text: 'chị ơi', reply_to_message: { message_id: relayed.id } } });
    const warn = api.find((a) => a.method === 'sendMessage');
    ok(warn && /quá 24 giờ/.test(warn.body.text), 'Quá 24 giờ → bot báo nhân viên gọi điện thay vì im lặng');

    // 7) Reply tin bình thường (không phải tin khách Fanpage) → bot không làm gì
    api.length = 0; sent.length = 0;
    await tgBot.handleUpdate({ message: { message_id: 4, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, text: 'ok', reply_to_message: { message_id: 1 } } });
    ok(!api.length && !sent.length, 'Reply tin thường trong nhóm → không gửi gì cho khách');

    // 7b) Nút trên điện thoại: Trả lời khách → bot mở ô gõ sẵn (force reply); gõ vào đó là gửi cho khách
    const kb = alert.extra.reply_markup.inline_keyboard;
    ok(kb[0][0].callback_data === `fb:r:${PSID}` && kb[1].some((b) => b.callback_data === `fb:a:${PSID}`), 'Cảnh báo có nút ✍️ Trả lời khách, 📜 Xem tin, ▶️ Bật lại AI');
    ok(relayed.extra.reply_markup && relayed.extra.reply_markup.inline_keyboard[0][0].callback_data === `fb:r:${PSID}`, 'Tin khách chuyển về cũng có nút Trả lời');
    api.length = 0;
    const realSendApi = notify.tgApi;
    notify.tgApi = async (method, body) => { api.push({ method, body }); return method === 'sendMessage' ? { message_id: 5555, chat: { id: CHAT } } : true; };
    await tgBot.handleUpdate({ callback_query: { id: 'c1', data: `fb:r:${PSID}`, from: { id: 9, first_name: 'Mai' }, message: { message_id: alert.id, chat: { id: CHAT } } } });
    const prompt = api.find((a) => a.method === 'sendMessage');
    ok(prompt && prompt.body.reply_markup.force_reply && prompt.body.reply_markup.selective && /tg:\/\/user\?id=9/.test(prompt.body.text), 'Bấm ✍️ → bot mở ô gõ cho đúng người bấm');
    m._setSend(async (b) => { sent.push(b); return { message_id: 'x' + Math.random() }; });
    sent.length = 0;
    await tgBot.handleUpdate({ message: { message_id: 6, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, text: 'Dạ em gửi báo giá ạ', reply_to_message: { message_id: 5555 } } });
    ok(sent.some((b) => b.message && b.message.text === 'Dạ em gửi báo giá ạ'), 'Gõ vào ô vừa mở → khách nhận được tin');

    // Telegram máy tính không gắn "trả lời": bấm ✍️ rồi gửi tin thường → vẫn tới khách; người khác nhắn thì không
    await tgBot.handleUpdate({ callback_query: { id: 'c1b', data: `fb:r:${PSID}`, from: { id: 9, first_name: 'Mai' }, message: { message_id: alert.id, chat: { id: CHAT } } } });
    sent.length = 0;
    await tgBot.handleUpdate({ message: { message_id: 7, chat: { id: CHAT, type: 'supergroup' }, from: { id: 10 }, text: 'tin của người khác' } });
    ok(!sent.length, 'Người khác nhắn trong nhóm sau khi Mai bấm ✍️ → không gửi cho khách');
    await tgBot.handleUpdate({ message: { message_id: 8, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, text: 'em chào chị ạ' } });
    ok(sent.some((b) => b.message && b.message.text === 'em chào chị ạ'), 'Bấm ✍️ rồi gửi tin thường (không reply) → khách vẫn nhận được');
    ok(api.some((a) => a.method === 'sendMessage' && /Đã gửi cho/.test(a.body.text) && /fb:r:/.test(JSON.stringify(a.body.reply_markup))), 'Gửi xong → bot báo "Đã gửi" kèm nút Trả lời tiếp');
    sent.length = 0;
    await tgBot.handleUpdate({ message: { message_id: 9, chat: { id: CHAT, type: 'supergroup' }, from: { id: 9 }, text: 'nói chuyện nội bộ' } });
    ok(!sent.length, 'Chỉ tin đầu tiên sau khi bấm mới gửi khách — tin sau đó là chat nội bộ');

    api.length = 0;
    await tgBot.handleUpdate({ callback_query: { id: 'c2', data: `fb:h:${PSID}`, from: { id: 9 }, message: { message_id: alert.id, chat: { id: CHAT } } } });
    const hist = api.find((a) => a.method === 'sendMessage');
    ok(hist && /10 tin gần nhất/.test(hist.body.text) && /gặp nhân viên/.test(hist.body.text) && /Dạ em gửi báo giá/.test(hist.body.text), 'Bấm 📜 → xem lại cuộc trò chuyện (khách + nhân viên)');

    await tgBot.handleUpdate({ callback_query: { id: 'c3', data: `fb:a:${PSID}`, from: { id: 9, first_name: 'Mai' }, message: { message_id: alert.id, chat: { id: CHAT } } } });
    const th2 = await db('messenger_threads').where({ psid: PSID }).first();
    ok(Number(th2.paused_until_ms) === 0 && Number(th2.relay_until_ms) === 0, 'Bấm ▶️ → AI trả lời khách trở lại, tin khách thôi chuyển về Telegram');
    sent.length = 0; tg.length = 0;
    await m.handleWebhook(msg('giỏ nào hợp biếu sếp?'));
    ok(sent.some((b) => b.message && b.message.text === 'Dạ em chào chị.') && !tg.length, 'Sau khi bật lại → AI trả lời, không báo về nhóm');
    notify.tgApi = realSendApi;
    sent.length = 0;

    // 8) Nhóm lạ không dùng được
    await tgBot.handleUpdate({ message: { message_id: 5, chat: { id: -1, type: 'supergroup' }, from: { id: 9 }, text: 'hack', reply_to_message: { message_id: alert.id } } });
    ok(!sent.length, 'Nhóm Telegram khác không nhắn được cho khách');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    notify.telegram = realTg; notify.tgApi = realApi;
    await db('messenger_threads').where({ psid: PSID }).del();
    await db('conv_log').where({ psid: PSID }).del();
    await db('tg_fb_links').where({ psid: PSID }).del();
    await settings.save({ telegram_chat_id: backup.telegram_chat_id || '', messenger_ai_enabled: backup.messenger_ai_enabled || '1' });
  }
  console.log(fails ? `\n${fails} lỗi` : '\nTất cả đều ổn');
  process.exit(fails ? 1 : 0);
})();
