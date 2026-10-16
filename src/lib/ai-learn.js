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

async function log(psid, role, text) {
  const t = String(text || '').trim();
  if (!psid || !t || !ROLES[role]) return;
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
  const rows = await db('conv_log').where({ role: 'staff' }).andWhere('created_ms', '>', since).distinct('psid');
  const known = (await db('ai_lessons').whereIn('status', ['approved', 'pending']).select('text')).map((r) => `- ${r.text}`).join('\n') || '(chưa có)';
  const fresh = [];
  for (const { psid } of rows) {
    const th = await db('messenger_threads').where({ psid }).first();
    const after = Number(th && th.learned_ms) || 0;
    const newStaff = await db('conv_log').where({ psid, role: 'staff' }).andWhere('created_ms', '>', after).first();
    if (newStaff) fresh.push(psid);
    if (fresh.length >= maxThreads) break;
  }
  if (!fresh.length) return 0;
  const blocks = [];
  for (const psid of fresh) {
    const lines = await db('conv_log').where({ psid }).andWhere('created_ms', '>', since).orderBy('created_ms').limit(80);
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
  await db('messenger_threads').whereIn('psid', fresh).update({ learned_ms: now });
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

module.exports = { log, approved, learn, _setAsk: (fn) => { ask = fn; } };
