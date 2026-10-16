/**
 * AI học từ cách chủ shop / nhân viên tư vấn.
 * - Ghi lại hội thoại Fanpage (khách · AI · nhân viên) vào conv_log.
 * - Mỗi tối: cuộc trò chuyện nào có NHÂN VIÊN trả lời → Claude rút ra "bài học" chung (bỏ tên, SĐT, địa chỉ)
 *   → chờ chủ shop duyệt trong admin (/admin/ai-hoc) → bài đã duyệt được đưa vào lời dặn của AI tư vấn.
 * Duyệt tay để AI không học nhầm một câu lỡ lời / trường hợp đặc biệt.
 */
const db = require('../db');
const config = require('../config');
const settings = require('./settings');

const ROLES = { customer: 'Khách', ai: 'AI', staff: 'Nhân viên' };

/** role: customer | ai | staff (đoạn chat) hoặc event (mốc phễu: order_button, human). psid web = "web:<mã phiên>". */
async function log(psid, role, text) {
  const t = String(text || '').trim();
  if (!psid || !t || !(ROLES[role] || role === 'event')) return;
  await db('conv_log').insert({ psid: String(psid), role, text: t.slice(0, 1000), created_ms: Date.now() }).catch(() => {});
}

/** Bài học đã duyệt (đưa vào lời dặn AI). */
async function approved(limit = 60) {
  return db('ai_lessons').where({ status: 'approved' }).orderBy('id').limit(limit).select('id', 'text');
}

