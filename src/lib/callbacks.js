/**
 * "Để lại SĐT – Lunar Lucky gọi lại trong 5 phút":
 * lưu yêu cầu, báo ngay vào nhóm Telegram (chủ đề Đơn hàng) kèm nút "✅ Đã gọi".
 */
const db = require('../db');
const notify = require('./notify');
const config = require('../config');
const { logTime } = require('./orders');

const e = notify.escapeTg;
const SOURCE = { 'san-pham': 'trang sản phẩm', 'gio-hang': 'giỏ hàng', 'thanh-toan': 'trang thanh toán', ai: 'AI tư vấn' };

function messageText(r) {
  return [
    r.status === 'done' ? '☎️ <b>YÊU CẦU GỌI LẠI</b> · đã xử lý' : '🔥 <b>KHÁCH CẦN GỌI LẠI</b>',
    '',
    `👤 ${e(r.name)}`,
    `📞 <b>${e(r.phone)}</b>`,
    r.interest ? `🎁 Quan tâm: ${e(r.interest)}` : null,
    r.note ? `📝 ${e(r.note)}` : null,
    `🕒 ${e(r.created_label || '')}${r.source ? ` · từ ${e(SOURCE[r.source] || r.source)}` : ''}`,
    r.status === 'done' ? `\n✅ Đã gọi${r.handled_by ? ` · ${e(r.handled_by)}` : ''}` : '\nGọi lại cho khách trong 5 phút, chốt đơn và tạo đơn trong admin nếu khách đồng ý.',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

function keyboard(r) {
  const open = { text: '🔗 Danh sách gọi lại', url: `${config.publicUrl}/admin/goi-lai` };
  return r.status === 'done' ? { inline_keyboard: [[open]] } : { inline_keyboard: [[{ text: '✅ Đã gọi', callback_data: `g:${r.id}:d` }], [open]] };
}

async function create({ name, phone, productId, interest, note, source }) {
  const row = {
    name: String(name).slice(0, 120), phone, product_id: productId || null,
    interest: interest ? String(interest).slice(0, 500) : null, note: note ? String(note).slice(0, 300) : null,
    source: SOURCE[source] ? source : null, status: 'new',
  };
  const [id] = await db('callback_requests').insert(row);
  row.id = typeof id === 'object' ? id.id : id;
  row.created_label = logTime();
  try {
    const msg = await notify.telegram(messageText(row), null, { topic: 'consult', reply_markup: keyboard(row) });
    if (msg && msg.message_id) {
      await db('callback_requests').where({ id: row.id }).update({ tg_chat_id: String(msg.chat.id), tg_message_id: msg.message_id });
    }
  } catch (err) {
    console.error('[gọi lại] báo Telegram lỗi:', err.message);
  }
  return row;
}

async function markDone(id, by) {
  const r = await db('callback_requests').where({ id: Number(id) }).first();
  if (!r) return null;
  if (r.status !== 'done') {
    await db('callback_requests').where({ id: r.id }).update({ status: 'done', handled_by: by || null, updated_at: new Date() });
  }
  const row = { ...r, status: 'done', handled_by: r.status === 'done' ? r.handled_by : by };
  if (row.tg_message_id && config.telegram.token) {
    row.created_label = require('./format').dateTime(r.created_at);
    await notify
      .tgApi('editMessageText', {
        chat_id: row.tg_chat_id, message_id: Number(row.tg_message_id), text: messageText(row),
        parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard(row),
      })
      .catch(() => {});
  }
  return { before: r, row };
}

module.exports = { create, markDone, messageText };
