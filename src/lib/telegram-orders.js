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
const payment = require('./payment');

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
  let account = null;
  if (order.payment_method === 'bank') {
    const acc = payment.accountForOrder(order, {});
    const isCompany = order.pay_account ? order.pay_account === 'company' : !!order.needs_vat;
    account = isCompany
      ? `🏢 Nhận tiền: <b>TK công ty</b>${acc.account ? ` · ${e(acc.bankName || acc.bankId)} ${payment.maskAccount(acc.account)}` : ' · <b>chưa cài đặt, cần gửi TK cho khách</b>'}`
      : `💳 Nhận tiền: TK bán lẻ${acc.account ? ` · ${e(acc.bankName || acc.bankId)} ${payment.maskAccount(acc.account)}` : ''}`;
  }
  const vat = order.needs_vat
    ? `🧾 <b>Xuất VAT:</b> ${e(order.vat_company)} · MST ${e(order.vat_tax_code)}\n    ${e(order.vat_address)} · ${e(order.vat_email)}`
    : null;
  const log = String(order.handled_log || '')
    .split('\n')
    .filter(Boolean)
    .slice(-8)
    .map((l) => `▸ ${e(l)}`)
    .join('\n');
  return [
    head,
    '',
    vat,
    `${STATUS_ICON[order.status] || '•'} <b>Trạng thái: ${ORDER_STATUS[order.status]}</b>`,
    pay,
    account,
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
/* ---------- Lệnh kho: /ton /nhap /giam /dat ---------- */
const KHO_HELP = [
  '📦 <b>Lệnh kho Lunar Lucky</b>',
  '<code>/ton</code> — xem tồn kho tất cả sản phẩm',
  '<code>/ton an khang</code> — xem một sản phẩm (gõ mã hoặc tên, không cần dấu)',
  '<code>/nhap LL001 20</code> — nhập thêm 20 giỏ',
  '<code>/giam LL001 2</code> — trừ 2 giỏ (hỏng, bán ngoài web…)',
  '<code>/dat LL001 45</code> — đặt lại đúng 45 giỏ sau khi kiểm kê',
  '',
  '<i>Nhóm có Chủ đề (Topics):</i> gõ <code>/chondon</code> trong chủ đề nhận đơn, <code>/chonkho</code> trong chủ đề kho.',
].join('\n');

async function reply(msg, html) {
  try {
    await notify.tgApi('sendMessage', {
      chat_id: msg.chat.id, text: html, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_to_message_id: msg.message_id, allow_sending_without_reply: true,
      ...(msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
    });
  } catch (err) {
    console.error('[telegram] trả lời lệnh thất bại:', err.message);
  }
}

async function stockList(query) {
  const inventory = require('./inventory');
  const limit = await inventory.threshold();
  let rows;
  if (query) {
    rows = await inventory.findProducts(query);
    if (!rows.length) return `Không tìm thấy sản phẩm "${e(query)}". Gõ <code>/ton</code> để xem tất cả mã.`;
  } else {
    rows = await db('products').where({ is_active: true }).select('id', 'sku', 'name', 'stock');
  }
  rows.sort((a, b) => a.stock - b.stock || String(a.sku).localeCompare(String(b.sku)));
  const time = require('./orders').logTime();
  const lines = rows.slice(0, 60).map((p) => {
    const icon = p.stock <= 0 ? '⛔' : p.stock <= limit ? '⚠️' : '▫️';
    return `${icon} <code>${e(p.sku || '—')}</code> ${e(p.name)}: <b>${p.stock}</b>`;
  });
  const more = rows.length > 60 ? `\n… và ${rows.length - 60} sản phẩm khác` : '';
  return `📦 <b>TỒN KHO</b> · ${time}\n${lines.join('\n')}${more}\n\n⚠️ = còn ≤ ${limit} giỏ · ⛔ = hết hàng`;
}

async function handleCommand(msg) {
  const text = String(msg.text || '').trim();
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return;
  const cmd = m[1].toLowerCase();
  const args = (m[2] || '').trim();
  if (!['ton', 'nhap', 'giam', 'dat', 'kho', 'help', 'start', 'chondon', 'chonkho'].includes(cmd)) return;

  // Chỉ nhận lệnh từ đúng nhóm/cuộc trò chuyện đã chọn trong admin
  const allowed = await notify.telegramChatId();
  if (String(msg.chat.id) !== String(allowed)) return;

  if (cmd === 'kho' || cmd === 'help' || cmd === 'start') return reply(msg, KHO_HELP);
  if (cmd === 'chondon' || cmd === 'chonkho') {
    if (!msg.is_topic_message || !msg.message_thread_id) {
      return reply(msg, 'Hãy bật <b>Chủ đề (Topics)</b> cho nhóm, tạo chủ đề rồi gõ lệnh này <b>bên trong</b> chủ đề đó.');
    }
    const key = cmd === 'chondon' ? 'telegram_order_thread' : 'telegram_stock_thread';
    await settings.save({ [key]: String(msg.message_thread_id) });
    return reply(msg, cmd === 'chondon'
      ? '✅ Từ giờ <b>đơn hàng mới</b> và yêu cầu báo giá sẽ gửi vào chủ đề này.'
      : '✅ Từ giờ <b>cảnh báo kho</b> (sắp hết, hết hàng) sẽ gửi vào chủ đề này. Gõ <code>/ton</code> ở đây để xem tồn kho.');
  }
  if (cmd === 'ton') return reply(msg, await stockList(args));

  const parts = args.split(/\s+/).filter(Boolean);
  const qty = Number(parts[parts.length - 1]);
  const query = parts.slice(0, -1).join(' ');
  if (!query || !Number.isInteger(qty) || qty < 0 || (cmd !== 'dat' && qty === 0)) {
    return reply(msg, `Sai cú pháp. Ví dụ: <code>/${cmd} LL001 ${cmd === 'dat' ? 45 : 20}</code>\n\n${KHO_HELP}`);
  }

  const inventory = require('./inventory');
  const found = await inventory.findProducts(query);
  if (!found.length) return reply(msg, `Không tìm thấy sản phẩm "${e(query)}". Gõ <code>/ton</code> để xem mã.`);
  if (found.length > 1) {
    const list = found.slice(0, 10).map((p) => `• <code>${e(p.sku)}</code> ${e(p.name)}`).join('\n');
    return reply(msg, `Có ${found.length} sản phẩm khớp "${e(query)}", hãy gõ theo mã:\n${list}`);
  }
  const mode = { nhap: 'add', giam: 'sub', dat: 'set' }[cmd];
  const r = await inventory.adjust(found[0].id, mode, qty);
  const diff = r.after - r.before;
  const by = personName(msg.from || {});
  console.log(`[kho] ${r.product.sku} ${r.before} → ${r.after} (${cmd} ${qty}) · ${by}`);
  let out = `✅ <b>${e(r.product.name)}</b> (<code>${e(r.product.sku)}</code>): ${r.before} → <b>${r.after}</b> (${diff >= 0 ? '+' : ''}${diff}) · ${e(by)}`;
  if (cmd === 'giam' && r.before - qty < 0) out += `\n<i>Chỉ còn ${r.before} nên đã trừ về 0.</i>`;
  if (!r.product.is_active) out += '\n<i>Lưu ý: sản phẩm này đang ẩn trên web.</i>';
  const warn = await inventory.lowStockMessage(r.product, r.before, r.after);
  if (warn) out += `\n\n${warn}`;
  return reply(msg, out);
}

/** Gửi cảnh báo sắp hết / hết hàng sau khi khách đặt đơn. */
async function stockAlertsAfterOrder(lines) {
  const inventory = require('./inventory');
  for (const l of lines) {
    if (!l.product_id) continue;
    const p = await db('products').where({ id: l.product_id }).first();
    if (!p) continue;
    const warn = await inventory.lowStockMessage(p, p.stock + l.qty, p.stock);
    if (warn) await notify.telegram(warn, null, { topic: 'stock' });
  }
}

async function handleUpdate(update) {
  const mig = update.message && (update.message.migrate_to_chat_id || update.message.migrate_from_chat_id);
  if (mig) {
    const current = String(await notify.telegramChatId());
    const from = String(update.message.migrate_from_chat_id || update.message.chat.id);
    const to = String(update.message.migrate_to_chat_id || update.message.chat.id);
    if (current === from && from !== to) {
      await settings.save({ telegram_chat_id: to, telegram_order_thread: '', telegram_stock_thread: '' });
      console.log(`[telegram] nhóm chuyển mã ${from} → ${to}, đã cập nhật`);
    }
    return;
  }
  if (update.message) {
    await rememberChat(update.message.chat);
    if (String(update.message.text || '').startsWith('/')) return handleCommand(update.message);
    return;
  }
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
  // Menu lệnh hiện khi gõ "/" trong Telegram
  await notify.tgApi('setMyCommands', {
    commands: [
      { command: 'ton', description: 'Xem tồn kho (thêm mã/tên để xem 1 sản phẩm)' },
      { command: 'nhap', description: 'Nhập thêm hàng: /nhap LL001 20' },
      { command: 'giam', description: 'Trừ hàng: /giam LL001 2' },
      { command: 'dat', description: 'Đặt lại tồn kho: /dat LL001 45' },
      { command: 'kho', description: 'Hướng dẫn lệnh kho' },
      { command: 'chondon', description: 'Chọn chủ đề này để nhận đơn hàng mới' },
      { command: 'chonkho', description: 'Chọn chủ đề này để nhận cảnh báo kho' },
    ],
  }).catch((err) => console.error('[telegram] không đặt được menu lệnh:', err.message));
  return { ok: true, url };
}

module.exports = {
  sendNewOrder, refreshOrderMessage, handleUpdate, ensureWebhook, webhookSecret, messageText, keyboard, stockAlertsAfterOrder,
};
