const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const config = require('../config');
const { money, ymd, slotLabel, sourceLabel } = require('./format');

let transporter = null;
function getTransport() {
  if (!config.mail.host || !config.mail.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, template, data, attachments }) {
  if (!to) return;
  const html = await ejs.renderFile(
    path.join(__dirname, '../../views/emails', `${template}.ejs`),
    { ...data, money, ymd, siteUrl: config.siteUrl },
  );
  const t = getTransport();
  if (!t) {
    console.log(`[mail] (chưa cấu hình SMTP) → ${to}: ${subject}`);
    return;
  }
  try {
    // Khách bấm "Trả lời" → về đúng email chăm sóc khách hàng của shop
    const replyTo = (data && data.s && data.s.shop_email) || undefined;
    const info = await t.sendMail({ from: config.mail.from, replyTo, to, subject, html, ...(attachments ? { attachments } : {}) });
    console.log(`[mail] → ${to}: ${subject} · ${info.response}`);
  } catch (err) {
    console.error('[mail] gửi thất bại:', err.message);
  }
}

/** Gửi email thử (báo lỗi rõ ràng thay vì im lặng) — dùng ở admin → Cài đặt. */
async function testMail(to) {
  const t = getTransport();
  if (!t) throw new Error('Chưa cài email: thiếu SMTP_HOST / SMTP_USER / SMTP_PASS trên Render.');
  try {
    const info = await t.sendMail({
      from: config.mail.from,
      to,
      subject: 'Lunar Lucky: email thử thành công',
      html: '<p>Email xác nhận đơn hàng của Lunar Lucky đã hoạt động. Khách đặt hàng có nhập email sẽ nhận được thư xác nhận.</p>',
    });
    console.log(`[mail] thử → ${to}: ${info.response} (nhận: ${info.accepted.join(', ') || 'không'}; từ chối: ${info.rejected.join(', ') || 'không'})`);
    if (!info.accepted.length) throw new Error(`Máy chủ email từ chối người nhận ${to}`);
    return info;
  } catch (err) {
    if (/từ chối người nhận/.test(err.message)) throw err;
    if (/Invalid login|535|Username and Password not accepted/i.test(err.message)) {
      throw new Error('Gmail từ chối đăng nhập: kiểm tra SMTP_USER và mật khẩu ứng dụng (không phải mật khẩu Gmail thường).');
    }
    throw new Error(`Gửi thất bại: ${err.message}`);
  }
}

function escapeTg(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/* ---------- Telegram ----------
 * Token bot nằm trong biến môi trường TELEGRAM_BOT_TOKEN (bí mật).
 * Chat ID có thể đặt bằng TELEGRAM_CHAT_ID hoặc chọn trong /admin/telegram (lưu ở settings).
 */
async function tgApi(method, body) {
  const { token } = config.telegram;
  if (!token) throw new Error('Chưa đặt TELEGRAM_BOT_TOKEN trên máy chủ.');
  // Mạng từ máy chủ tới Telegram đôi khi chập chờn ("fetch failed") → thử lại tối đa 3 lần
  let r;
  for (let attempt = 1; ; attempt++) {
    try {
      r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(10000),
      });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((ok) => setTimeout(ok, attempt * 1500));
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!data.ok) {
    if (r.status === 401) throw new Error('Token bot không đúng. Kiểm tra lại TELEGRAM_BOT_TOKEN trên Render.');
    if (/chat not found|bot was blocked|not a member/i.test(data.description || '')) {
      throw new Error('Bot chưa thể nhắn vào cuộc trò chuyện này. Hãy bấm Start với bot hoặc thêm bot vào nhóm.');
    }
    const err = new Error(data.description || `Telegram trả về lỗi ${r.status}`);
    // Nhóm được nâng lên supergroup (bật Topics…) → Telegram báo mã nhóm mới
    if (data.parameters && data.parameters.migrate_to_chat_id) err.migrateTo = String(data.parameters.migrate_to_chat_id);
    throw err;
  }
  return data.result;
}

async function telegramChatId() {
  if (config.telegram.chatId) return config.telegram.chatId;
  return (await require('./settings').all()).telegram_chat_id || '';
}

/** Gửi tin; trả về message Telegram (có message_id) hoặc false nếu chưa cấu hình/lỗi. */
/**
 * extra.topic: 'order' (mặc định) | 'stock' — gửi vào đúng chủ đề (Topics) của nhóm nếu đã chọn bằng /chondon, /chonkho.
 */
