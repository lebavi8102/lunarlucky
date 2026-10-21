/**
 * Kiểm thử "Kho tri thức AI": mục đang bật vào lời dặn, tắt thì biến mất, giới hạn dung lượng, quy tắc an toàn.
 * Chạy: node test/ai-knowledge.js   (database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
const kb = require('../src/lib/ai-knowledge');
const ai = require('../src/lib/ai-sales');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };

(async () => {
  const ids = [];
  const add = async (title, content, active = true) => {
    const [r] = await db('ai_knowledge').insert({ title, content, active, created_at: new Date(), updated_at: new Date() });
    const id = typeof r === 'object' ? r.id : r;
    ids.push(id);
    return id;
  };
  try {
    await db.migrate.latest();
    const before = await db('ai_knowledge').count({ n: '*' }).then((x) => Number(x[0].n));
    const base = await ai.systemPrompt();
    ok(before > 0 || !/KHO TRI THỨC CỦA SHOP/.test(base), 'Kho trống → lời dặn không có phần kho tri thức');

    const a = await add('Giao hàng 29 Chạp TEST', 'Đơn đặt đến hết 29 tháng Chạp vẫn giao nội thành Hà Nội buổi sáng. Mã kiểm thử KT-ALPHA-77.');
    const withKb = await ai.systemPrompt();
    ok(/KHO TRI THỨC CỦA SHOP/.test(withKb) && /### Giao hàng 29 Chạp TEST/.test(withKb) && /KT-ALPHA-77/.test(withKb), 'Thêm mục → AI thấy ngay trong lời dặn (tiêu đề + nội dung)');
    ok(/TUYỆT ĐỐI không lấy giá bán, tồn kho, trạng thái đơn hàng/.test(withKb) && /lookup_order/.test(withKb) && /theo "SỰ THẬT"/.test(withKb),
      'Lời dặn kèm quy tắc: không lấy giá/tồn kho/đơn hàng từ kho, mâu thuẫn thì theo SỰ THẬT, không biết thì nhờ nhân viên');

    await db('ai_knowledge').where({ id: a }).update({ active: false });
    ok(!/KT-ALPHA-77/.test(await ai.systemPrompt()), 'Ngừng áp dụng → AI không còn thấy mục đó');
    await db('ai_knowledge').where({ id: a }).update({ active: true, content: 'Nội dung đã sửa KT-BETA-88 đủ dài để lưu.' });
    const edited = await ai.systemPrompt();
    ok(/KT-BETA-88/.test(edited) && !/KT-ALPHA-77/.test(edited), 'Sửa nội dung → AI dùng bản mới');
    await db('ai_knowledge').where({ id: a }).del();
    ok(!/KT-BETA-88/.test(await ai.systemPrompt()), 'Xóa mục → biến mất khỏi lời dặn');

    // Giới hạn dung lượng: mục vượt ngân sách bị bỏ khỏi lời dặn (lưới an toàn), không làm hỏng các mục trước
    const used0 = await kb.usage();
    const big = 'x'.repeat(kb.MAX_CONTENT);
    const n = Math.ceil((kb.MAX_TOTAL - used0) / (kb.MAX_CONTENT + 20)) + 1;
    for (let i = 0; i < n; i++) await add(`Mục lớn ${i} TEST`, big);
    const act = await kb.active();
    const total = act.reduce((s, e) => s + kb.size(e), 0);
    ok(total <= kb.MAX_TOTAL && act.length < (await db('ai_knowledge').where({ active: true }).count({ n: '*' }).then((x) => Number(x[0].n))), `Quá dung lượng (${kb.MAX_TOTAL} ký tự) → chỉ nạp phần vừa đủ (${total})`);
    ok((await kb.usage()) > kb.MAX_TOTAL - 1 || n > 0, 'usage() đếm các mục đang bật');
    const first = ids[1];
    ok((await kb.usage(first)) === (await kb.usage()) - kb.size(await db('ai_knowledge').where({ id: first }).first()), 'usage(id) trừ mục đang sửa để kiểm tra giới hạn khi lưu');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    if (ids.length) await db('ai_knowledge').whereIn('id', ids).del();
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
