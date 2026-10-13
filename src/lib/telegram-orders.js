/**
 * Xử lý đơn hàng ngay trong nhóm Telegram:
 * - Gửi tin "ĐƠN MỚI" kèm nút trạng thái (inline keyboard)
 * - Nhận lệnh bấm nút qua webhook, cập nhật đơn, sửa lại tin nhắn cho cả nhóm thấy
 */
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const notify = require('./notify');
const settings = require('./settings');
const { ORDER_STATUS, PAYMENT_STATUS, loadOrder, updateOrder } = require('./orders');

const e = notify.escapeTg;

/** Khóa bí mật Telegram gửi kèm mỗi webhook, suy ra từ SESSION_SECRET (không cần biến mới). */
function webhookSecret() {
  return crypto.createHash('sha256').update(`tg-webhook:${config.sessionSecret}`).digest('hex').slice(0, 48);
}

/** Thứ tự xử lý đơn và nút tương ứng. */
const STEPS = [
  ['confirmed', 'c', '✅ Xác nhận'],
  ['packing', 'p', '📦 Đóng gói'],
  ['shipping', 's', '🚚 Đang giao'],
  ['completed', 'd', '🎉 Hoàn tất'],
];
const ACTIONS = { c: 'confirmed', p: 'packing', s: 'shipping', d: 'completed' };
const STATUS_ICON = { new: '🆕', confirmed: '✅', packing: '📦', shipping: '🚚', completed: '🎉', cancelled: '❌' };

