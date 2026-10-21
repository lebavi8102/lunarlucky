/**
 * Kiểm thử "AI học tư vấn": ghi nhật ký hội thoại, rút bài học (Claude giả lập), duyệt → vào lời dặn AI.
 * Chạy: node test/ai-learn.js   (database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
const learn = require('../src/lib/ai-learn');
const ai = require('../src/lib/ai-sales');
const notify = require('../src/lib/notify');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const T = Date.now();
const P = `learn${T}`;
const tg = [];
notify.telegram = async (html) => { tg.push(html); return false; };

(async () => {
  const ids = [];
  try {
    await db.migrate.latest();
    await learn.log(P, 'customer', 'giỏ 1tr890 hơi đắt, có bớt không em');
    await learn.log(P, 'ai', 'Dạ giá này đã gồm thiệp viết tay rồi ạ');
    await learn.log(P, 'staff', 'Dạ bên em không giảm giá, nhưng tặng thêm khắc tên lên thiệp, mình tham khảo giỏ Như Ý 1tr690 nha');
    await db('messenger_threads').insert({ psid: P, history: '[]', paused_until_ms: 0, updated_ms: T }).catch(() => {});
    ok((await db('conv_log').where({ psid: P })).length === 3, 'Ghi nhật ký hội thoại: khách · AI · nhân viên');

    let seen = '';
    learn._setAsk(async (system, user) => {
      seen = user;
      return '{"lessons": ["Khi khách chê đắt, không giảm giá — tặng khắc tên lên thiệp và gợi ý giỏ thấp hơn một bậc (\\"mình tham khảo giỏ Như Ý 1tr690 nha\\").", "Khách để lại số 0912345678 thì gọi ngay"]}';
    });
    await require('../src/lib/settings').save({ ai_learn_mark: String(T - 1) });
    const n = await learn.learn();
    const rows = await db('ai_lessons').where('created_at', '>=', new Date(T - 1000)).orderBy('id');
    rows.forEach((r) => ids.push(r.id));
    ok(n === 2 && /Nhân viên: Dạ bên em không giảm giá/.test(seen), 'Rút bài học từ đoạn chat có nhân viên trả lời');
    ok(rows.every((r) => r.status === 'pending') && /\[SĐT\]/.test(rows[1].text) && !/0912345678/.test(rows[1].text), 'Bài học chờ duyệt, tự xóa số điện thoại');
    ok(tg.some((x) => /AI rút ra 2 bài học mới/.test(x) && /\/admin\/ai-hoc/.test(x)), 'Báo Telegram kèm link duyệt');
    ok(await learn.learn() === 0, 'Không học lại đoạn chat đã học');

    // Tỉ lệ chốt: 2 khách web chat, 1 được gửi nút đặt hàng; 1 khách Fanpage
    const W1 = `web:t1${T}`, W2 = `web:t2${T}`;
    await learn.log(W1, 'customer', 'xin giá'); await learn.log(W1, 'ai', 'dạ'); await learn.log(W1, 'event', 'order_button');
    await learn.log(W2, 'customer', 'hi');
    const st = await learn.stats(T - 1000);
    ok(st.web.chats >= 2 && st.web.buttons >= 1 && st.fb.chats >= 1 && st.all.chats === st.web.chats + st.fb.chats && typeof st.all.rate === 'number', 'Đếm phễu AI: khách chat → nút đặt hàng → đơn, tách web / Fanpage');
    await db('conv_log').whereIn('psid', [W1, W2]).del();
    const before = await ai.systemPrompt();
    ok(!/khắc tên lên thiệp/.test(before), 'Chưa duyệt → AI chưa áp dụng');
    await db('ai_lessons').where({ id: rows[0].id }).update({ status: 'approved' });
    const after = await ai.systemPrompt();
    ok(/SỔ TAY KINH NGHIỆM CỦA SHOP[\s\S]*khắc tên lên thiệp/.test(after), 'Duyệt → bài học vào lời dặn của AI');
    const escQty = Number((await require('../src/lib/settings').all()).ai_escalate_qty) || 5;
    ok(new RegExp(`CA LỚN / CA KHÓ[\\s\\S]*Đơn từ ${escQty} giỏ`).test(after) && /transfer_to_human/.test(after), 'Lời dặn có ngưỡng ca lớn (theo Cài đặt ai_escalate_qty) → chuyển chủ shop');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await db('ai_lessons').whereIn('id', ids).del();
    await db('conv_log').where({ psid: P }).del();
    await db('messenger_threads').where({ psid: P }).del();
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
