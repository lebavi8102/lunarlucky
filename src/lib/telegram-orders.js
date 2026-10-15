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
  ['shipping', 's', '🚚 Nhận đi giao'],
  ['completed', 'd', '🎉 Đã giao xong'],
];
const ACTIONS = { c: 'confirmed', p: 'packing', s: 'shipping', d: 'completed' };
const STATUS_ICON = { new: '🆕', confirmed: '✅', packing: '📦', shipping: '🚚', completed: '🎉', cancelled: '❌' };

/**
 * Ghi chú cho người xử lý: đơn ngoài Hà Nội (gửi chuyển phát sớm), khách quen / hay hủy, đơn có thể trùng.
 * Tính từ database nên dùng chung khi gửi tin mới và khi sửa tin.
 */
async function opsNotes(order) {
  const notes = [];
  if (!/hà nội/i.test(String(order.province || '')) && order.delivery_date && order.status !== 'cancelled' && order.status !== 'completed') {
    const s = await settings.all();
    const lead = Math.max(1, (Number(s.province_min_days) || 3) - 1);
    const d = new Date(String(order.delivery_date).slice(0, 10) + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() - lead);
      notes.push(`🚛 <b>Ngoài Hà Nội</b> · gửi chuyển phát <b>muộn nhất ${d.toISOString().slice(0, 10).split('-').reverse().join('/')}</b>`);
    }
  }
  const tail = String(order.phone || '').replace(/\D/g, '').slice(-9);
  if (tail.length === 9) {
    const others = await db('orders').where('phone', 'like', `%${tail}`).whereNot('id', order.id).select('id', 'code', 'status', 'created_at');
    const created = new Date(order.created_at || Date.now()).getTime();
    // Đơn cũ hơn 2 giờ mới tính là "đã mua trước" (đơn sát giờ là nghi trùng, xét riêng bên dưới)
    const done = others.filter((o) => o.status !== 'cancelled' && new Date(o.created_at).getTime() < created - 2 * 3600000).length;
    const cancelled = others.filter((o) => o.status === 'cancelled').length;
    if (done) notes.push(`⭐ Khách quen · đã mua ${done} đơn trước`);
    if (cancelled >= 2) notes.push(`⚠️ SĐT này đã có <b>${cancelled} đơn hủy</b> — gọi xác nhận kỹ trước khi giao`);
    const dup = others.find((o) => o.status !== 'cancelled' && Math.abs(new Date(o.created_at).getTime() - created) < 2 * 3600000);
    if (dup) notes.push(`⚠️ <b>Có thể trùng đơn</b> ${e(dup.code)} (cùng SĐT, đặt cách nhau dưới 2 giờ) — kiểm tra trước khi soạn`);
  }
  return notes.join('\n') || null;
}

