/**
 * Kiểm thử AI tư vấn trên Fanpage (Messenger) — Claude và Facebook đều giả lập, không tốn tiền.
 * Chạy: node test/messenger.js   (database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const crypto = require('crypto');
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
Object.assign(process.env, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key', FB_PAGE_TOKEN: 'page-tok', FB_APP_SECRET: 'app-secret', FB_VERIFY_TOKEN: 'verify-me' });
const ai = require('../src/lib/ai-sales');
const m = require('../src/lib/messenger');
const { todayVN } = require('../src/lib/format');

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };
const PSID = 'test-psid-' + Date.now();
const msg = (text, extra = {}) => ({ object: 'page', entry: [{ messaging: [{ sender: { id: PSID }, recipient: { id: 'PAGE' }, message: { mid: 'm' + Math.random(), text, ...extra } }] }] });

(async () => {
  try {
    await db.migrate.latest();
    const prod = await db('products').where({ is_active: true }).andWhere('stock', '>', 5).orderBy('price').first();

    // Chữ ký & bước xác minh webhook
    const raw = Buffer.from(JSON.stringify(msg('hi')));
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(raw).digest('hex');
    ok(m.verifySignature(raw, sig) && !m.verifySignature(raw, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')) && !m.verifySignature(raw, ''), 'Chỉ nhận webhook có chữ ký đúng của Facebook');
    ok(m.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42' }) === '42'
      && m.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'sai', 'hub.challenge': '42' }) === null, 'Bước xác minh webhook: đúng mã mới trả lời');
    ok(m.plain('Em gợi ý **Giỏ An Khang** /san-pham/an-khang').includes('Giỏ An Khang http') && !m.plain('**x**').includes('*'), 'Bỏ in đậm, đổi link thành link đầy đủ');

    const sent = [];
    m._setSend(async (b) => { sent.push(b); return true; });
    const calls = [];
    ai._setClient({ beta: { messages: { create: async (p) => {
      calls.push(p);
      const last = p.messages[p.messages.length - 1];
      if (typeof last.content === 'string' && /chốt/.test(last.content)) {
        return { stop_reason: 'tool_use', model: 'fake', usage: {}, content: [{ type: 'tool_use', id: 'tu' + calls.length, name: 'prepare_order', input: {
          items: [{ product_id: prod.id, qty: 1 }], customer_name: 'Chị Lan FB', phone: '0912345000', province: 'Hà Nội', address: '3 Phố Huế',
          is_gift: false, delivery_date: todayVN(3), payment_method: 'bank' } }] };
      }
      return { stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Dạ em gợi ý **Giỏ An Khang** ạ.' }] };
    } } } });

    m._setProfile(async () => ({ first: 'Lan', last: 'Trần Thị' }));
    await m.handleWebhook(msg('quà cho bố mẹ 2 triệu'));
    ok(/Tên Facebook của khách: Trần Thị Lan/.test(calls[0].system[1].text) && (await db('messenger_threads').where({ psid: PSID }).first()).name === 'Trần Thị Lan', 'Lấy tên Facebook của khách (họ trước tên sau) → AI gọi đúng tên');
    const texts = sent.filter((b) => b.message && b.message.text);
    ok(texts.length === 1 && texts[0].message.text === 'Dạ em gợi ý Giỏ An Khang ạ.' && texts[0].message.metadata === m.AI_TAG && sent.some((b) => b.sender_action === 'typing_on'), 'Khách nhắn → AI trả lời (chữ thường, có hiện "đang soạn")');
    ok(calls[0].system.length === 2 && /Messenger/.test(calls[0].system[1].text), 'AI biết đang chat qua Messenger');

    sent.length = 0;
    await m.handleWebhook(msg('ok chốt đơn nhé'));
    const btn = sent.find((b) => b.message && b.message.attachment);
    const url = btn && btn.message.attachment.payload.buttons[0].url;
    ok(url && /\/tu-van\/don\/[\w-]+$/.test(url), 'Khách chốt → AI gửi nút "Kiểm tra & đặt hàng"');
    const th = await db('messenger_threads').where({ psid: PSID }).first();
    ok(th && JSON.parse(th.history).length >= 4, 'Lịch sử trò chuyện lưu theo từng khách');
    const h = await m.loadHandoff(url.split('/').pop());
    ok(h && h.cart.lines[0].productId === prod.id && h.prefill.phone === '0912345000' && h.prefill.source === 'ai_fb', 'Link đặt hàng mang theo giỏ + thông tin khách, đánh dấu kênh "AI Fanpage"');
    ok(!(await m.loadHandoff('khong-ton-tai-123')), 'Link sai → không mở được');
    ok(h.prefill.psid === PSID, 'Link đặt hàng nhớ người nhắn Messenger');

    // Khách đã chốt (có link) mà 2 giờ sau chưa đặt → nhắc nhóm gọi lại, mỗi khách 1 lần
    await db('ai_handoffs').where({ psid: PSID }).update({ created_ms: Date.now() - 3 * 3600000 });
    ok(await m.followUpAbandoned() === 1 && await m.followUpAbandoned() === 0, 'Chốt mà chưa đặt sau 2 giờ → báo TƯ VẤN KHÁCH gọi lại (1 lần)');
    await db('ai_handoffs').where({ psid: PSID }).update({ followed: false });
    const [oid] = await db('orders').insert({ code: 'LN26TESTFU01', customer_name: 'Chị Lan FB', phone: '0912345000', province: 'Hà Nội', address: 'x', delivery_date: todayVN(3), payment_method: 'bank', payment_status: 'pending', status: 'new', subtotal: 1, discount: 0, shipping_fee: 0, total: 1, messenger_psid: PSID, created_at: new Date() });
    ok(await m.followUpAbandoned() === 0, 'Khách đã đặt đơn → không nhắc');
    await db('orders').where({ code: 'LN26TESTFU01' }).del();

    // Đơn từ AI Fanpage → báo khách qua Messenger: vừa đặt (kèm QR), nhắc chuyển khoản, đã nhận tiền
    sent.length = 0;
    const fakeOrder = { code: 'LN26TESTMSG1', total: 1990000, deposit_amount: 0, payment_method: 'bank', payment_status: 'pending', status: 'new', delivery_date: todayVN(3), messenger_psid: PSID };
    await m.orderUpdate(fakeOrder, 'placed', { until: '14:30 17/10' });
    const pl = sent[0] && sent[0].message.attachment.payload;
    ok(pl && /LN26TESTMSG1/.test(pl.text) && /chuyển khoản 1\.990\.000/.test(pl.text) && /14:30 17\/10/.test(pl.text) && /\/don-hang\/LN26TESTMSG1\?k=/.test(pl.buttons[0].url) && sent[0].message.metadata === m.AI_TAG,
      'Đặt xong → Messenger báo mã đơn, số tiền cần chuyển, hạn giữ đơn, nút xem đơn & QR');
    sent.length = 0;
    await m.orderUpdate({ ...fakeOrder, payment_status: 'paid' }, 'paid');
    ok(sent[0] && /đã nhận đủ tiền/.test(sent[0].message.attachment.payload.text), 'Tiền về → Messenger báo đã nhận tiền');
    sent.length = 0;
    await m.orderUpdate({ ...fakeOrder, payment_status: 'paid' }, 'reminder');
    ok(!sent.length, 'Đã trả tiền → không nhắc');
    await m.orderUpdate({ ...fakeOrder, messenger_psid: null }, 'placed');
    ok(!sent.length, 'Đơn không từ Messenger → không gửi gì');

    // Bản sao (echo) tin của chính AI, Facebook không gửi kèm nhãn → không được hiểu nhầm là người thật (lỗi AI im sau 1 câu)
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: PSID }, message: { is_echo: true, app_id: 123, text: 'Dạ em gợi ý' } }] }] });
    const tp = await db('messenger_threads').where({ psid: PSID }).first();
    ok(Number(tp.paused_until_ms) < Date.now(), 'Bản sao tin của AI (không nhãn) ngay sau khi AI gửi → AI vẫn trả lời tiếp');
    sent.length = 0;
    await m.handleWebhook(msg('Hà Nội giao ngày 19/10'));
    ok(sent.some((b) => b.message && b.message.text), 'Khách nhắn tiếp → AI trả lời tiếp');

    // Người thật trả lời trong hộp thư → AI im
    m._resetEchoState();
    sent.length = 0;
    const n = calls.length;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: PSID }, message: { is_echo: true, text: 'Chào chị, em là Vy ạ' } }] }] });
    await m.handleWebhook(msg('vậy giao sáng được không'));
    ok(calls.length === n && !sent.length, 'Người thật trả lời trong hộp thư → AI không chen vào với khách đó');
    // Hết thời gian tạm dừng → AI nói tiếp, biết nhân viên đã báo gì (không nói ngược)
    await db('messenger_threads').where({ psid: PSID }).update({ paused_until_ms: 0 });
    await m.handleWebhook(msg('vậy chốt giúp mình nhé'));
    const lastUser = calls[calls.length - 1].messages.filter((x) => x.role === 'user' && typeof x.content === 'string').pop();
    ok(lastUser && /Nhân viên: Chào chị, em là Vy ạ/.test(lastUser.content) && /Khách: vậy giao sáng được không/.test(lastUser.content), 'AI nói tiếp biết nhân viên và khách đã nhắn gì lúc AI tạm dừng');
    ok(!(await db('messenger_threads').where({ psid: PSID }).first()).notes, 'Ghi chú dùng xong thì xóa');
    // Nhắn quá số tin/ngày → chuyển người thật
    await db('messenger_threads').where({ psid: PSID }).update({ day_key: todayVN(), day_count: 60, paused_until_ms: 0 });
    sent.length = 0;
    const n2 = calls.length;
    await m.handleWebhook(msg('spam'));
    ok(calls.length === n2 && /chuyển chuyên viên/.test(sent[0].message.text) && Number((await db('messenger_threads').where({ psid: PSID }).first()).paused_until_ms) > Date.now(), 'Quá 60 tin/ngày → không gọi AI, chuyển người thật');
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: PSID + 'x' }, message: { is_echo: true, metadata: m.AI_TAG, text: 'AI' } }] }] });
    ok(!(await db('messenger_threads').where({ psid: PSID + 'x' }).first()), 'Tin của chính AI (echo) → không tính là người thật');

    // Tin tự động của Fanpage (phản hồi tức thì) đến ngay sau tin khách → không phải người thật
    const P4 = PSID + 'auto';
    m._resetEchoState();
    m._setProfile(async () => null);
    const now = Date.now();
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P4 }, recipient: { id: 'PAGE' }, timestamp: now, message: { text: 'Tư vấn quà doanh nghiệp' } }] }] });
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: 'PAGE' }, recipient: { id: P4 }, timestamp: now + 1500, message: { is_echo: true, app_id: 999, text: 'Xin chào, cảm ơn bạn đã liên hệ' } }] }] });
    const t4 = await db('messenger_threads').where({ psid: P4 }).first();
    ok(t4 && Number(t4.paused_until_ms) < Date.now(), 'Tin tự động của Fanpage ngay sau tin khách → AI không bị dừng');
    const lastSys = calls[calls.length - 1].system;
    ok(!lastSys.some((b) => /Tên Facebook/.test(b.text)) && /xin tên/.test(lastSys[0].text), 'Không lấy được tên Facebook → AI tự xin tên khách');

    // Khách đòi gặp người thật
    const P2 = PSID + 'h';
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P2 }, recipient: { id: 'PAGE' }, message: { text: 'cho mình gặp nhân viên' } }] }] });
    const t2 = await db('messenger_threads').where({ psid: P2 }).first();
    ok(t2 && Number(t2.paused_until_ms) > Date.now() && /chuyên viên/.test(sent[0].message.text), '"gặp nhân viên" → báo chuyên viên, AI tạm dừng');

    // Ảnh / sticker
    const P3 = PSID + 'a';
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { sticker_id: 369239263222822, attachments: [{ type: 'image' }] } }] }] });
    ok(!sent.length, 'Sticker "like" → không trả lời');
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { attachments: [{ type: 'image' }] } }] }] });
    ok(sent.length === 1 && /tin chữ/.test(sent[0].message.text), 'Khách gửi ảnh → nhờ gõ chữ');

    // Khách nhắn "xóa dữ liệu" → xóa lịch sử
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { text: 'Xóa dữ liệu' } }] }] });
    ok(!(await db('messenger_threads').where({ psid: P3 }).first()) && /đã xóa/.test(sent[0].message.text), 'Khách nhắn "xóa dữ liệu" → xóa lịch sử, báo xác nhận');
    await db('messenger_threads').where('psid', 'like', PSID + '%').del();
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
