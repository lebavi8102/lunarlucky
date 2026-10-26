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
const settings = require('../src/lib/settings');
const { todayVN } = require('../src/lib/format');

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };
const PSID = 'test-psid-' + Date.now();
const msg = (text, extra = {}) => ({ object: 'page', entry: [{ messaging: [{ sender: { id: PSID }, recipient: { id: 'PAGE' }, message: { mid: 'm' + Math.random(), text, ...extra } }] }] });

(async () => {
  try {
    await db.migrate.latest();
    const prod = await db('products').where({ is_active: true }).andWhere('stock', '>=', 5).orderBy('price').first();

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
      if (typeof last.content === 'string' && /chị Lan đây/.test(last.content)) {
        return { stop_reason: 'tool_use', model: 'fake', usage: {}, content: [{ type: 'tool_use', id: 'tu' + calls.length, name: 'remember_customer', input: { title: 'chị', name: 'Lan' } }] };
      }
      if (typeof last.content === 'string' && /đổi món/.test(last.content)) {
        return { stop_reason: 'tool_use', model: 'fake', usage: {}, content: [{ type: 'tool_use', id: 'tu' + calls.length, name: 'transfer_to_human', input: { summary: 'Chị Hoa muốn đổi vang sang trà trong giỏ Cát Tường, 3 giỏ', customer_name: 'chị Hoa' } }] };
      }
      return { stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Dạ em gợi ý **Giỏ An Khang** ạ.' }] };
    } } } });

    m._setProfile(async () => ({ first: 'Lan', last: 'Trần Thị' }));
    await m.handleWebhook(msg('quà cho bố mẹ 2 triệu'));
    ok(/Tên Facebook của khách: Trần Thị Lan/.test(calls[0].system[1].text) && (await db('messenger_threads').where({ psid: PSID }).first()).name === 'Trần Thị Lan', 'Lấy tên Facebook của khách (họ trước tên sau) → AI gọi đúng tên');
    const texts = sent.filter((b) => b.message && b.message.text);
    ok(texts.length === 1 && texts[0].message.text === 'Dạ em gợi ý Giỏ An Khang ạ.' && texts[0].message.metadata === m.AI_TAG && sent.some((b) => b.sender_action === 'typing_on'), 'Khách nhắn → AI trả lời (chữ thường, có hiện "đang soạn")');
    ok(calls[0].system.length === 2 && /Messenger/.test(calls[0].system[1].text), 'AI biết đang chat qua Messenger');
    ok(/KHI GIỚI THIỆU MỘT GIỎ/.test(calls[0].system[0].text) && /ĐẦY ĐỦ các món/.test(calls[0].system[0].text), 'Lời dặn: giới thiệu giỏ phải nói rõ trong giỏ gồm những món gì');

    sent.length = 0;
    await m.handleWebhook(msg('ok chốt đơn nhé'));
    ok(!sent.some((b) => b.message && b.message.attachment), 'Khách chốt → KHÔNG còn nút sang web (chốt ngay trong chat)');
    const th = await db('messenger_threads').where({ psid: PSID }).first();
    ok(th && JSON.parse(th.history).length >= 4, 'Lịch sử trò chuyện lưu theo từng khách');
    const hrow = await db('ai_handoffs').where({ psid: PSID }).orderBy('created_ms', 'desc').first();
    const h = hrow && JSON.parse(hrow.data);
    ok(h && h.cart.lines[0].productId === prod.id && h.prefill.phone === '0912345000' && h.prefill.source === 'ai_fb', 'Đơn đã kiểm tra được lưu: giỏ + thông tin khách, đánh dấu kênh "AI Fanpage"');
    ok(!(await m.loadHandoff('khong-ton-tai-123')), 'Link sai → không mở được');
    ok(h.prefill.psid === PSID, 'Đơn đã lưu nhớ người nhắn Messenger');

    // Khách đã chốt (có link) mà 2 giờ sau chưa đặt → nhắc nhóm gọi lại, mỗi khách 1 lần
    await db('ai_handoffs').whereNot({ psid: PSID }).update({ followed: true }); // dữ liệu thừa của lần chạy thử trước không được tính
    await db('ai_handoffs').where({ psid: PSID }).update({ created_ms: Date.now() - 3 * 3600000 });
    ok(await m.followUpAbandoned() === 1 && await m.followUpAbandoned() === 0, 'Chốt mà chưa đặt sau 2 giờ → báo TƯ VẤN KHÁCH gọi lại (1 lần)');
    await db('ai_handoffs').where({ psid: PSID }).update({ followed: false });
    const [oid] = await db('orders').insert({ code: 'LN26TESTFU01', customer_name: 'Chị Lan FB', phone: '0912345000', province: 'Hà Nội', address: 'x', delivery_date: todayVN(3), payment_method: 'bank', payment_status: 'pending', status: 'new', subtotal: 1, discount: 0, shipping_fee: 0, total: 1, messenger_psid: PSID, created_at: new Date() });
    ok(await m.followUpAbandoned() === 0, 'Khách đã đặt đơn → không nhắc');
    await db('orders').where({ code: 'LN26TESTFU01' }).del();

    // Đơn từ AI Fanpage → báo khách qua Messenger: vừa đặt (kèm QR), nhắc chuyển khoản, đã nhận tiền
    sent.length = 0;
    const fakeOrder = { code: 'LN26TESTMSG1', total: 1990000, deposit_amount: 0, payment_method: 'bank', payment_status: 'pending', status: 'new', delivery_date: todayVN(3), messenger_psid: PSID,
      pay_account: 'personal', pay_bank_id: 'MB', pay_bank_name: 'MB Bank', pay_account_no: '0123456789', pay_holder: 'LE BA VI' };
    await m.orderUpdate(fakeOrder, 'placed', { until: '14:30 17/10' });
    const tx0 = sent[0] && sent[0].message.text;
    ok(tx0 && /LN26TESTMSG1/.test(tx0) && /chuyển khoản 1\.990\.000/.test(tx0) && /14:30 17\/10/.test(tx0) && /QR bên dưới/.test(tx0) && sent[0].message.metadata === m.AI_TAG,
      'Đặt xong → Messenger báo mã đơn, số tiền cần chuyển, hạn giữ đơn');
    const qrMsg = sent.find((b) => b.message && b.message.attachment && b.message.attachment.type === 'image');
    ok(qrMsg && /vietqr/.test(qrMsg.message.attachment.payload.url) && /amount=1990000/.test(qrMsg.message.attachment.payload.url), 'Mã QR gửi thẳng vào khung chat (ảnh), đúng số tiền');
    const allTx = sent.filter((b) => b.message && b.message.text).map((b) => b.message.text).join('\n');
    ok(/LN26TESTMSG1/.test(allTx) && !/0123456789/.test(allTx) && !/Số tài khoản/.test(allTx) && !sent.some((b) => b.message && b.message.attachment && b.message.attachment.type === 'template'), 'Không gửi số tài khoản dạng chữ (tránh khung hướng dẫn chuyển khoản dài của Facebook), không có nút sang web');
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
    const firstMsg = calls[calls.length - 1].messages[0].content;
    ok(!lastSys.some((b) => /Tên Facebook/.test(b.text)) && /MỞ ĐẦU CUỘC TRÒ CHUYỆN/.test(lastSys[0].text) && /tin ĐẦU TIÊN/.test(firstMsg) && /anh hay chị, tên gì/.test(firstMsg),
      'Tin đầu tiên, chưa biết tên → AI chào và xin "anh hay chị, tên gì"');

    // AI tự chuyển cho người thật (đổi món…) — khách đang ở Fanpage, không bị bảo nhắn Zalo
    ok(ai.tools('messenger').some((t) => t.name === 'transfer_to_human') && !ai.tools().some((t) => t.name === 'transfer_to_human'), 'Công cụ chuyển người thật chỉ có trên Messenger');
    ok(/KHÔNG bảo khách "nhắn Zalo\/Fanpage"/.test(calls[0].system[1].text), 'AI trên Fanpage được dặn không đẩy khách sang Zalo');
    const notifyMod = require('../src/lib/notify');
    const realTg = notifyMod.telegram;
    const tgCalls = [];
    notifyMod.telegram = async (html, chat, extra = {}) => { tgCalls.push({ html, extra }); return false; };
    m._setPageId('112418327083235');
    m._setConversation(async () => ({ link: 'https://www.facebook.com/msg/t_123', name: '' }));
    // Khách trả lời câu xưng hô → AI ghi nhớ "chị Lan", lưu theo khách, các tin sau gọi đúng và không chào/hỏi lại
    const PT = PSID + 'title';
    m._setProfile(async () => null);
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PT }, recipient: { id: 'PAGE' }, message: { mid: 'a6', text: 'alo' } }] }] });
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PT }, recipient: { id: 'PAGE' }, message: { mid: 'b6', text: 'chị Lan đây em' } }] }] });
    const t6 = await db('messenger_threads').where({ psid: PT }).first();
    ok(t6 && t6.title === 'chị' && t6.name === 'Lan', 'Khách nói "chị Lan" → lưu cách xưng hô theo khách');
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PT }, recipient: { id: 'PAGE' }, message: { mid: 'c6', text: 'giỏ 1 triệu có không' } }] }] });
    const c6 = calls[calls.length - 1];
    const lastUser6 = c6.messages.filter((x) => x.role === 'user' && typeof x.content === 'string').pop().content;
    ok(c6.system.some((b) => /gọi là chị Lan/.test(b.text)) && !/tin ĐẦU TIÊN/.test(lastUser6), 'Tin sau: AI gọi "chị Lan", không chào/hỏi xưng hô lại');
    await db('messenger_threads').where({ psid: PT }).del();
    await db('conv_log').where({ psid: PT }).del();
    // Facebook chặn đọc hồ sơ → lấy tên từ danh sách hội thoại; có tên thì AI không hỏi tên / anh hay chị
    const PN = PSID + 'conv';
    m._setProfile(async () => null);
    m._setConversation(async () => ({ link: '', name: 'Lê Bá Vĩ' }));
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PN }, recipient: { id: 'PAGE' }, message: { mid: 'n1', text: 'cần tư vấn' } }] }] });
    const cn = calls[calls.length - 1];
    const firstN = cn.messages[0].content;
    ok((await db('messenger_threads').where({ psid: PN }).first()).name === 'Lê Bá Vĩ' && cn.system.some((b) => /Tên Facebook của khách: Lê Bá Vĩ/.test(b.text)) && /KHÔNG hỏi tên, KHÔNG hỏi anh hay chị/.test(firstN),
      'Không đọc được hồ sơ → lấy tên từ danh sách hội thoại; AI chào theo tên, không hỏi tên/anh chị');
    await db('messenger_threads').where({ psid: PN }).del();
    await db('conv_log').where({ psid: PN }).del();
    const P5 = PSID + 'swap';
    m._resetEchoState();
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P5 }, recipient: { id: 'PAGE' }, message: { text: 'cho chị đổi món trong giỏ' } }] }] });
    const t5 = await db('messenger_threads').where({ psid: P5 }).first();
    ok(t5 && t5.name === 'chị Hoa', 'AI ghi lại tên khách tự giới thiệu → tin báo sau hiện tên');
    const tgSent = tgCalls.filter((x) => /AI chuyển khách Fanpage/.test(x.html)).pop();
    const kb = tgSent && tgSent.extra.reply_markup && tgSent.extra.reply_markup.inline_keyboard.flat();
    ok(tgSent && /chị Hoa/.test(tgSent.html) && kb && kb.some((b) => /business\.facebook\.com\/latest\/inbox\/all\/\?asset_id=112418327083235&selected_item_id=/.test(b.url)) && kb.some((b) => b.url === `https://pancake.vn/112418327083235?c_id=112418327083235_${P5}`),
      'Tin Telegram có tên khách + nút Pancake (điện thoại) và Business Suite (máy tính)');
    ok(t5 && Number(t5.paused_until_ms) > Date.now(), 'AI gọi transfer_to_human → tạm dừng, chờ chuyên viên trả lời tại Fanpage');
    notifyMod.telegram = realTg;
    // AI tắt → khách Fanpage không bị bảo nhắn Zalo, người thật trả lời
    const aiOn = (await settings.all()).ai_chat_enabled;
    await settings.save({ ai_chat_enabled: '0' });
    const P6 = PSID + 'off';
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P6 }, recipient: { id: 'PAGE' }, message: { text: 'shop ơi' } }] }] });
    ok((() => { const t = sent.find((b) => b.message && b.message.text); return t && /chuyên viên/.test(t.message.text) && !/Zalo/.test(t.message.text); })(), 'AI tắt → báo chuyên viên trả lời tại Fanpage, không đẩy sang Zalo');
    await settings.save({ ai_chat_enabled: aiOn || '1' });

    // Khách đòi gặp người thật
    const P2 = PSID + 'h';
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P2 }, recipient: { id: 'PAGE' }, message: { text: 'cho mình gặp nhân viên' } }] }] });
    const t2 = await db('messenger_threads').where({ psid: P2 }).first();
    ok(t2 && Number(t2.paused_until_ms) > Date.now() && /vui lòng đợi em một chút/.test(sent[0].message.text) && !/chuyên viên/.test(sent[0].message.text), '"gặp nhân viên" → câu mẫu "vui lòng đợi em", AI tạm dừng');

    // Ảnh / sticker
    const P3 = PSID + 'a';
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { sticker_id: 369239263222822, attachments: [{ type: 'image' }] } }] }] });
    ok(!sent.length, 'Sticker "like" → không trả lời');
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { attachments: [{ type: 'fallback', payload: { url: 'https://x' } }] } }] }] });
    ok(!sent.length, 'Phần đính kèm không có nội dung (xem trước link…) → không trả lời');
    const nCalls = calls.length;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } }] }] });
    const imgCall = calls[nCalls];
    const imgMsg = imgCall && imgCall.messages.filter((x) => x.role === 'user' && typeof x.content === 'string').pop().content;
    ok(imgMsg && /khách vừa gửi ảnh/.test(imgMsg) && /ĐÚNG mạch/.test(imgMsg) && !sent.some((b) => b.message && /tặng ai, tầm bao nhiêu/.test(b.message.text || '')),
      'Khách gửi ảnh → AI trả lời đúng mạch (không dùng câu soạn sẵn hỏi lại từ đầu)');

    // Khách nhắn "xóa dữ liệu" → xóa lịch sử
    sent.length = 0;
    await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: P3 }, recipient: { id: 'PAGE' }, message: { text: 'Xóa dữ liệu' } }] }] });
    ok(!(await db('messenger_threads').where({ psid: P3 }).first()) && /đã xóa/.test(sent[0].message.text), 'Khách nhắn "xóa dữ liệu" → xóa lịch sử, báo xác nhận');
    // Mã trang sắp hết hạn truy cập dữ liệu → báo BÁO LỖI trước 14 ngày
    // Claude lỗi (sau khi đã tự thử lại) → khách nhận câu tự nhiên, nhân viên được báo ngay (1 lần / 30 phút / khách)
    {
      const PE = PSID + 'err';
      const ntE = require('../src/lib/notify'); const realTE = ntE.telegram; const tgE = [];
      ntE.telegram = async (html, c, extra = {}) => { tgE.push({ html, extra }); return false; };
      const err = Object.assign(new Error('overloaded'), { status: 529 });
      ai._setClient({ beta: { messages: { create: async () => { throw err; } } } });
      sent.length = 0;
      await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PE }, recipient: { id: 'PAGE' }, message: { mid: 'e1', text: 'giỏ 1tr có không' } }] }] });
      await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PE }, recipient: { id: 'PAGE' }, message: { mid: 'e2', text: 'alo' } }] }] });
      const toCust = sent.filter((b) => b.message && b.message.text).map((b) => b.message.text);
      const staff = tgE.filter((x) => /AI chưa trả lời được/.test(x.html));
      ok(toCust.length === 2 && toCust.every((t) => /đợi em một chút/.test(t) && !/gián đoạn/.test(t)) && staff.length === 1 && staff[0].extra.topic === 'chat' && /AI vẫn bật/.test(staff[0].html),
        'Claude lỗi → khách nhận câu tự nhiên, nhân viên được báo 1 lần vào CHAT VỚI KHÁCH');
      ntE.telegram = realTE;
      await db('messenger_threads').where({ psid: PE }).del();
      await db('conv_log').where({ psid: PE }).del();
    }
    const nt = require('../src/lib/notify'); const realT = nt.telegram; const errs = [];
    nt.telegram = async (html, c, extra = {}) => { errs.push({ html, extra }); return false; };
    m._setDebugToken(async () => ({ is_valid: true, expires_at: 0, data_access_expires_at: Math.floor(Date.now() / 1000) + 10 * 86400 }));
    const ck = await m.checkToken();
    m._setDebugToken(async () => ({ is_valid: true, expires_at: 0, data_access_expires_at: Math.floor(Date.now() / 1000) + 60 * 86400 }));
    const ck2 = await m.checkToken();
    m._setDebugToken(async () => ({ is_valid: false }));
    await m.checkToken();
    nt.telegram = realT;
    ok(ck.warn && /còn (9|10) ngày/.test(errs[0].html) && errs[0].extra.topic === 'error' && !ck2.warn && /đã hết hiệu lực/.test(errs[1].html), 'Mã trang sắp hết hạn (≤14 ngày) hoặc mất hiệu lực → báo chủ đề BÁO LỖI');
    // ── Ảnh khách gửi: AI xem được ảnh (chỉ ảnh từ máy chủ Facebook), lịch sử chỉ lưu chữ ──
    {
      const PI = '6' + String(Date.now());
      let fetched = 0;
      m._setImageFetcher(async () => { fetched++; return { media_type: 'image/jpeg', data: 'QUJDREVGRw==' }; });
      m._resetEchoState();
      sent.length = 0;
      let snap = null; // chụp nội dung gửi cho Claude ngay lúc gọi (lịch sử bị sửa lại sau lượt)
      ai._setClient({ beta: { messages: { create: async (p) => { snap = JSON.parse(JSON.stringify(p.messages)); return { stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Dạ em thấy hai giỏ ạ.' }] }; } } } });
      const att = (u) => ({ type: 'image', payload: { url: u } });
      await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PI }, recipient: { id: 'PAGE' }, message: { mid: 'i' + Math.random(), attachments: [att('https://scontent.xx.fbcdn.net/a.jpg'), att('https://scontent.xx.fbcdn.net/b.jpg'), att('https://evil.example.com/c.jpg')] } }] }] });
      const last = (snap || []).filter((x) => x.role === 'user').pop() || {};
      const blocks = Array.isArray(last.content) ? last.content : [];
      ok(blocks.filter((b) => b.type === 'image' && b.source.type === 'base64' && b.source.media_type === 'image/jpeg').length === 2 && /em xem được ảnh/.test((blocks.find((b) => b.type === 'text') || {}).text || '') && fetched === 2,
        'Khách gửi ảnh → AI nhận ảnh thật (chỉ tải ảnh từ máy chủ Facebook, bỏ link lạ)');
      const th = await db('messenger_threads').where({ psid: PI }).first();
      const hist = JSON.parse(th.history);
      const lastUser = hist.filter((x) => x.role === 'user' && typeof x.content === 'string').pop();
      ok(lastUser && /Khách gửi kèm 2 ảnh/.test(lastUser.content) && !th.history.includes('QUJDREVGRw'), 'Lịch sử chỉ lưu chữ "khách gửi kèm 2 ảnh", không lưu dữ liệu ảnh');
      m._setImageFetcher(async () => null);
      sent.length = 0;
      await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PI }, recipient: { id: 'PAGE' }, message: { mid: 'i' + Math.random(), attachments: [att('https://scontent.xx.fbcdn.net/d.jpg')] } }] }] });
      ok(/em không xem được nội dung/.test(JSON.stringify((snap || []).filter((x) => x.role === 'user').pop().content)), 'Không tải được ảnh → dùng ghi chú cũ (AI không giả vờ nhìn thấy)');
      await db('messenger_threads').where({ psid: PI }).del();
      await db('conv_log').where({ psid: PI }).del();
    }
    // ── Facebook chặn bot gửi tin (hạn chế gửi tin tạm thời) → AI dừng + báo nhân viên trả lời tay, không báo lặp ──
    {
      const PR = '5' + String(Date.now());
      const ntR = require('../src/lib/notify'); const realTR = ntR.telegram; const alerts = [];
      ntR.telegram = async (html, c, extra = {}) => { alerts.push({ html, extra }); return false; };
      const fbErr = JSON.stringify({ error: { message: 'Application does not have permission for this action', code: 10, error_subcode: 1893063, error_user_msg: 'Bạn tạm thời bị hạn chế gửi tin nhắn.' } });
      await m._onSendRefused({ recipient: { id: PR }, message: { text: 'hi' } }, fbErr);
      await m._onSendRefused({ recipient: { id: PR }, message: { text: 'hi 2' } }, fbErr);
      await m._onSendRefused({ recipient: { id: PR }, sender_action: 'typing_on' }, fbErr);
      await m._onSendRefused({ recipient: { id: PR + '1' }, message: { text: 'x' } }, JSON.stringify({ error: { code: 100, message: 'khác' } }));
      const thr = await db('messenger_threads').where({ psid: PR }).first();
      ok(alerts.length === 1 && /CHẶN bot gửi tin/.test(alerts[0].html) && /hạn chế gửi tin nhắn/.test(alerts[0].html) && alerts[0].extra.topic === 'chat' && thr && Number(thr.paused_until_ms) > Date.now(),
        'Facebook chặn bot gửi tin → AI dừng 1 giờ + báo CHAT VỚI KHÁCH 1 lần (không báo lặp, lỗi khác không tính)');
      ntR.telegram = realTR;
      await db('messenger_threads').where({ psid: PR }).del();
    }
    // ── Mua ngay trong chat: ảnh + giá → tóm tắt → khách đồng ý → đơn THẬT + mã QR trong chat (không dẫn sang web) ──
    {
      const PB = '7' + String(Date.now()); // mã người nhắn thật của Facebook toàn chữ số
      m._resetEchoState();
      m._setProfile(async () => ({ first: 'Hoa', last: 'Nguyễn Thị' }));
      const pi = await db('products').where({ is_active: true }).whereNotNull('image_id').andWhere('stock', '>=', 5).orderBy('price').first();
      const info = { items: [{ product_id: pi.id, qty: 1 }], customer_name: 'Chị Hoa', phone: '0988111222', province: 'Hà Nội', address: '5 Tràng Tiền', is_gift: false, delivery_date: todayVN(3), payment_method: 'bank' };
      const tu = (name, input) => ({ stop_reason: 'tool_use', model: 'fake', usage: {}, content: [{ type: 'tool_use', id: 'tb' + Math.random(), name, input }] });
      ai._setClient({ beta: { messages: { create: async (p) => {
        const last = p.messages[p.messages.length - 1];
        if (typeof last.content === 'string') {
          if (/xem giỏ/.test(last.content)) return tu('send_product_photo', { product_id: pi.id });
          if (/lên đơn luôn/.test(last.content) || /đồng ý/.test(last.content)) return tu('confirm_order', info);
          if (/chốt/.test(last.content)) return tu('prepare_order', info);
        }
        return { stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Dạ giỏ này hợp ạ, giá 990k ạ.' }] };
      } } } });
      const say = async (text) => { sent.length = 0; await m.handleWebhook({ object: 'page', entry: [{ messaging: [{ sender: { id: PB }, recipient: { id: 'PAGE' }, message: { mid: 'b' + Math.random(), text } }] }] }); };
      const ordersOf = () => db('orders').where({ messenger_psid: PB });
      await db('orders').where({ messenger_psid: PB }).del();

      await say('cho mình xem giỏ nào hợp');
      const iImg = sent.findIndex((b) => b.message && b.message.attachment && b.message.attachment.type === 'image');
      const iTxt = sent.findIndex((b) => b.message && b.message.text && /990k/.test(b.message.text));
      ok(iImg >= 0 && iTxt > iImg && new RegExp(`/media/${pi.image_id}\\.jpg$`).test(sent[iImg].message.attachment.payload.url), 'Giới thiệu giỏ → gửi ẢNH JPEG của giỏ trước, rồi lời giới thiệu có giá');

      await say('ok lên đơn luôn');
      ok((await ordersOf()).length === 0 && !sent.some((b) => b.message && b.message.attachment), 'Chưa tóm tắt đơn cho khách mà AI gọi tạo đơn → bị chặn, không có đơn');

      await say('ok chốt giỏ này nhé');
      ok((await ordersOf()).length === 0 && !sent.some((b) => b.message && b.message.attachment), 'Kiểm tra đơn xong → CHƯA tạo đơn, không có nút/ link sang web');

      await say('đồng ý, lên đơn đi');
      const od = await ordersOf();
      const stockNow = (await db('products').where({ id: pi.id }).first()).stock;
      ok(od.length === 1 && od[0].source === 'ai_fb' && od[0].status === 'new' && od[0].payment_status === 'pending' && od[0].phone === '0988111222' && Number(od[0].total) > 0 && stockNow === pi.stock - 1,
        'Khách đồng ý → bot tạo ĐƠN THẬT (kênh AI Fanpage, giữ kho), chưa nhận tiền');
      const qrI = sent.find((b) => b.message && b.message.attachment && b.message.attachment.type === 'image');
      const texts2 = sent.filter((b) => b.message && b.message.text).map((b) => b.message.text).join('\n');
      ok(qrI && /vietqr/.test(qrI.message.attachment.payload.url) && new RegExp(`amount=${Math.round(od[0].total)}`).test(qrI.message.attachment.payload.url) && !/Số tài khoản/.test(texts2) && texts2.includes(od[0].code) && !sent.some((b) => b.message && b.message.attachment && b.message.attachment.type === 'template'),
        'Đơn tạo xong → gửi mã QR + mã đơn + số tiền ngay trong chat (không gửi số tài khoản chữ), không dẫn sang web');

      await say('đồng ý, lên đơn đi'); // gọi lại → không tạo đơn thứ hai
      ok((await ordersOf()).length === 1, 'Khách xác nhận lặp lại → không tạo đơn trùng');

      const its = await db('order_items').where({ order_id: od[0].id });
      await db('order_items').where({ order_id: od[0].id }).del();
      await db('orders').where({ id: od[0].id }).del();
      await db('products').where({ id: pi.id }).update({ stock: pi.stock, sold: pi.sold });
      ok(its.length === 1 && its[0].product_id === pi.id, 'Đơn có đúng 1 dòng hàng');
      await db('ai_handoffs').where({ psid: PB }).del();
      await db('messenger_threads').where({ psid: PB }).del();
      await db('conv_log').where({ psid: PB }).del();
    }
    await db('messenger_threads').where('psid', 'like', PSID + '%').del();
    await db('conv_log').where('psid', 'like', PSID + '%').del();
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