function messageText(order, items, notes = null) {
  const head = notify
    .orderTelegram(order, items)
    .replace(/🧧 <b>ĐƠN MỚI /, '🧧 <b>ĐƠN ')
    .replace(/\n\nhttps?:\/\/\S+$/, '');
  const pay =
    order.payment_method === 'bank'
      ? `${order.payment_status === 'paid' ? '💰' : '⏳'} ${PAYMENT_STATUS[order.payment_status]} (chuyển khoản, nội dung ${e(order.code)})`
      : order.payment_status === 'paid'
        ? '💵 COD · đã thu tiền'
        : order.status === 'completed' && payment.codDue(order) > 0
          ? `⚠️ <b>Đã giao nhưng CHƯA thu COD ${require('./format').money(payment.codDue(order))}</b>`
          : payment.awaitingMoney(order)
          ? `⏳ COD · <b>chờ cọc ${require('./format').money(order.deposit_amount)}</b> — chưa soạn hàng`
          : `💵 <b>COD · thu ${require('./format').money(payment.codDue(order))} khi giao</b>${order.payment_status === 'deposit' ? ` (đã cọc ${require('./format').money(order.deposit_amount)})` : ''}`;
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
    notes,
    vat,
    `${STATUS_ICON[order.status] || '•'} <b>Trạng thái: ${ORDER_STATUS[order.status]}</b>`,
    order.status === 'cancelled' && order.payment_status === 'paid' ? '⚠️ <b>Khách đã thanh toán — cần hoàn tiền</b>' : null,
    pay,
    order.cod_collected_by ? `💵 ${e(order.cod_collected_by)} đã thu ${require('./format').money(order.cod_collected_amount || 0)} — tiền đang ở shipper, nộp lại cuối ngày` : null,
    order.shipper && order.status === 'shipping' ? `🛵 <b>Đang giao: ${e(order.shipper)}</b>` : null,
    account,
    log ? `\n<i>Lịch sử xử lý</i>\n${log}` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

const FAIL_REASONS = { f1: 'Khách hẹn giao ngày khác', f2: 'Không liên lạc được khách', f3: 'Khách từ chối nhận hàng' };

function keyboard(order, { confirmCancel = false, confirmRestore = false, confirmDone = false, failReasons = false } = {}) {
  const id = order.id;
  const openBtn = { text: '🔗 Mở đơn', url: `${config.publicUrl}/admin/don-hang/${id}` };
  if (confirmDone) {
    const due = require('./format').money(payment.codDue(order));
    return {
      inline_keyboard: [
        [{ text: `💵 Đã thu ${due} — giao xong`, callback_data: `o:${id}:dc` }],
        [{ text: 'Giao xong nhưng CHƯA thu tiền', callback_data: `o:${id}:dn` }],
        [{ text: '↩️ Quay lại', callback_data: `o:${id}:back` }],
      ],
    };
  }
  if (failReasons) {
    return {
      inline_keyboard: [
        ...Object.entries(FAIL_REASONS).map(([k, t]) => [{ text: t, callback_data: `o:${id}:${k}` }]),
        [{ text: '↩️ Quay lại', callback_data: `o:${id}:back` }],
      ],
    };
  }
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
  if (confirmRestore) {
    return {
      inline_keyboard: [
        [{ text: `↩️ Khôi phục đơn ${order.code}?`, callback_data: `o:${id}:noop` }],
        [
          { text: 'Có, khôi phục', callback_data: `o:${id}:rr` },
          { text: 'Không', callback_data: `o:${id}:back` },
        ],
      ],
    };
  }
  if (order.status === 'cancelled') {
    return { inline_keyboard: [[{ text: '↩️ Khôi phục đơn', callback_data: `o:${id}:r` }, openBtn]] };
  }
  // Đơn đã hoàn tất vẫn hủy được (khách trả hàng, đơn thử...)
  if (order.status === 'completed') {
    return { inline_keyboard: [[{ text: '❌ Hủy', callback_data: `o:${id}:x` }, openBtn]] };
  }
  const idx = STEPS.findIndex((s) => s[0] === order.status);
  const next = STEPS.slice(idx + 1);
  const rows = [];
  if (order.status === 'shipping') {
    // Shipper đang giao: chỉ cần 2 nút chính
    rows.push([{ text: '🎉 Đã giao xong', callback_data: `o:${id}:d` }, { text: '⚠️ Giao không được', callback_data: `o:${id}:f` }]);
  } else {
    for (let i = 0; i < next.length; i += 2) {
      rows.push(next.slice(i, i + 2).map(([, code, label]) => ({ text: label, callback_data: `o:${id}:${code}` })));
    }
  }
  const extra = [];
  if (order.payment_method === 'cod' && Number(order.deposit_amount) > 0 && order.payment_status === 'pending') {
    extra.push({ text: '💰 Đã nhận cọc', callback_data: `o:${id}:dp` });
  } else if (order.payment_status !== 'paid') {
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
    const notes = await opsNotes(order).catch(() => null);
    const msg = await notify.telegram(messageText(order, items, notes).replace('🧧 <b>ĐƠN ', '🧧 <b>ĐƠN MỚI '), null, {
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
      text: messageText(order, items, await opsNotes(order).catch(() => null)),
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

/**
 * Trong chủ đề ảnh giao hàng (/chonanh): ảnh kèm mã đơn — hoặc tin trả lời vào ảnh bằng mã đơn —
 * được coi như /anhgiao MÃĐƠN lời khen, shipper không cần gõ lệnh.
 */
async function asPhotoCommand(msg) {
  const text = String(msg.caption || msg.text || '').trim();
  if (text.startsWith('/') || !msg.is_topic_message || !msg.message_thread_id) return msg;
  const thread = (await settings.all()).telegram_photo_thread;
  if (!thread || String(msg.message_thread_id) !== String(thread)) return msg;
  const hasPhoto = (msg.photo && msg.photo.length) || (msg.reply_to_message && msg.reply_to_message.photo);
  if (!hasPhoto) return msg;
  // Mã đơn, hoặc SĐT khách (shipper lớn tuổi dễ ghi SĐT hơn)
  const m = /LN\d{6}[A-Z2-9]{4}/i.exec(text) || require('./testimonials').PHONE_IN_TEXT.exec(text);
  if (!m) {
    // Ảnh không có mã/SĐT: nhắc shipper (chỉ nhắc với ảnh, không nhắc tin chữ)
    if (msg.photo) await reply(msg, '📸 Ảnh này chưa có <b>SĐT khách</b>. Trả lời (reply) vào ảnh bằng số điện thoại khách, vd <code>0912345678</code>.');
    return msg;
  }
  const key = /^LN/i.test(m[0]) ? m[0].toUpperCase() : m[0].replace(/\D/g, '').replace(/^84/, '0');
  const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { ...msg, caption: `/anhgiao ${key} ${rest}`.trim(), text: undefined };
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
  '',
  '🚚 <code>/giao</code> — danh sách giao hôm nay · <code>/giao mai</code> · <code>/giao 25/1</code>',
  '💵 <code>/thu</code> — tiền COD từng shipper đã thu hôm nay + đơn giao rồi chưa thu · <code>/thu 25/1</code>',
  '📸 <b>Ảnh giao hàng:</b> gửi <b>ảnh</b> kèm chú thích <code>/anhgiao MÃĐƠN lời khách khen</code> → lưu vào web, chờ duyệt.',
  '   Gõ <code>/chonanh</code> trong chủ đề ảnh giao hàng → ở đó chỉ cần gửi ảnh kèm <b>SĐT khách</b>, không cần gõ lệnh.',
].join('\n');

/** /thu [dd/mm] → đối soát COD: mỗi shipper đã thu bao nhiêu trong ngày + đơn đã giao mà chưa thu. */
async function codReport(args) {
  const { todayVN } = require('./format');
  let day = todayVN();
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(String(args || '').trim());
  if (m) day = `${todayVN().slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const from = new Date(`${day}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 86400000);
  const fm = require('./format').money;
  const got = await db('orders').where('cod_collected_at', '>=', from).andWhere('cod_collected_at', '<', to).select('code', 'cod_collected_by', 'cod_collected_amount');
  const by = new Map();
  for (const o of got) {
    const r = by.get(o.cod_collected_by) || { n: 0, sum: 0, codes: [] };
    r.n += 1;
    r.sum += Number(o.cod_collected_amount) || 0;
    r.codes.push(o.code);
    by.set(o.cod_collected_by, r);
  }
  const owe = (await db('orders').where({ payment_method: 'cod', status: 'completed' }).whereNot('payment_status', 'paid')).filter((o) => payment.codDue(o) > 0);
  const total = got.reduce((a, o) => a + (Number(o.cod_collected_amount) || 0), 0);
  const lines = [`💵 <b>TIỀN COD NGÀY ${day.slice(8)}/${day.slice(5, 7)}</b> · tổng ${fm(total)}`];
  if (!by.size) lines.push('Chưa ai thu tiền COD trong ngày.');
  for (const [name, r] of by) lines.push(`• <b>${e(name)}</b>: ${fm(r.sum)} (${r.n} đơn) — ${r.codes.map(e).join(', ')}`);
  if (owe.length) {
    lines.push('', `⚠️ <b>Đã giao nhưng CHƯA thu tiền (${owe.length})</b>`);
    for (const o of owe.slice(0, 20)) lines.push(`• ${e(o.code)} · ${e(o.customer_name)} · ${e(o.phone)} · còn ${fm(payment.codDue(o))}`);
  }
  return lines.join('\n');
}

/** /giao [mai | kia | dd/mm] → danh sách giao trong ngày cho shipper. */
async function deliveryList(args) {
  const { todayVN, money } = require('./format');
  const delivery = require('./delivery');
  const a = String(args || '').trim().toLowerCase();
  let day = todayVN();
  if (/^(mai|ngay mai|ngày mai)$/.test(a)) day = todayVN(1);
  else if (/^(kia|ngay kia|ngày kia)$/.test(a)) day = todayVN(2);
  else {
    const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(a);
    if (m) day = `${todayVN().slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const plan = await delivery.forDate(day);
  const head = `🚚 <b>GIAO NGÀY ${day.slice(8)}/${day.slice(5, 7)}</b> · ${plan.ready.length} đơn · ${plan.baskets} giỏ${plan.codTotal ? ` · thu COD ${money(plan.codTotal)}` : ''}`;
  if (!plan.ready.length && !plan.unpaid.length) return `${head}\nKhông có đơn nào.`;
  const lines = plan.ready.map((o, i) => {
    const t = delivery.shipTo(o);
    const cod = delivery.codDue(o);
    return [
      `<b>${i + 1}. ${e(o.code)}</b>${o.delivery_slot ? ` · ⏰ <b>${require('./format').slotLabel(o.delivery_slot)}</b>` : ''}${o.is_gift ? ' 🎁 tặng' : ''}${o.status !== 'new' ? ` · ${ORDER_STATUS[o.status]}` : ''}${o.shipper && o.status === 'shipping' ? ` · 🛵 ${e(o.shipper)}` : ''}`,
      `   ${e(t.name)} · ${e(t.phone)}`,
      `   📍 ${e(t.address)}`,
      `   ${o.items.map((x) => `${e(x.name)} ×${x.qty}`).join(', ')} · ${cod ? `<b>thu ${money(cod)}</b>` : 'đã thanh toán'}`,
    ].join('\n');
  });
  let text = head;
  let shown = 0;
  for (const l of lines) {
    if ((text + '\n\n' + l).length > 3500) break;
    text += '\n\n' + l;
    shown++;
  }
  if (shown < lines.length) text += `\n\n… và ${lines.length - shown} đơn nữa.`;
  if (plan.unpaid.length) text += `\n\n⚠️ ${plan.unpaid.length} đơn chuyển khoản <b>chưa thanh toán</b> — chưa giao: ${plan.unpaid.map((o) => e(o.code)).join(', ')}`;
  text += `\n\nXem / in phiếu: ${config.publicUrl}/admin/giao-hang?ngay=${day}`;
  return text;
}

async function reply(msg, html, extra = {}) {
  try {
    await notify.tgApi('sendMessage', {
      ...extra,
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
    if (!rows.length) return `Không tìm thấy sản phẩm "${e(query)}". Gõ <code>/ton</code> để xem tất cả mã.\n\n📸 Ảnh giao hàng: gửi <b>ảnh</b> kèm chú thích <code>/anhgiao MÃĐƠN lời khách khen</code>`;
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
  if (!['ton', 'nhap', 'giam', 'dat', 'kho', 'help', 'start', 'chondon', 'chonkho', 'chonanh', 'giao', 'thu'].includes(cmd)) return;

  // Chỉ nhận lệnh từ đúng nhóm/cuộc trò chuyện đã chọn trong admin
  const allowed = await notify.telegramChatId();
  if (String(msg.chat.id) !== String(allowed)) return;

  if (cmd === 'kho' || cmd === 'help' || cmd === 'start') return reply(msg, KHO_HELP);
  if (cmd === 'chondon' || cmd === 'chonkho' || cmd === 'chonanh') {
    if (!msg.is_topic_message || !msg.message_thread_id) {
      return reply(msg, 'Hãy bật <b>Chủ đề (Topics)</b> cho nhóm, tạo chủ đề rồi gõ lệnh này <b>bên trong</b> chủ đề đó.');
    }
    const key = { chondon: 'telegram_order_thread', chonkho: 'telegram_stock_thread', chonanh: 'telegram_photo_thread' }[cmd];
    await settings.save({ [key]: String(msg.message_thread_id) });
    return reply(msg, {
      chondon: '✅ Từ giờ <b>đơn hàng mới</b> và yêu cầu báo giá sẽ gửi vào chủ đề này.',
      chonkho: '✅ Từ giờ <b>cảnh báo kho</b> (sắp hết, hết hàng) sẽ gửi vào chủ đề này. Gõ <code>/ton</code> ở đây để xem tồn kho.',
      chonanh: '✅ Đây là chủ đề <b>ảnh giao hàng</b>. Shipper chỉ cần gửi <b>ảnh kèm số điện thoại khách</b> (vd <code>0912345678 khách khen giỏ đẹp</code>) → bot tự tìm đơn, lưu vào web chờ duyệt.\nQuên ghi số? Trả lời (reply) vào ảnh bằng SĐT khách.',
    }[cmd]);
  }
  if (cmd === 'ton') return reply(msg, await stockList(args));
  if (cmd === 'giao') return reply(msg, await deliveryList(args));
  if (cmd === 'thu') return reply(msg, await codReport(args));

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
      await settings.save({ telegram_chat_id: to, telegram_order_thread: '', telegram_stock_thread: '', telegram_photo_thread: '' });
      console.log(`[telegram] nhóm chuyển mã ${from} → ${to}, đã cập nhật`);
    }
    return;
  }
  if (update.message) {
    await rememberChat(update.message.chat);
    update = { ...update, message: await asPhotoCommand(update.message) };
    if (/^\/anhgiao/i.test(String(update.message.caption || update.message.text || ''))) {
      console.log(`[telegram] /anhgiao từ nhóm ${update.message.chat.id} · ảnh: ${update.message.photo ? 'có' : update.message.reply_to_message?.photo ? 'trả lời ảnh' : 'không'}`);
      if (String(update.message.chat.id) !== String(await notify.telegramChatId())) {
        return reply(update.message, 'Nhóm này chưa được chọn làm nơi nhận đơn (admin → Telegram).');
      }
      try {
        const text = await require('./testimonials').fromTelegram(update.message);
        // Ảnh giao của đơn chưa hoàn tất → kèm nút "Đã giao xong" để shipper bấm luôn
        const code = (/đơn <b>(LN\w+)<\/b>/.exec(text || '') || [])[1];
        const o = code ? await db('orders').where({ code }).first() : null;
        const markup = o && !['completed', 'cancelled'].includes(o.status)
          ? { reply_markup: { inline_keyboard: [[{ text: `🎉 Đánh dấu đơn ${o.code} đã giao xong`, callback_data: `o:${o.id}:d` }]] } }
          : {};
        if (text) await reply(update.message, text, markup);
      } catch (err) {
        console.error('[telegram] lưu ảnh giao lỗi:', err.message);
        await reply(update.message, `Chưa lưu được ảnh: ${notify.escapeTg(err.message)}`);
      }
      return;
    }
    if (String(update.message.text || '').startsWith('/')) return handleCommand(update.message);
    return;
  }
  if (update.my_chat_member) return rememberChat(update.my_chat_member.chat);
  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) return;

  const g = /^g:(\d+):d$/.exec(cb.data);
  if (g) {
    if (String(cb.message.chat.id) !== String(await notify.telegramChatId())) {
      return answer(cb, 'Cuộc trò chuyện này không có quyền xử lý.', true);
    }
    const r = await require('./callbacks').markDone(g[1], personName(cb.from));
    if (!r) return answer(cb, 'Không tìm thấy yêu cầu.', true);
    return answer(cb, r.before.status === 'done' ? 'Yêu cầu này đã được xử lý.' : 'Đã đánh dấu: đã gọi khách.');
  }

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
  if (action === 'r') {
    await refreshOrderMessage(id, { confirmRestore: true });
    return answer(cb, 'Bấm "Có, khôi phục" để xác nhận.');
  }
  if (action === 'back') {
    await refreshOrderMessage(id);
    return answer(cb, 'Đã giữ nguyên đơn.');
  }
  const o0 = data.order;
  const codLeft = payment.codDue(o0);
  // Giao xong đơn COD còn tiền thu → hỏi đã thu tiền chưa (để đối soát tiền shipper giữ)
  if (action === 'd' && o0.payment_method === 'cod' && codLeft > 0 && o0.status !== 'completed') {
    await refreshOrderMessage(id, { confirmDone: true });
    return answer(cb, `Đã thu ${require('./format').money(codLeft)} của khách chưa?`);
  }
  if (action === 'f') {
    await refreshOrderMessage(id, { failReasons: true });
    return answer(cb, 'Chọn lý do giao không được.');
  }
  if (FAIL_REASONS[action]) {
    if (o0.status !== 'shipping') return answer(cb, 'Đơn không ở trạng thái đang giao.', true);
    await updateOrder(id, { status: 'confirmed' }, { by: `${by} (Telegram) · Giao không được: ${FAIL_REASONS[action]}` });
    await db('orders').where({ id: o0.id }).update({ shipper: null });
    await refreshOrderMessage(id);
    await notify.tgApi('sendMessage', {
      chat_id: cb.message.chat.id, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_to_message_id: cb.message.message_id, allow_sending_without_reply: true,
      ...(cb.message.message_thread_id ? { message_thread_id: cb.message.message_thread_id } : {}),
      text: `⚠️ <b>Đơn ${e(o0.code)} giao không được</b> — ${FAIL_REASONS[action]} (${e(by)}).\nNgười xử lý: gọi lại khách ${e(o0.is_gift ? o0.recipient_phone : o0.phone)}, hẹn lại ngày giao trong admin rồi bấm "Nhận đi giao" khi giao lại.`,
    }).catch((err) => console.error('[telegram] báo giao lỗi thất bại:', err.message));
    return answer(cb, 'Đã báo nhóm: giao không được. Đơn quay về "Đã xác nhận".');
  }

  let changes = null;
  if (ACTIONS[action]) changes = { status: ACTIONS[action] };
  else if (action === 'xx') changes = { status: 'cancelled' };
  else if (action === 'rr') changes = { status: 'confirmed' };
  else if (action === '$') changes = { payment_status: 'paid' };
  else if (action === 'dc') changes = { status: 'completed', payment_status: 'paid' };
  else if (action === 'dn') changes = { status: 'completed' };
  else if (action === 'dp') changes = { payment_status: 'deposit' };
  if (!changes) return answer(cb, 'Lệnh không hợp lệ.');

  const r = await updateOrder(id, changes, { by: `${by} (Telegram)${action === 'dn' ? ' · CHƯA thu tiền' : ''}` });
  // Ai đi giao / ai thu tiền COD → để cuối ngày đối soát (/thu)
  if (r && r.changed && action === 's') await db('orders').where({ id: o0.id }).update({ shipper: by });
  if (r && r.changed && o0.payment_method === 'cod' && codLeft > 0 && (action === 'dc' || action === '$')) {
    await db('orders').where({ id: o0.id }).update({ cod_collected_by: by, cod_collected_amount: codLeft, cod_collected_at: new Date() });
  }
  await refreshOrderMessage(id);
  if (action === 'dn') return answer(cb, `Đã giao xong. Nhớ thu ${require('./format').money(codLeft)} — đơn sẽ hiện trong /thu mục "chưa thu".`, true);
  const label = changes.status ? ORDER_STATUS[changes.status] : PAYMENT_STATUS[changes.payment_status];
  if (r && r.changed && changes.status === 'cancelled' && r.order.payment_status === 'paid') {
    return answer(cb, `Đã hủy đơn ${r.order.code}. Đơn đã thanh toán — nhớ hoàn tiền cho khách.`, true);
  }
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
      { command: 'giao', description: 'Danh sách giao hôm nay (gõ: /giao mai, /giao 25/1)' },
      { command: 'thu', description: 'Tiền COD shipper đã thu hôm nay + đơn chưa thu' },
      { command: 'ton', description: 'Xem tồn kho (thêm mã/tên để xem 1 sản phẩm)' },
      { command: 'nhap', description: 'Nhập thêm hàng: /nhap LL001 20' },
      { command: 'giam', description: 'Trừ hàng: /giam LL001 2' },
      { command: 'dat', description: 'Đặt lại tồn kho: /dat LL001 45' },
      { command: 'kho', description: 'Hướng dẫn lệnh kho' },
      { command: 'chondon', description: 'Chọn chủ đề này để nhận đơn hàng mới' },
      { command: 'chonkho', description: 'Chọn chủ đề này để nhận cảnh báo kho' },
      { command: 'chonanh', description: 'Chọn chủ đề này để shipper gửi ảnh giao hàng' },
    ],
  }).catch((err) => console.error('[telegram] không đặt được menu lệnh:', err.message));
  return { ok: true, url };
}

module.exports = {
  sendNewOrder, refreshOrderMessage, handleUpdate, ensureWebhook, webhookSecret, messageText, keyboard, stockAlertsAfterOrder, opsNotes,
};
