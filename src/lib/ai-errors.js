/**
 * Nhật ký lỗi chatbot AI: Claude lỗi/hết tiền/quá tải, mô hình phụ phải chuyển Opus, công cụ lỗi hệ thống,
 * Facebook không nhận tin… Xem ở admin /admin/ai-loi.
 * Ghi lỗi KHÔNG BAO GIỜ làm hỏng cuộc chat: mọi lỗi khi ghi đều bị nuốt (chỉ in log).
 */
const db = require('../db');

const KINDS = {
  claude_credit: 'Hết tiền tài khoản Claude',
  claude_auth: 'Khóa API Claude sai / bị thu hồi',
  claude_overload: 'Claude quá tải / lỗi tạm thời',
  claude_other: 'Claude báo lỗi khác',
  model_fallback: 'Mô hình phụ lỗi → đã chuyển sang Opus',
  tool_exception: 'Công cụ của AI gặp lỗi hệ thống',
  refusal: 'Claude từ chối trả lời',
  empty_reply: 'AI không đưa ra được câu trả lời',
  messenger_send: 'Facebook không nhận tin gửi cho khách',
  messenger_job: 'Lỗi khi xử lý tin Fanpage',
};
// Mức độ để tô màu / đếm: khách bị ảnh hưởng trực tiếp = nặng
const SERIOUS = new Set(['claude_credit', 'claude_auth', 'claude_overload', 'claude_other', 'empty_reply', 'messenger_send', 'messenger_job']);

const MERGE_WINDOW_MS = 10 * 60000; // cùng loại + kênh + mã lỗi trong 10 phút → cộng dồn vào một dòng
const KEEP_DAYS = 30;

/** Bỏ khóa API, email, số điện thoại / mã dài khỏi nội dung lỗi trước khi lưu. */
function clean(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[khóa-đã-ẩn]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [đã-ẩn]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s.-]{8,}\d/g, '[số]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/** Phân loại lỗi Claude: hết tiền / sai khóa / quá tải / khác. */
function classify(err) {
  const msg = String((err && err.message) || '');
  const status = err && Number(err.status) ? Number(err.status) : null;
  if (/credit|balance|billing/i.test(msg)) return { kind: 'claude_credit', status };
  if (status === 401 || status === 403) return { kind: 'claude_auth', status };
  if (status === 429 || status === 408 || status === 409 || (status && status >= 500) || !status) return { kind: 'claude_overload', status };
  return { kind: 'claude_other', status };
}

let lastPurge = 0;
async function purgeOld(now = Date.now()) {
  if (now - lastPurge < 6 * 3600000) return;
  lastPurge = now;
  await db('ai_errors').where('last_at', '<', new Date(now - KEEP_DAYS * 86400000)).del();
}

/** ref: mã khách Fanpage (chỉ giữ 4 số cuối) hoặc chuỗi bất kỳ ngắn. */
async function log({ kind, channel = 'web', model = null, status = null, message = '', ref = null }) {
  try {
    if (!KINDS[kind]) kind = 'claude_other';
    const now = new Date();
    const msg = clean(message);
    const r = ref ? `fb…${String(ref).slice(-4)}` : null;
    const recent = await db('ai_errors')
      .where({ kind, channel })
      .andWhere((q) => (status == null ? q.whereNull('status') : q.where({ status })))
      .andWhere('last_at', '>', new Date(now.getTime() - MERGE_WINDOW_MS))
      .orderBy('id', 'desc')
      .first();
    if (recent) await db('ai_errors').where({ id: recent.id }).update({ count: Number(recent.count) + 1, last_at: now, message: msg || recent.message });
    else await db('ai_errors').insert({ kind, channel, model: model ? String(model).slice(0, 40) : null, status, message: msg, ref: r, count: 1, created_at: now, last_at: now });
    purgeOld().catch(() => {});
  } catch (e) {
    console.error('[ai-errors] không ghi được lỗi:', e.message);
  }
}

/** Số liệu cho trang quản trị: theo loại trong 24 giờ và 7 ngày. */
async function summary(now = Date.now()) {
  const since = (ms) => new Date(now - ms);
  const sum = async (ms) => {
    const rows = await db('ai_errors').where('last_at', '>', since(ms)).select('kind').sum({ n: 'count' }).groupBy('kind');
    const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const serious = Object.entries(by).filter(([k]) => SERIOUS.has(k)).reduce((a, [, n]) => a + n, 0);
    return { by, total, serious };
  };
  return { d1: await sum(86400000), d7: await sum(7 * 86400000) };
}

module.exports = { KINDS, SERIOUS, classify, clean, log, summary, purgeOld };