let ask = async (system, user) => {
  const s = await settings.all();
  const res = await require('./ai-sales').getClient().beta.messages.create({
    model: s.ai_model || 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
};

const SYSTEM = `Bạn là trưởng nhóm bán hàng của Lunar Lucky (giỏ quà Tết cao cấp). Bạn đọc các đoạn chat Fanpage trong đó NHÂN VIÊN (người thật) đã vào tư vấn, để rút ra kinh nghiệm cho trợ lý tự động làm giống người thật hơn.

Rút ra TỐI ĐA 5 bài học CHUNG, dùng lại được cho khách khác:
- Mỗi bài 1–2 câu, dạng quy tắc hành động: "Khi khách …, hãy …" (có thể kèm câu mẫu ngắn trong ngoặc kép, đúng giọng nhân viên).
- Chỉ học từ cách NHÂN VIÊN làm, đặc biệt chỗ nhân viên làm khác / tốt hơn AI (cách xử lý chê đắt, báo giá đổi món, cách chốt, cách xưng hô, ưu đãi được phép, thông tin sản phẩm mới…).
- TUYỆT ĐỐI không ghi tên khách, số điện thoại, địa chỉ, mã đơn, tên công ty khách.
- Không lặp lại bài đã có trong danh sách "ĐÃ CÓ". Không bịa ngoài nội dung đoạn chat. Không có gì mới thì trả về danh sách rỗng.
- Bỏ qua các trường hợp quá riêng (chỉ đúng với một khách).

Chỉ trả về JSON đúng dạng: {"lessons": ["bài học 1", "bài học 2"]}`;

/** (mỗi tối) Rút bài học từ các cuộc trò chuyện có nhân viên trả lời từ lần học trước. */
async function learn({ now = Date.now(), maxThreads = 15 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const since = now - 3 * 86400000;
  // Mốc "đã học đến": chỉ xét tin nhân viên mới hơn mốc (không học lại, kể cả khi cuộc trò chuyện đã bị xóa)
  const mark = Math.max(since, Number((await settings.all()).ai_learn_mark) || 0);
  const rows = await db('conv_log').where({ role: 'staff' }).andWhere('created_ms', '>', mark).distinct('psid');
  const known = (await db('ai_lessons').whereIn('status', ['approved', 'pending']).select('text')).map((r) => `- ${r.text}`).join('\n') || '(chưa có)';
  const fresh = [];
  for (const { psid } of rows) {
    fresh.push(psid);
    if (fresh.length >= maxThreads) break;
  }
  if (!fresh.length) return 0;
  await settings.save({ ai_learn_mark: String(now) });
  const blocks = [];
  for (const psid of fresh) {
    const lines = await db('conv_log').where({ psid }).whereIn('role', Object.keys(ROLES)).andWhere('created_ms', '>', since).orderBy('created_ms').limit(80);
    blocks.push(lines.map((l) => `${ROLES[l.role]}: ${l.text}`).join('\n'));
  }
  const user = `ĐÃ CÓ:\n${known}\n\nCÁC ĐOẠN CHAT (mỗi đoạn cách nhau bằng ---):\n${blocks.join('\n---\n')}`;
  let lessons = [];
  try {
    const out = await ask(SYSTEM, user);
    const json = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]);
    lessons = (Array.isArray(json.lessons) ? json.lessons : []).map((x) => String(x).trim()).filter((x) => x.length > 10).slice(0, 5);
  } catch (err) {
    console.error('[AI học] lỗi rút bài học:', err.message);
    return 0;
  }
  // Chặn lọt số điện thoại / email vào bài học
  lessons = lessons.map((x) => x.replace(/(?:\+?84|0)[\s.-]?(?:\d[\s.-]?){8}\d/g, '[SĐT]').replace(/\S+@\S+\.\S+/g, '[email]').slice(0, 500));
  for (const text of lessons) await db('ai_lessons').insert({ text, status: 'pending', source: 'fanpage', created_at: new Date(), updated_at: new Date() });
  if (lessons.length) {
    const e = require('./notify').escapeTg;
    await require('./notify').telegram([
      `📚 <b>AI rút ra ${lessons.length} bài học mới từ cách bạn tư vấn</b> — chờ duyệt:`,
      ...lessons.map((x, i) => `${i + 1}. ${e(x)}`),
      `👉 Duyệt / sửa / bỏ: ${config.publicUrl}/admin/ai-hoc`,
    ].join('\n'), null, { topic: 'consult' }).catch(() => {});
  }
  return lessons.length;
}

/**
 * Tỉ lệ chốt của AI trong khoảng [from, to): cuộc chat (có khách nhắn) → AI gửi nút đặt hàng → đơn đặt → đơn đã trả/cọc.
 * Tách web / Fanpage. Đơn AI = đơn nguồn "ai" (web) / "ai_fb" (Fanpage).
 */
async function stats(from, to = Date.now()) {
  const inRange = (q) => q.andWhere('created_ms', '>=', from).andWhere('created_ms', '<=', to);
  const distinct = async (role, text, ch) => {
    const q = inRange(db('conv_log').where({ role }).modify((x) => text && x.andWhere({ text })))
      .modify((x) => (ch === 'web' ? x.andWhere('psid', 'like', 'web:%') : x.whereNot('psid', 'like', 'web:%')));
    return (await q.distinct('psid')).length;
  };
  const out = {};
  for (const ch of ['web', 'fb']) {
    const src = ch === 'web' ? 'ai' : 'ai_fb';
    const orders = await db('orders').where({ source: src }).whereNot('status', 'cancelled')
      .andWhere('created_at', '>=', new Date(from)).andWhere('created_at', '<', new Date(to)).select('total', 'payment_status', 'payment_method', 'status');
    const paid = orders.filter((o) => ['paid', 'deposit'].includes(o.payment_status) || (o.payment_method === 'cod' && o.status !== 'new'));
    out[ch] = {
      chats: await distinct('customer', null, ch),
      buttons: await distinct('event', 'order_button', ch),
      humans: await distinct('event', 'human', ch),
      orders: orders.length,
      paid: paid.length,
      revenue: orders.reduce((x, o) => x + Number(o.total), 0),
    };
  }
  const sum = (k) => out.web[k] + out.fb[k];
  out.all = { chats: sum('chats'), buttons: sum('buttons'), humans: sum('humans'), orders: sum('orders'), paid: sum('paid'), revenue: sum('revenue') };
  for (const k of ['web', 'fb', 'all']) out[k].rate = out[k].chats ? Math.round((out[k].orders / out[k].chats) * 1000) / 10 : null;
  return out;
}

module.exports = { log, approved, learn, stats, _setAsk: (fn) => { ask = fn; } };
