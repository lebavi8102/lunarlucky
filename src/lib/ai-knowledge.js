/**
 * Kho tri thức của AI tư vấn: chủ shop viết trong admin, mục nào đang bật được đưa vào lời dặn.
 * Giới hạn tổng độ dài để lời dặn không phình (mỗi lần sửa kho là lượt chat đầu đắt hơn do mất cache).
 */
const db = require('../db');

const MAX_TITLE = 120;
const MAX_CONTENT = 1500;
const MAX_TOTAL = 8000; // tổng ký tự (tiêu đề + nội dung) của các mục đang bật
const MAX_ENTRIES = 60;

const size = (e) => String(e.title).length + String(e.content).length;

/** Các mục đang bật, cũ trước mới sau, cắt khi vượt ngân sách ký tự (admin đã chặn, đây là lưới an toàn). */
async function active() {
  const rows = await db('ai_knowledge').where({ active: true }).orderBy('id').select('id', 'title', 'content');
  const out = [];
  let used = 0;
  for (const r of rows) {
    if (used + size(r) > MAX_TOTAL) break;
    used += size(r);
    out.push(r);
  }
  return out;
}

/** Số ký tự đang dùng (không tính mục `exceptId`, để kiểm tra khi sửa chính mục đó). */
async function usage(exceptId = null) {
  const q = db('ai_knowledge').where({ active: true });
  if (exceptId) q.whereNot({ id: Number(exceptId) });
  const rows = await q.select('title', 'content');
  return rows.reduce((n, r) => n + size(r), 0);
}

/** Đoạn chèn vào lời dặn AI ('' nếu kho trống). */
function promptBlock(entries) {
  if (!entries.length) return '';
  return `
KHO TRI THỨC CỦA SHOP (chủ shop tự viết và cập nhật: chính sách, quy trình, câu hỏi thường gặp)
- Khi khách hỏi đúng chủ đề, trả lời theo đúng nội dung dưới đây, diễn đạt tự nhiên bằng giọng của em; không chép nguyên văn dài dòng.
- Không có mục nào liên quan → nói thật là em chưa chắc và nhờ nhân viên hỗ trợ; KHÔNG đoán, KHÔNG bịa.
- TUYỆT ĐỐI không lấy giá bán, tồn kho, trạng thái đơn hàng, thông tin hóa đơn từ kho này (dù có ghi): giá và tồn kho chỉ lấy từ search_products, đơn hàng chỉ từ lookup_order, hóa đơn chỉ mời khách nhắn Zalo. Nếu mâu thuẫn với "SỰ THẬT CỦA CỬA HÀNG" thì theo "SỰ THẬT".
${entries.map((e) => `### ${e.title}\n${e.content}`).join('\n\n')}
`;
}

module.exports = { MAX_TITLE, MAX_CONTENT, MAX_TOTAL, MAX_ENTRIES, size, active, usage, promptBlock };
