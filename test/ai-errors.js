/**
 * Kiểm thử nhật ký lỗi chatbot AI: phân loại, che thông tin nhạy cảm, gộp lỗi trùng, không làm hỏng chat,
 * và các điểm ghi lỗi thật trong luồng chat (Claude lỗi, hết tiền, mô hình phụ lỗi, công cụ lỗi, trả lời rỗng).
 * Chạy: node test/ai-errors.js   (database local, Claude giả lập)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
const errs = require('../src/lib/ai-errors');
const ai = require('../src/lib/ai-sales');
const settings = require('../src/lib/settings');
const notify = require('../src/lib/notify');
notify.telegram = async () => false;

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const count = async (kind) => Number((await db('ai_errors').where({ kind }).sum({ n: 'count' }))[0].n || 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mBefore = (await settings.all()).ai_model;
  try {
    await db.migrate.latest();
    await db('ai_errors').del();

    // 1. Phân loại
    const c = (status, message) => errs.classify({ status, message }).kind;
    ok(c(400, 'Your credit balance is too low to access the API') === 'claude_credit', 'Phân loại: hết tiền Claude');
    ok(c(401, 'invalid x-api-key') === 'claude_auth' && c(403, 'forbidden') === 'claude_auth', 'Phân loại: khóa API sai / bị thu hồi');
    ok(c(529, 'overloaded') === 'claude_overload' && c(429, 'rate') === 'claude_overload' && c(500, 'x') === 'claude_overload' && c(undefined, 'fetch failed') === 'claude_overload', 'Phân loại: quá tải / lỗi mạng');
    ok(c(400, 'invalid request') === 'claude_other', 'Phân loại: lỗi khác');

    // 2. Che khóa API / email / SĐT
    const dirty = errs.clean('lỗi khóa sk-ant-api03-ABCDEFGH12345 của kin@example.com gọi 0912345678 và +84 912 345 678 Bearer abcdef1234567890xyz');
    ok(!/sk-ant|ABCDEFGH|kin@|0912345678|912 345|abcdef1234567890/.test(dirty) && /khóa-đã-ẩn/.test(dirty), 'Nội dung lỗi: che khóa API, email, số điện thoại, token');

    // 3. Ghi + gộp lỗi trùng
    await errs.log({ kind: 'claude_overload', channel: 'web', status: 529, message: 'overloaded' });
    await errs.log({ kind: 'claude_overload', channel: 'web', status: 529, message: 'overloaded' });
    await errs.log({ kind: 'claude_overload', channel: 'messenger', status: 529, message: 'overloaded' });
    const rows = await db('ai_errors').where({ kind: 'claude_overload' });
    ok(rows.length === 2 && (await count('claude_overload')) === 3, 'Lỗi giống nhau (cùng loại, kênh, mã) liên tiếp → gộp một dòng, cộng số lần');
    await errs.log({ kind: 'messenger_send', channel: 'messenger', status: 400, message: 'x', ref: '1234567890123456' });
    ok((await db('ai_errors').where({ kind: 'messenger_send' }).first()).ref === 'fb…3456', 'Mã khách Fanpage chỉ lưu 4 số cuối');
    await errs.log({ kind: 'khong-co-loai-nay', message: 'x' });
    ok((await count('claude_other')) === 1, 'Loại lạ → xếp vào "Claude báo lỗi khác", không mất lỗi');

    // 4. Ghi lỗi hỏng không làm hỏng chat: bảng ghi lỗi bị lỗi vẫn trả về bình thường
    let threw = false;
    await db.schema.renameTable('ai_errors', 'ai_errors_tmp');
    try {
      await errs.log({ kind: 'refusal', message: 'khi bảng không tồn tại' }); // phải nuốt lỗi, chỉ in log
    } catch (e) { threw = true; } finally {
      await db.schema.renameTable('ai_errors_tmp', 'ai_errors');
    }
    ok(!threw, 'Bảng ghi lỗi bị trục trặc → log() không ném lỗi ra (chat không bị ảnh hưởng)');

    // 5. Điểm ghi lỗi thật trong luồng chat
    await db('ai_errors').del();
    await settings.save({ ai_model: 'claude-opus-5-5' });
    const mkReq = () => ({ session: {}, get: () => '' });

    ai._setClient({ beta: { messages: { create: async () => { const e = new Error('Your credit balance is too low'); e.status = 400; throw e; } } } });
    const r1 = await ai.chat(mkReq(), 'chào shop');
    await wait(150);
    ok(r1.error && (await count('claude_credit')) === 1 && (await db('ai_errors').where({ kind: 'claude_credit' }).first()).channel === 'web', 'Chat: hết tiền Claude → khách nhận câu xin lỗi + lỗi được ghi (kênh web)');

    ai._setClient({ beta: { messages: { create: async () => { const e = new Error('overloaded'); e.status = 529; throw e; } } } });
    const mr = mkReq();
    await ai.chat(mr, 'còn mẫu nào khác không', { channel: 'messenger' });
    await wait(150);
    ok((await db('ai_errors').where({ kind: 'claude_overload', channel: 'messenger' }).first()), 'Chat Fanpage: Claude quá tải → ghi lỗi kênh Fanpage');

    await settings.save({ ai_model: 'claude-sonnet-5-5' });
    ai._setClient({ beta: { messages: { create: async (p) => { if (p.model === 'claude-sonnet-5-5') { const e = new Error('bad request'); e.status = 400; throw e; } return { stop_reason: 'end_turn', model: p.model, usage: {}, content: [{ type: 'text', text: 'Dạ em đây ạ' }] }; } } } });
    const r3 = await ai.chat(mkReq(), 'chào');
    await wait(150);
    ok(r3.reply === 'Dạ em đây ạ' && (await count('model_fallback')) === 1, 'Mô hình phụ lỗi → khách vẫn được trả lời, lỗi chuyển Opus được ghi');

    await settings.save({ ai_model: 'claude-opus-5-5' });
    ai._setClient({ beta: { messages: { create: async () => ({ stop_reason: 'refusal', model: 'claude-opus-5-5', usage: {}, content: [] }) } } });
    await ai.chat(mkReq(), 'tin bị từ chối');
    await wait(150);
    ok((await count('refusal')) === 1, 'Claude từ chối trả lời → ghi lỗi');

    ai._setClient({ beta: { messages: { create: async () => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: {}, content: [{ type: 'text', text: '   ' }] }) } } });
    const r5 = await ai.chat(mkReq(), 'tin trả lời rỗng');
    await wait(150);
    ok(/cho em biết thêm/.test(r5.reply) && (await count('empty_reply')) === 1, 'AI trả lời rỗng → khách nhận câu hỏi thêm, lỗi được ghi');

    // tóm tắt cho trang quản trị
    const sum = await errs.summary();
    ok(sum.d1.total >= 5 && sum.d1.serious >= 3 && sum.d1.by.model_fallback === 1, 'Tổng hợp 24 giờ: đếm theo loại, tách lỗi nặng (khách chưa được trả lời)');

    // dọn lỗi quá 30 ngày
    await db('ai_errors').insert({ kind: 'refusal', channel: 'web', message: 'cũ', count: 1, created_at: new Date(Date.now() - 40 * 86400000), last_at: new Date(Date.now() - 40 * 86400000) });
    await errs.purgeOld(Date.now() + 7 * 3600000);
    ok(!(await db('ai_errors').where({ message: 'cũ' }).first()), 'Lỗi quá 30 ngày → tự dọn');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await settings.save({ ai_model: mBefore || '' });
    await db('ai_errors').del();
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