async function telegram(html, chatIdOverride, extra = {}) {
  const chatId = chatIdOverride || (await telegramChatId());
  const { topic = 'order', ...rest } = extra;
  extra = rest;
  if (!chatIdOverride && extra.message_thread_id === undefined) {
    const st = await require('./settings').all();
    // Chủ đề nhắc việc chưa chọn (/chonnhac) → gửi vào chủ đề đơn hàng
    const thread = st[`telegram_${topic}_thread`] || (topic === 'ops' ? st.telegram_order_thread : '');
    if (thread) extra.message_thread_id = Number(thread);
  }
  if (!config.telegram.token || !chatId) {
    console.log('[telegram] (chưa cấu hình)\n' + html.replace(/<[^>]+>/g, ''));
    return false;
  }
  let chatId2 = chatId;
  try {
    const send = (x) => tgApi('sendMessage', { chat_id: chatId2, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...x });
    try {
      return await send(extra);
    } catch (err) {
      // Nhóm đổi mã (lỡ không nhận được tin báo đổi mã qua webhook) → lưu mã mới, gửi lại
      if (err.migrateTo && !chatIdOverride && !config.telegram.chatId) {
        chatId2 = err.migrateTo;
        await require('./settings').save({ telegram_chat_id: chatId2, telegram_order_thread: '', telegram_stock_thread: '', telegram_ops_thread: '' });
        console.log(`[telegram] nhóm chuyển mã ${chatId} → ${chatId2}, đã cập nhật`);
        const { message_thread_id, ...noThread } = extra;
        return await send(noThread);
      }
      // Chủ đề đã bị xóa/đóng → gửi vào nhóm chung để không mất tin
      if (extra.message_thread_id && /thread|topic/i.test(err.message)) {
        const { message_thread_id, ...noThread } = extra;
        return await send(noThread);
      }
      throw err;
    }
  } catch (err) {
    console.error('[telegram] gửi thất bại:', err.message);
    if (chatIdOverride) throw err;
    return false;
  }
}

/** Thông tin bot + các cuộc trò chuyện gần đây đã nhắn cho bot (để chọn chat ID). */
async function telegramDiscover() {
  const me = await tgApi('getMe');
  const chats = new Map();
  // Khi webhook đang bật, Telegram không cho getUpdates → dùng danh sách chat webhook đã ghi nhớ
  try {
    const seen = JSON.parse((await require('./settings').all()).telegram_seen_chats || '[]');
    for (const c of seen) chats.set(c.id, c);
  } catch {
    /* bỏ qua */
  }
  let updates = [];
  try {
    updates = await tgApi('getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member'] });
  } catch (err) {
    if (!/webhook|conflict/i.test(err.message)) throw err;
  }
  for (const u of updates) {
    const chat = (u.message || u.my_chat_member || {}).chat;
    if (!chat) continue;
    const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    chats.set(String(chat.id), { id: String(chat.id), name, type: chat.type === 'private' ? 'Cá nhân' : 'Nhóm' });
  }
  return { bot: { name: me.first_name, username: me.username }, chats: [...chats.values()] };
}

function orderTelegram(order, items) {
  const e = escapeTg;
  const list = items.map((i) => `• ${e(i.name)} × ${i.qty} = ${money(i.line_total)}`).join('\n');
  return [
    `🧧 <b>ĐƠN MỚI ${e(order.code)}</b>`,
    order.is_gift
      ? `🎁 <b>GIAO TẶNG</b> → ${e(order.recipient_name)} · ${e(order.recipient_phone)}\n📍 ${e(order.recipient_address)}${order.province ? ', ' + e(order.province) : ''}\n👤 Người đặt: ${e(order.customer_name)} · ${e(order.phone)} (không kèm hóa đơn giá)`
      : `👤 ${e(order.customer_name)} · ${e(order.phone)}\n📍 ${e(order.address)}${order.province ? ', ' + e(order.province) : ''}`,
    order.delivery_date ? `📅 Giao ngày: <b>${ymd(order.delivery_date)}</b>${order.delivery_slot ? ` · <b>${slotLabel(order.delivery_slot)}</b>` : ''}` : null,
    '',
    list,
    '',
    order.discount ? `Giảm giá (${e(order.coupon_code)}): −${money(order.discount)}` : null,
    order.shipping_fee ? `Phí giao: ${money(order.shipping_fee)}` : 'Phí giao: miễn phí',
    order.vat_fee ? `Phí xuất VAT${order.vat_fee_percent ? ` (${Number(order.vat_fee_percent)}%)` : ''}: ${money(order.vat_fee)}` : null,
    `<b>Tổng: ${money(order.total)}</b> · ${order.payment_method === 'bank' ? 'Chuyển khoản' : 'COD'}`,
    order.card_message ? `💌 Thiệp: “${e(order.card_message)}”` : null,
    order.note ? `📝 ${e(order.note)}` : null,
    order.created_by || (order.source && order.source !== 'web')
      ? `📣 Kênh: ${e(sourceLabel(order.source))}${order.created_by ? ` · đặt hộ bởi ${e(order.created_by)}` : ''}`
      : null,
    `\n${config.publicUrl}/admin/don-hang/${order.id}`,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

function quoteTelegram(q) {
  const e = escapeTg;
  return [
    `🏢 <b>YÊU CẦU BÁO GIÁ DOANH NGHIỆP</b>`,
    `${e(q.company)}`,
    `👤 ${e(q.contact_name)} · ${e(q.phone)}${q.email ? ' · ' + e(q.email) : ''}`,
    q.quantity ? `Số lượng: ${q.quantity} giỏ` : null,
    q.budget ? `Ngân sách/giỏ: ${e(q.budget)}` : null,
    q.delivery_date ? `Ngày giao: ${ymd(q.delivery_date)}` : null,
    q.logo_print ? 'In logo: Có' : null,
    q.message ? `📝 ${e(q.message)}` : null,
    `\n${config.publicUrl}/admin/bao-gia`,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = { sendMail, testMail, telegram, tgApi, telegramDiscover, telegramChatId, orderTelegram, quoteTelegram, escapeTg };