function messageText(order, items) {
  const head = notify
    .orderTelegram(order, items)
    .replace(/🧧 <b>ĐƠN MỚI /, '🧧 <b>ĐƠN ')
    .replace(/\n\nhttps?:\/\/\S+$/, '');
  const pay =
    order.payment_method === 'bank'
      ? `${order.payment_status === 'paid' ? '💰' : '⏳'} ${PAYMENT_STATUS[order.payment_status]} (chuyển khoản, nội dung ${e(order.code)})`
      : `💵 COD${order.payment_status === 'paid' ? ' · đã thu tiền' : ''}`;
  const log = String(order.handled_log || '')
    .split('\n')
    .filter(Boolean)
    .slice(-8)
    .map((l) => `▸ ${e(l)}`)
    .join('\n');
  return [
    head,
    '',
    `${STATUS_ICON[order.status] || '•'} <b>Trạng thái: ${ORDER_STATUS[order.status]}</b>`,
    pay,
    log ? `\n<i>Lịch sử xử lý</i>\n${log}` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

function keyboard(order, { confirmCancel = false } = {}) {
  const id = order.id;
  const openBtn = { text: '🔗 Mở đơn', url: `${config.publicUrl}/admin/don-hang/${id}` };
  if (confirmCancel) {
    return {
      inline_keyboard: [
        [{ text: `❗ Xác nhận HỦY đơn ${order.code}?`, callback_data: `o:${id}:noop` }],
        [
          { text: 'Có, hủy đơn', callback_data: `o:${id}:xx` },
          { text: 'Không', callback_data: `o:${id}:back` },
        ],
      ],
    };
  }
  if (order.status === 'cancelled' || order.status === 'completed') {
    const row = [openBtn];
    if (order.status === 'cancelled') row.unshift({ text: '↩️ Khôi phục đơn', callback_data: `o:${id}:r` });
    return { inline_keyboard: [row] };
  }
  const idx = STEPS.findIndex((s) => s[0] === order.status);
  const next = STEPS.slice(idx + 1);
  const rows = [];
  for (let i = 0; i < next.length; i += 2) {
    rows.push(next.slice(i, i + 2).map(([, code, label]) => ({ text: label, callback_data: `o:${id}:${code}` })));
  }
  const extra = [];
  if (order.payment_status !== 'paid') {
    extra.push({ text: order.payment_method === 'bank' ? '💰 Đã nhận CK' : '💵 Đã thu COD', callback_data: `o:${id}:$` });
  }
  extra.push({ text: '❌ Hủy', callback_data: `o:${id}:x` });
  rows.push(extra);
  rows.push([openBtn]);
  return { inline_keyboard: rows };
}

/** Gửi tin đơn mới vào nhóm, nhớ message_id để sau này sửa tin khi đổi trạng thái. */
async function sendNewOrder(order, items) {
  try {
    const msg = await notify.telegram(messageText(order, items).replace('🧧 <b>ĐƠN ', '🧧 <b>ĐƠN MỚI '), null, {
      reply_markup: keyboard(order),
    });
    if (msg && msg.message_id) {
      await db('orders').where({ id: order.id }).update({ tg_chat_id: String(msg.chat.id), tg_message_id: msg.message_id });
    }
  } catch (err) {
    console.error('[telegram] gửi đơn mới thất bại:', err.message);
  }
}

/** Sửa lại tin nhắn của đơn trong nhóm (gọi sau khi đổi trạng thái ở admin). */
async function refreshOrderMessage(orderId, opts = {}) {
  try {
    const data = await loadOrder(orderId);
    if (!data || !data.order.tg_message_id || !config.telegram.token) return;
    const { order, items } = data;
    await notify.tgApi('editMessageText', {
      chat_id: order.tg_chat_id,
      message_id: Number(order.tg_message_id),
      text: messageText(order, items),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard(order, opts),
    });
  } catch (err) {
    if (!/message is not modified/i.test(err.message)) console.error('[telegram] sửa tin thất bại:', err.message);
  }
}

function personName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || (from.username ? '@' + from.username : 'Thành viên');
}

/** Ghi nhớ các nhóm/cá nhân đã nhắn bot (để admin chọn nơi nhận khi webhook đang bật). */
async function rememberChat(chat) {
  if (!chat) return;
  const s = await settings.all();
  let list = [];
  try {
    list = JSON.parse(s.telegram_seen_chats || '[]');
  } catch {
    list = [];
  }
  const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
  const item = { id: String(chat.id), name, type: chat.type === 'private' ? 'Cá nhân' : 'Nhóm' };
  list = [item, ...list.filter((c) => c.id !== item.id)].slice(0, 20);
  await settings.save({ telegram_seen_chats: JSON.stringify(list) });
}

async function answer(cb, text, alert = false) {
  try {
    await notify.tgApi('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert });
  } catch {
    /* bỏ qua */
  }
}

/** Xử lý một update từ Telegram webhook. */
async function handleUpdate(update) {
  if (update.message) return rememberChat(update.message.chat);
  if (update.my_chat_member) return rememberChat(update.my_chat_member.chat);
  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) return;

  const m = /^o:(\d+):(\w+|\$)$/.exec(cb.data);
  if (!m) return answer(cb, 'Lệnh không hợp lệ.');
  const [, id, action] = m;

  // Chỉ nhận lệnh từ đúng nhóm/cuộc trò chuyện đã chọn trong admin
  const allowed = await notify.telegramChatId();
  if (String(cb.message.chat.id) !== String(allowed)) {
    return answer(cb, 'Cuộc trò chuyện này không có quyền xử lý đơn.', true);
  }

  const data = await loadOrder(id);
  if (!data) return answer(cb, 'Không tìm thấy đơn hàng.', true);
  const by = personName(cb.from);

  if (action === 'noop') return answer(cb, '');
  if (action === 'x') {
    await refreshOrderMessage(id, { confirmCancel: true });
    return answer(cb, 'Bấm "Có, hủy đơn" để xác nhận.');
  }
  if (action === 'back') {
    await refreshOrderMessage(id);
    return answer(cb, 'Đã giữ nguyên đơn.');
  }

  let changes = null;
  if (ACTIONS[action]) changes = { status: ACTIONS[action] };
  else if (action === 'xx') changes = { status: 'cancelled' };
  else if (action === 'r') changes = { status: 'confirmed' };
  else if (action === '$') changes = { payment_status: 'paid' };
  if (!changes) return answer(cb, 'Lệnh không hợp lệ.');

  const r = await updateOrder(id, changes, { by: `${by} (Telegram)` });
  await refreshOrderMessage(id);
  const label = changes.status ? ORDER_STATUS[changes.status] : PAYMENT_STATUS[changes.payment_status];
  return answer(cb, r && r.changed ? `Đã cập nhật: ${label}` : 'Đơn đã ở trạng thái này.');
}

/** Đăng ký webhook với Telegram (gọi khi khởi động và khi chọn nơi nhận). */
async function ensureWebhook() {
  if (!config.telegram.token) return { ok: false, reason: 'no-token' };
  if (!/^https:\/\//.test(config.publicUrl)) return { ok: false, reason: 'no-https' };
  const url = `${config.publicUrl}/telegram/webhook`;
  await notify.tgApi('setWebhook', {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    drop_pending_updates: false,
  });
  return { ok: true, url };
}

module.exports = { sendNewOrder, refreshOrderMessage, handleUpdate, ensureWebhook, webhookSecret, messageText, keyboard };
