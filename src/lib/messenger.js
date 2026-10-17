/**
 * AI tư vấn trên Fanpage (Facebook Messenger).
 * Khách nhắn Fanpage → Facebook gọi webhook → cùng "bộ não" AI như trên web (ai-sales.js) trả lời.
 * Khi khách chốt, AI gửi nút "Kiểm tra & đặt hàng" mở trang thanh toán đã điền sẵn → khách bấm Đặt hàng
 * → đơn vào đúng phễu web (QR, cọc, Telegram, trừ kho).
 * Người thật trả lời trong hộp thư Fanpage → AI tự im với khách đó vài giờ (không tranh lời).
 *
 * Cần trên Render (Environment): FB_PAGE_TOKEN, FB_APP_SECRET, FB_VERIFY_TOKEN.
 */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const settings = require('./settings');
const ai = require('./ai-sales');

const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v23.0'}`;
const AI_TAG = 'lunar-ai'; // gắn vào tin AI gửi → phân biệt với tin người thật trả lời trong hộp thư
const HANDOFF_HOURS = 72; // link đặt hàng gửi qua Messenger còn dùng được trong 3 ngày

const env = () => ({ token: process.env.FB_PAGE_TOKEN || '', secret: process.env.FB_APP_SECRET || '', verify: process.env.FB_VERIFY_TOKEN || '' });
const configured = () => !!(env().token && env().secret);
const enabled = (s) => configured() && String(s.messenger_ai_enabled) !== '0';

// Nhận ra tin do chính AI gửi khi Facebook gửi bản sao (echo) về: theo mã tin, mã ứng dụng, thời điểm vừa gửi
const ours = { mids: new Set(), appId: '', lastSend: new Map(), lastIncoming: new Map() };
function rememberSent(body, res) {
  const psid = (body && body.recipient && body.recipient.id) || (res && res.recipient_id);
  if (psid && body.message) ours.lastSend.set(psid, Date.now());
  if (res && res.message_id) {
    ours.mids.add(res.message_id);
    if (ours.mids.size > 2000) ours.mids.delete(ours.mids.values().next().value);
  }
}
function isOurEcho(ev) {
  const msg = ev.message || {};
  if (msg.metadata === AI_TAG) {
    if (msg.app_id) ours.appId = String(msg.app_id);
    return true;
  }
  if (msg.mid && ours.mids.has(msg.mid)) return true;
  if (ours.appId && msg.app_id && String(msg.app_id) === ours.appId) return true;
  const psid = ev.recipient && ev.recipient.id;
  if (Date.now() - (ours.lastSend.get(psid) || 0) < 30000) return true; // AI vừa gửi cho khách này trong 30 giây
  // Tin tự động của Fanpage (phản hồi tức thì, tin chào) đến ngay sau tin khách — người thật không gõ kịp
  const t = Number(ev.timestamp) || Date.now();
  return t - (ours.lastIncoming.get(psid) || 0) < 15000;
}

let lastSendError = ''; // lý do Facebook từ chối lần gửi gần nhất (vd quá 24 giờ) → báo lại nhân viên trên Telegram
let send = async (body) => {
  const r = await fetch(`${GRAPH}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env().token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('[messenger] gửi lỗi', r.status, t.slice(0, 300));
    lastSendError = t.slice(0, 500);
    return false;
  }
  lastSendError = '';
  const j = await r.json().catch(() => null);
  rememberSent(body, j);
  return j || true;
};

/** Facebook ký mỗi lần gọi webhook bằng App Secret → chặn ai đó giả danh Facebook. */
function verifySignature(rawBody, header) {
  const { secret } = env();
  if (!secret || !rawBody || !/^sha256=[a-f0-9]{64}$/.test(String(header || ''))) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Bước Facebook kiểm tra webhook khi cài đặt (GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...). */
function verifyChallenge(q) {
  const { verify } = env();
  if (verify && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verify) return String(q['hub.challenge'] || '');
  return null;
}

// Messenger không hiện **đậm** hay link tương đối → đổi sang chữ thường + link đầy đủ
function plain(text) {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (m, label, path) => `${label}: ${config.siteUrl}${path}`)
    .replace(/(^|[\s(])(\/san-pham\/[\w-]+)/g, (m, pre, path) => `${pre}${config.siteUrl}${path}`)
    .replace(/^#+\s*/gm, '')
    .trim();
}

function chunks(text, n = 1900) {
  const out = [];
  let rest = text;
  while (rest.length > n) {
    let cut = rest.lastIndexOf('\n', n);
    if (cut < n / 2) cut = rest.lastIndexOf(' ', n);
    if (cut < n / 2) cut = n;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function sendText(psid, text) {
  for (const part of chunks(plain(text))) {
    await send({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: part, metadata: AI_TAG } });
  }
}

const typing = (psid) => send({ recipient: { id: psid }, sender_action: 'typing_on' }).catch(() => {});
let pauseMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Câu trả lời của AI: mỗi đoạn (cách nhau dòng trống) là một tin, giữa các tin hiện "đang soạn tin" như người gõ. */
async function sendChat(psid, text) {
  let parts = plain(text).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 3) parts = [...parts.slice(0, 2), parts.slice(2).join('\n')];
  for (let i = 0; i < parts.length; i++) {
    if (i) {
      await typing(psid);
      await pauseMs(Math.min(2500, 600 + parts[i].length * 25));
    }
    await sendText(psid, parts[i]);
  }
}

// Tên trên Facebook (first_name/last_name). Facebook không cho biết giới tính → AI tự nhận theo tên.
let fetchProfile = async (psid) => {
  const r = await fetch(`${GRAPH}/${encodeURIComponent(psid)}?fields=first_name,last_name`, {
    headers: { Authorization: `Bearer ${env().token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('[messenger] Facebook không cho lấy tên khách:', r.status, t.slice(0, 300));
    return null;
  }
  const p = await r.json();
  return { first: String(p.first_name || '').trim(), last: String(p.last_name || '').trim() };
};

/** Họ tên khách theo thứ tự tiếng Việt (họ trước, tên sau). '' nếu không lấy được. */
const nameFail = new Map(); // lấy tên lỗi → 6 giờ sau mới thử lại (không gọi Facebook mỗi tin)
async function customerName(psid, row) {
  if (row && row.name) return row.name;
  if (Date.now() - (nameFail.get(psid) || 0) < 6 * 3600000) return '';
  let name = '';
  try {
    const p = await fetchProfile(psid);
    if (p) name = [p.last, p.first].filter(Boolean).join(' ').slice(0, 120);
  } catch (err) {
    console.error('[messenger] không lấy được tên khách:', err.message);
  }
  if (name) await saveThread(psid, { name });
  else nameFail.set(psid, Date.now());
  return name;
}

async function thread(psid) {
  const row = await db('messenger_threads').where({ psid }).first();
  let history = [];
  try { history = row && row.history ? JSON.parse(row.history) : []; } catch { history = []; }
  return { row, history: Array.isArray(history) ? history : [] };
}

async function saveThread(psid, patch) {
  const data = { ...patch, updated_ms: Date.now() };
  const n = await db('messenger_threads').where({ psid }).update(data);
  if (!n) await db('messenger_threads').insert({ psid, history: '[]', paused_until_ms: 0, ...data });
}

/** Ghi 1 dòng vào sổ tay của cuộc trò chuyện (tin người thật / tin khách lúc AI tạm dừng). */
async function addNote(psid, line) {
  const row = await db('messenger_threads').where({ psid }).first();
  let notes = [];
  try { notes = row && row.notes ? JSON.parse(row.notes) : []; } catch { notes = []; }
  notes.push(String(line).replace(/\s+/g, ' ').slice(0, 300));
  await saveThread(psid, { notes: JSON.stringify(notes.slice(-20)) });
}

/** Đếm tin của khách trong ngày (giờ VN); trả về số tin hôm nay sau khi cộng. */
async function countToday(psid, row) {
  const today = require('./format').todayVN();
  const n = row && row.day_key === today ? Number(row.day_count) + 1 : 1;
  await saveThread(psid, { day_key: today, day_count: n });
  return n;
}

async function pause(psid, hours) {
  await saveThread(psid, { paused_until_ms: Date.now() + hours * 3600000 });
}

/** Lưu giỏ + thông tin điền sẵn → link ngắn mở trang thanh toán trên web. */
// Lịch sử trò chuyện quá 90 ngày không nhắn → tự xóa (đúng như chính sách bảo mật)
async function purgeOld() {
  await db('messenger_threads').where('updated_ms', '<', Date.now() - 90 * 86400000).del().catch(() => {});
  await db('conv_log').where('created_ms', '<', Date.now() - 90 * 86400000).del().catch(() => {});
  await db('tg_fb_links').where('created_ms', '<', Date.now() - 14 * 86400000).del().catch(() => {});
}

async function createHandoff(session, psid) {
  const token = crypto.randomBytes(16).toString('base64url');
  await db('ai_handoffs').insert({
    token,
    data: JSON.stringify({ cart: session.cart, prefill: { ...session.aiPrefill, source: 'ai_fb', psid } }),
    expires_ms: Date.now() + HANDOFF_HOURS * 3600000,
    psid: psid || null,
    created_ms: Date.now(),
  });
  await db('ai_handoffs').where('expires_ms', '<', Date.now()).del().catch(() => {});
  return `${config.siteUrl}/tu-van/don/${token}`;
}

/**
 * (chạy mỗi phút) Khách Fanpage đã chốt với AI (nhận link "Kiểm tra & đặt hàng") mà sau 2 giờ vẫn chưa đặt
 * → báo chủ đề TƯ VẤN KHÁCH để gọi lại: đây là khách nóng nhất. Mỗi khách báo 1 lần.
 */
async function followUpAbandoned({ afterMs = 2 * 3600000 } = {}) {
  const now = Date.now();
  const rows = await db('ai_handoffs').where({ followed: false }).whereNotNull('psid')
    .andWhere('created_ms', '<', now - afterMs).andWhere('created_ms', '>', now - 48 * 3600000)
    .orderBy('created_ms', 'desc');
  const seen = new Set();
  let sentCount = 0;
  for (const h of rows) {
    if (seen.has(h.psid)) continue;
    seen.add(h.psid);
    await db('ai_handoffs').where({ psid: h.psid, followed: false }).update({ followed: true });
    const ordered = await db('orders').where({ messenger_psid: h.psid }).andWhere('created_at', '>=', new Date(Number(h.created_ms) - 60000)).first();
    if (ordered) continue;
    let data = {};
    try { data = JSON.parse(h.data) || {}; } catch { data = {}; }
    const p = data.prefill || {};
    const lines = (data.cart && data.cart.lines) || [];
    const prods = lines.length ? await db('products').whereIn('id', lines.map((l) => l.productId)).select('id', 'name') : [];
    const nameOf = Object.fromEntries(prods.map((x) => [x.id, x.name]));
    const e = require('./notify').escapeTg;
    const { money } = require('./format');
    const items = lines.map((l) => `${nameOf[l.productId] || 'giỏ #' + l.productId} × ${l.qty}`).join(', ');
    const { links } = await inboxLinks(h.psid, await db('messenger_threads').where({ psid: h.psid }).first());
    const tg = await require('./notify').telegram([
      '🔥 <b>KHÁCH FANPAGE ĐÃ CHỐT NHƯNG CHƯA ĐẶT</b> (quá 2 giờ)',
      `👤 ${e(p.customer_name || 'Khách')}${p.phone ? ` · 📞 ${e(p.phone)}` : ''}`,
      items ? `🎁 ${e(items)}` : null,
      p.delivery_date ? `📅 Muốn giao ${e(String(p.delivery_date).split('-').reverse().join('/'))}${p.province ? ` · ${e(p.province)}` : ''}` : null,
      p.payment_method ? `💳 ${p.payment_method === 'cod' ? 'COD' : 'Chuyển khoản'}` : null,
      '👉 Gọi hoặc nhắn khách trong hộp thư Fanpage để chốt đơn (có thể đặt hộ trên web).',
      REPLY_HINT,
    ].filter(Boolean).join('\n'), null, { topic: 'consult', reply_markup: tgKeyboard(h.psid, links) }).catch(() => false);
    await linkTg(tg, h.psid);
    sentCount += 1;
  }
  return sentCount;
}

async function loadHandoff(token) {
  if (!/^[\w-]{10,40}$/.test(String(token || ''))) return null;
  const row = await db('ai_handoffs').where({ token }).first();
  if (!row || Number(row.expires_ms) < Date.now()) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

const HUMAN = /(gặp|nói chuyện|chat|nối máy|chuyển).{0,12}(người thật|nhân viên|tư vấn viên|chủ shop|admin)|(người thật|nhân viên) (tư vấn|trả lời)/i;

/** Báo chủ đề TƯ VẤN KHÁCH: khách nào (tên, giờ nhắn), cần gì → nhân viên tìm đúng người trong hộp thư Fanpage. */
let pageId = process.env.FB_PAGE_ID || ''; // lấy từ webhook (entry.id) nếu chưa cài

/**
 * Link mở thẳng cuộc trò chuyện của khách (bấm từ Telegram → đúng người, không phải lật tìm trong hộp thư).
 * Thử hỏi Facebook link + tên người nhắn (danh sách hội thoại của trang); luôn kèm link Business Suite theo mã khách.
 */
let fetchConversation = async (psid) => {
  const r = await fetch(`${GRAPH}/me/conversations?platform=messenger&user_id=${encodeURIComponent(psid)}&fields=link,participants`, {
    headers: { Authorization: `Bearer ${env().token}` }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    console.error('[messenger] không lấy được cuộc trò chuyện:', r.status, (await r.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const c = ((await r.json()).data || [])[0];
  if (!c) return null;
  const who = ((c.participants && c.participants.data) || []).find((p) => String(p.id) === String(psid));
  return { link: c.link ? (String(c.link).startsWith('http') ? c.link : `https://www.facebook.com${c.link}`) : '', name: who && who.name ? String(who.name) : '' };
};

async function inboxLinks(psid, row) {
  const links = [];
  if (pageId) links.push({ text: '💻 Máy tính: Business Suite', url: `https://business.facebook.com/latest/inbox/all/?asset_id=${pageId}&selected_item_id=${encodeURIComponent(psid)}&thread_type=FB_MESSAGE` });
  let name = (row && row.name) || '';
  if (configured()) {
    const c = await fetchConversation(psid).catch(() => null);
    if (c && c.link) links.push({ text: '💻 Máy tính: Facebook', url: c.link });
    if (c && c.name && !name) {
      name = c.name;
      await saveThread(psid, { name });
    }
  }
  return { links, name };
}

/** Lưu tên khách tự giới thiệu (AI ghi lại khi chuyển người thật / lên đơn) nếu chưa có tên. */
async function rememberName(psid, row, name) {
  const n = String(name || '').trim().slice(0, 120);
  if (n && !(row && row.name)) await saveThread(psid, { name: n });
  return n;
}

async function alertHuman(psid, row, { title, summary, last, pauseHours }) {
  const e = require('./notify').escapeTg;
  const fresh = (await db('messenger_threads').where({ psid }).first()) || row;
  const { links, name } = await inboxLinks(psid, fresh);
  const at = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date());
  const tg = await require('./notify').telegram([
    `💬 <b>${e(title)}</b>`,
    `👤 ${name ? e(name) : 'Khách Fanpage (chưa rõ tên)'} · nhắn lúc ${at}`,
    summary ? `📝 ${e(summary)}` : null,
    last ? `💭 Tin cuối: “${e(String(last).slice(0, 200))}”` : null,
    REPLY_HINT,
    `⏸ AI tạm dừng với khách này ${pauseHours} giờ. Tin khách nhắn tiếp sẽ hiện ở đây. Xong việc bấm "▶️ Bật lại AI".`,
  ].filter(Boolean).join('\n'), null, { topic: 'consult', reply_markup: tgKeyboard(psid, links) }).catch(() => false);
  await linkTg(tg, psid);
  await saveThread(psid, { relay_until_ms: Date.now() + pauseHours * 3600000 });
}

// ——— Trả lời khách Fanpage ngay trong Telegram ———
const STAFF_TAG = 'lunar-staff';
const REPLY_HINT = '📱 Bấm <b>✍️ Trả lời khách</b> (hoặc reply tin này) để nhắn khách ngay trong Telegram — chữ hoặc ảnh.';

/** Nút dưới mỗi tin khách Fanpage trên Telegram: trả lời / xem tin gần đây / bật lại AI (dùng tốt trên điện thoại) + link mở trên máy tính. */
function tgKeyboard(psid, links = []) {
  const id = String(psid);
  const rows = [
    [{ text: '✍️ Trả lời khách', callback_data: `fb:r:${id}` }],
    [{ text: '📜 Xem tin gần đây', callback_data: `fb:h:${id}` }, { text: '▶️ Bật lại AI', callback_data: `fb:a:${id}` }],
  ];
  if (links.length) rows.push(links);
  return { inline_keyboard: rows };
}

/** Bấm nút fb:* trên Telegram. Trả về chuỗi để hiện thông báo nhỏ (answerCallbackQuery). */
async function handleTgCallback(cb) {
  const m = /^fb:([rha]):(.{1,60})$/.exec(String(cb.data || ''));
  if (!m) return 'Lệnh không hợp lệ.';
  const [, act, psid] = m;
  const row = await db('messenger_threads').where({ psid }).first();
  if (!row) return 'Không tìm thấy cuộc trò chuyện này (có thể đã quá 90 ngày).';
  const e = require('./notify').escapeTg;
  const name = row.name || 'khách';
  const chat = cb.message.chat.id;
  const thread = cb.message.is_topic_message && cb.message.message_thread_id ? { message_thread_id: cb.message.message_thread_id } : {};
  if (act === 'r') {
    const who = cb.from ? `<a href="tg://user?id=${cb.from.id}">${e(cb.from.first_name || 'Bạn')}</a>` : 'Bạn';
    const sent = await require('./notify').tgApi('sendMessage', {
      chat_id: chat, ...thread, parse_mode: 'HTML',
      text: `✍️ ${who} gõ tin gửi <b>${e(name)}</b> rồi bấm Gửi (gửi ảnh cũng được):`,
      reply_to_message_id: cb.message.message_id, allow_sending_without_reply: true,
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: `Tin nhắn cho ${name}`.slice(0, 64) },
    });
    await linkTg(sent, psid);
    return 'Gõ tin nhắn ở ô bên dưới rồi bấm Gửi.';
  }
  if (act === 'h') {
    const rows = await db('conv_log').where({ psid }).whereIn('role', ['customer', 'ai', 'staff']).orderBy('id', 'desc').limit(10);
    if (!rows.length) return 'Chưa có tin nào được lưu.';
    const label = { customer: `👤 ${e(name)}`, ai: '🤖 AI', staff: '👩‍💼 Nhân viên' };
    const text = rows.reverse().map((r) => `${label[r.role]}: ${e(String(r.text).slice(0, 300))}`).join('\n');
    const sent = await require('./notify').tgApi('sendMessage', {
      chat_id: chat, ...thread, parse_mode: 'HTML', disable_web_page_preview: true,
      text: `📜 <b>10 tin gần nhất với ${e(name)}</b>\n${text}`.slice(0, 4000),
      reply_markup: { inline_keyboard: [[{ text: '✍️ Trả lời khách', callback_data: `fb:r:${psid}` }]] },
    });
    await linkTg(sent, psid);
    return '';
  }
  // act === 'a': nhân viên xong việc → AI trả lời khách trở lại
  await saveThread(psid, { paused_until_ms: 0, relay_until_ms: 0 });
  await require('./notify').tgApi('sendMessage', {
    chat_id: chat, ...thread, parse_mode: 'HTML',
    text: `▶️ AI đã trả lời lại <b>${e(name)}</b> (bật bởi ${e((cb.from && cb.from.first_name) || 'nhân viên')}). Tin khách sẽ không hiện ở đây nữa.`,
  }).catch(() => {});
  return 'Đã bật lại AI cho khách này.';
}

/** Ghi nhớ: tin Telegram này thuộc khách Fanpage nào. */
async function linkTg(tgMsg, psid) {
  if (!tgMsg || !tgMsg.message_id || !tgMsg.chat || !psid) return;
  await db('tg_fb_links').insert({ chat_id: String(tgMsg.chat.id), message_id: tgMsg.message_id, psid: String(psid), created_ms: Date.now() }).catch(() => {});
}

/** Khách nhắn (hoặc nhân viên trả lời trong hộp thư) lúc AI đang tạm dừng → chuyển về chủ đề TƯ VẤN KHÁCH. */
async function relayToTelegram(psid, row, { who, text, attachments }) {
  const e = require('./notify').escapeTg;
  const pics = (attachments || []).filter((a) => a && a.payload && a.payload.url)
    .map((a, i) => `<a href="${e(a.payload.url)}">${a.type === 'image' ? '📷 Ảnh' : '📎 Tệp'} ${i + 1}</a>`);
  if (!text && !pics.length) return;
  const name = (await customerName(psid, row).catch(() => '')) || 'Khách Fanpage';
  const head = who === 'staff' ? `👩‍💼 <b>Nhân viên (hộp thư)</b> → ${e(name)}` : `💬 <b>${e(name)}</b>`;
  const tg = await require('./notify').telegram([
    `${head}: ${text ? e(String(text).slice(0, 1500)) : ''}`,
    pics.length ? pics.join(' · ') : null,
  ].filter(Boolean).join('\n'), null, { topic: 'consult', ...(who === 'staff' ? {} : { reply_markup: tgKeyboard(psid) }) }).catch(() => false);
  await linkTg(tg, psid);
}

// Gửi ảnh nhân viên chọn trong Telegram: tải từ Telegram → đưa lên Facebook → nhận mã ảnh
let uploadImage = async (buf, mime) => {
  const fd = new FormData();
  fd.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: false } } }));
  fd.append('filedata', new Blob([buf], { type: mime || 'image/jpeg' }), 'anh.jpg');
  const r = await fetch(`${GRAPH}/me/message_attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${env().token}` }, body: fd, signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.attachment_id) throw new Error((j.error && j.error.message) || `Facebook trả lỗi ${r.status}`);
  return j.attachment_id;
};
let downloadTgPhoto = async (photo) => {
  const best = photo[photo.length - 1];
  const file = await require('./notify').tgApi('getFile', { file_id: best.file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Không tải được ảnh từ Telegram');
  return Buffer.from(await r.arrayBuffer());
};

const WINDOW = /2018278|2018065|outside of allowed window|24.?h/i;
/** Gửi 1 tin cho khách; quá 24 giờ thì thử nhãn "nhân viên hỗ trợ" (Facebook cho 7 ngày nếu trang được duyệt quyền này). */
async function staffSend(psid, message) {
  const base = { recipient: { id: psid }, message: { ...message, metadata: STAFF_TAG } };
  if (await send({ ...base, messaging_type: 'RESPONSE' })) return { ok: true };
  if (WINDOW.test(lastSendError) && await send({ ...base, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })) return { ok: true };
  return { ok: false, window: WINDOW.test(lastSendError), error: lastSendError };
}

/**
 * Nhân viên trả lời (reply) tin khách Fanpage trong nhóm Telegram → gửi cho khách qua Messenger, AI tạm dừng.
 * Trả về null nếu tin được trả lời không phải tin khách Fanpage (để bot xử lý như bình thường).
 */
async function replyFromTelegram(msg) {
  const r = msg && msg.reply_to_message;
  if (!r) return null;
  const link = await db('tg_fb_links').where({ chat_id: String(msg.chat.id), message_id: r.message_id }).orderBy('id', 'desc').first();
  if (!link) return null;
  const psid = link.psid;
  const row = await db('messenger_threads').where({ psid }).first();
  const name = (row && row.name) || 'khách';
  if (!configured()) return { ok: false, name, why: 'Máy chủ chưa cài FB_PAGE_TOKEN nên chưa nhắn được cho khách.' };
  const text = String(msg.text || msg.caption || '').trim();
  if (!text && !msg.photo) return { ok: false, name, why: 'Hiện chỉ gửi được chữ hoặc ảnh cho khách.' };

  let res = { ok: true };
  if (msg.photo) {
    try {
      const id = await uploadImage(await downloadTgPhoto(msg.photo), 'image/jpeg');
      res = await staffSend(psid, { attachment: { type: 'image', payload: { attachment_id: id } } });
    } catch (err) {
      console.error('[messenger] gửi ảnh từ Telegram lỗi:', err.message);
      res = { ok: false, error: err.message };
    }
  }
  if (res.ok && text) {
    for (const part of chunks(text)) {
      res = await staffSend(psid, { text: part });
      if (!res.ok) break;
    }
  }
  if (!res.ok) {
    return { ok: false, name, why: res.window
      ? 'Khách nhắn lần cuối đã quá 24 giờ nên Facebook không cho trang nhắn tiếp. Hãy gọi điện cho khách, hoặc chờ khách nhắn lại.'
      : `Facebook chưa nhận tin: ${String(res.error || 'lỗi không rõ').slice(0, 200)}` };
  }
  const s = await settings.all();
  const pauseHours = Math.max(1, Number(s.messenger_pause_hours) || 12);
  const until = Date.now() + pauseHours * 3600000;
  await saveThread(psid, { paused_until_ms: until, relay_until_ms: until });
  const noted = `${msg.photo ? '[gửi ảnh] ' : ''}${text}`.trim();
  await addNote(psid, `Nhân viên: ${noted}`);
  await require('./ai-learn').log(psid, 'staff', noted);
  console.log(`[messenger] nhân viên trả lời khách …${String(psid).slice(-4)} từ Telegram → AI tạm dừng ${pauseHours} giờ`);
  return { ok: true, name, pauseHours };
}

/** Xử lý 1 sự kiện Messenger (tin khách, bấm nút, hoặc tin người thật trả lời từ hộp thư). */
async function handleEvent(ev) {
  const s = await settings.all();
  const pauseHours = Math.max(1, Number(s.messenger_pause_hours) || 12);

  // Tin do Fanpage gửi đi (echo): không phải AI gửi → người thật đang trả lời → AI tạm im với khách này
  if (ev.message && ev.message.is_echo) {
    if (!isOurEcho(ev) && ev.recipient && ev.recipient.id) {
      console.log(`[messenger] người thật trả lời khách …${String(ev.recipient.id).slice(-4)} → AI tạm dừng ${pauseHours} giờ`);
      await pause(ev.recipient.id, pauseHours);
      if (ev.message.text) await addNote(ev.recipient.id, `Nhân viên: ${ev.message.text}`);
      await require('./ai-learn').log(ev.recipient.id, 'staff', ev.message.text);
      const row = await db('messenger_threads').where({ psid: ev.recipient.id }).first();
      if (row && Number(row.relay_until_ms) > Date.now()) {
        await relayToTelegram(ev.recipient.id, row, { who: 'staff', text: ev.message.text, attachments: ev.message.attachments });
      }
    }
    return 'echo';
  }
  const psid = ev.sender && ev.sender.id;
  if (!psid) return 'skip';
  ours.lastIncoming.set(psid, Number(ev.timestamp) || Date.now());
  // Khách đến từ quảng cáo "Gửi tin nhắn" → Facebook kèm mã quảng cáo → nhớ để tính đơn cho quảng cáo đó
  const ref = ev.referral || (ev.message && ev.message.referral) || (ev.postback && ev.postback.referral);
  if (ref && ref.ad_id && /^\d{5,30}$/.test(String(ref.ad_id))) await saveThread(psid, { ad_id: String(ref.ad_id) });
  if (ev.referral && !ev.message && !ev.postback) return 'referral'; // chỉ là sự kiện "khách bấm quảng cáo
  const text = String((ev.message && (ev.message.quick_reply ? ev.message.text || ev.message.quick_reply.payload : ev.message.text))
    || (ev.postback && (ev.postback.title || ev.postback.payload)) || '').trim();

  if (text) await require('./ai-learn').log(psid, 'customer', text);
  if (/^(xo[aá]|x[oó]a)\s*(d[uữ]\s*li[eệ]u|l[iị]ch\s*s[uử]|tin\s*nh[aắ]n)/i.test(text) && configured()) {
    await db('messenger_threads').where({ psid }).del();
    await db('conv_log').where({ psid }).del();
    await sendText(psid, 'Dạ em đã xóa toàn bộ lịch sử trò chuyện của anh/chị với Lunar Lucky rồi ạ. Cần gì anh/chị cứ nhắn em nhé!');
    return 'deleted';
  }

  const { row, history } = await thread(psid);
  if (row && Number(row.paused_until_ms) > Date.now()) { // người thật đang tư vấn → AI im, nhưng ghi lại để nói tiếp cho khớp
    if (text) await addNote(psid, `Khách: ${text}`);
    if (Number(row.relay_until_ms) > Date.now() && !(ev.message && ev.message.sticker_id)) {
      await relayToTelegram(psid, row, { who: 'customer', text, attachments: ev.message && ev.message.attachments });
    }
    return 'paused';
  }
  if (!enabled(s)) return 'off';

  if (!text) {
    // Sticker "like" → bỏ qua; ảnh/tệp → nhờ khách gõ chữ
    if (ev.message && ev.message.sticker_id) return 'sticker';
    if (ev.message && ev.message.attachments) {
      await sendText(psid, 'Dạ em nhận được rồi ạ. Anh/chị nhắn thêm giúp em là tặng ai, tầm bao nhiêu tiền một giỏ để em chọn mẫu cho hợp nha. Cần bên em xem kỹ ảnh thì anh/chị nhắn "gặp nhân viên" ạ.');
      return 'attachment';
    }
    return 'skip';
  }

  if (HUMAN.test(text)) {
    await pause(psid, pauseHours);
    await sendText(psid, `Dạ em đã báo chuyên viên Lunar Lucky, anh/chị đợi một chút sẽ có người trả lời ngay tại đây ạ. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} nhé!`);
    await alertHuman(psid, row, { title: 'Khách Fanpage cần gặp người thật', last: text, pauseHours });
    return 'human';
  }

  // Chặn spam: quá số tin/ngày → nhờ người thật, AI tạm dừng với khách này
  const cap = Math.max(10, Number(s.messenger_daily_cap) || 60);
  if ((await countToday(psid, row)) > cap) {
    await pause(psid, pauseHours);
    await sendText(psid, `Dạ hôm nay anh/chị đã nhắn khá nhiều, em chuyển chuyên viên Lunar Lucky trả lời trực tiếp tại đây ạ. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} nhé!`);
    await alertHuman(psid, row, { title: `Khách Fanpage nhắn quá ${cap} tin hôm nay`, last: text, pauseHours });
    return 'cap';
  }

  // Trong lúc AI tạm dừng, nhân viên/khách đã nhắn gì → đưa cho AI biết để nói tiếp không mâu thuẫn
  let context = '';
  const fresh = await db('messenger_threads').where({ psid }).first();
  try {
    const notes = fresh && fresh.notes ? JSON.parse(fresh.notes) : [];
    if (notes.length) context = `[Ghi chú hệ thống: trong lúc em tạm dừng, nhân viên Lunar Lucky đã nhắn trực tiếp với khách:\n${notes.join('\n')}\nGiữ đúng những gì nhân viên đã báo/hứa (giá, món, ngày giao…), không nói ngược lại; không nhắc tới ghi chú này.]\nTin mới của khách:`;
  } catch { context = ''; }

  typing(psid);
  let session = { aiChat: history };
  const name = await customerName(psid, row);
  let r = await ai.chat({ session }, text, { channel: 'messenger', customerName: name, context });
  if (r.full) { // cuộc trò chuyện quá dài → bắt đầu lại, giữ trải nghiệm liền mạch trên Messenger
    session = { aiChat: [] };
    r = await ai.chat({ session }, text, { channel: 'messenger', customerName: name, context });
  }
  await saveThread(psid, { history: JSON.stringify(session.aiChat || []), ...(context && !r.error ? { notes: null } : {}) });
  if (Math.random() < 0.02) purgeOld();
  // AI tắt / quá giới hạn ngày / lỗi: không đẩy khách sang Zalo — báo người thật trả lời tại Fanpage
  if (r.off) {
    await pause(psid, pauseHours);
    await sendText(psid, `Dạ em đã nhận tin, chuyên viên Lunar Lucky sẽ trả lời anh/chị ngay tại đây sớm nhất ạ. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} nhé!`);
    await alertHuman(psid, row, { title: 'AI đang tắt/hết lượt — khách Fanpage chờ người trả lời', last: text, pauseHours });
    return 'off';
  }
  if (r.error) {
    await sendText(psid, `Dạ em đang bị gián đoạn một chút, anh/chị gửi lại giúp em sau ít phút nhé. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} ạ!`);
    return 'error';
  }
  await sendChat(psid, r.reply);
  await require('./ai-learn').log(psid, 'ai', r.reply);
  // Tên khách tự giới thiệu (AI ghi lại) / tên trên đơn → các tin báo sau hiện tên
  await rememberName(psid, row, r.humanName || (session.aiPrefill && session.aiPrefill.customer_name));
  if (r.human) { // AI chuyển cho người thật (đổi món, in logo, khiếu nại…)
    await pause(psid, pauseHours);
    await alertHuman(psid, row, { title: 'AI chuyển khách Fanpage cho chuyên viên', summary: r.human, last: text, pauseHours });
  }
  if (r.human || r.callback) await require('./ai-learn').log(psid, 'event', 'human');
  if (r.action && session.cart && session.aiPrefill) {
    await require('./ai-learn').log(psid, 'event', 'order_button');
    const url = await createHandoff(session, psid);
    await send({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { metadata: AI_TAG, attachment: { type: 'template', payload: {
      template_type: 'button',
      text: 'Anh/chị bấm nút dưới để xem lại đơn và bấm "Đặt hàng" (đơn chỉ được tạo khi anh/chị bấm):',
      buttons: [{ type: 'web_url', url, title: 'Kiểm tra & đặt hàng' }],
    } } } });
  }
  return 'reply';
}

// Mỗi khách xử lý lần lượt từng tin (khách gõ 3 tin liền nhau → không trả lời lộn xộn)
const queues = new Map();
function enqueue(psid, job) {
  const prev = queues.get(psid) || Promise.resolve();
  const next = prev.then(job).catch((err) => console.error('[messenger] lỗi xử lý tin:', err.message));
  queues.set(psid, next);
  next.finally(() => { if (queues.get(psid) === next) queues.delete(psid); });
  return next;
}

/** Facebook gửi gộp nhiều sự kiện trong 1 lần gọi. Trả về Promise xong hết (dùng cho kiểm thử). */
function handleWebhook(body) {
  if (!body || body.object !== 'page') return Promise.resolve([]);
  const jobs = [];
  for (const entry of body.entry || []) {
    if (!pageId && /^\d{5,30}$/.test(String(entry.id || ''))) pageId = String(entry.id);
    // Bình luận trên bài đăng / quảng cáo (webhook mục "feed")
    for (const ch of entry.changes || []) {
      if (ch.field === 'feed' && ch.value && ch.value.item === 'comment') {
        jobs.push(enqueue(`c:${ch.value.from && ch.value.from.id}`, () => require('./fb-comments').handleComment(ch.value, { pageId })));
      }
    }
    for (const ev of entry.messaging || []) {
      const key = (ev.message && ev.message.is_echo ? ev.recipient && ev.recipient.id : ev.sender && ev.sender.id) || 'x';
      jobs.push(enqueue(key, () => handleEvent(ev)));
    }
  }
  return Promise.all(jobs);
}

/**
 * Báo khách qua Messenger về đơn đặt từ AI Fanpage: 'placed' (vừa đặt), 'reminder' (sắp hết giờ giữ đơn), 'paid' (đã nhận tiền).
 * Facebook chỉ cho nhắn trong 24 giờ kể từ tin cuối của khách — quá hạn thì bỏ qua (khách vẫn có email/trang đơn).
 */
async function orderUpdate(order, kind, extra = {}) {
  if (!configured() || !order || !order.messenger_psid) return false;
  const payment = require('./payment');
  const { money, deliveryWhen } = require('./format');
  const link = require('../routes/checkout').shareLink(order.code);
  const due = payment.amountDue(order);
  const isDep = order.payment_method === 'cod' && Number(order.deposit_amount) > 0 && order.payment_status === 'pending';
  let text = '';
  if (kind === 'placed') {
    text = `Dạ Lunar Lucky đã nhận đơn ${order.code} — tổng ${money(order.total)}, giao ${deliveryWhen(order)} ạ.`;
    if (payment.awaitingMoney(order) && due) text += `\nAnh/chị ${isDep ? 'đặt cọc' : 'chuyển khoản'} ${money(due)} theo mã QR trong link dưới (nội dung ${order.code}) để em giữ giỏ${extra.until ? ` đến ${extra.until}` : ''}; tiền vào là hệ thống tự xác nhận.`;
    else if (order.payment_method === 'cod') text += `\nAnh/chị thanh toán ${money(payment.codDue(order))} khi nhận hàng. Em sẽ gọi xác nhận trước khi giao.`;
  } else if (kind === 'reminder') {
    if (!payment.awaitingMoney(order) || !due) return false;
    text = `Dạ em nhắc anh/chị: đơn ${order.code} đang chờ ${isDep ? 'đặt cọc' : 'chuyển khoản'} ${money(due)}. Lunar Lucky giữ giỏ quà${extra.until ? ` đến ${extra.until}` : ''}, sau đó đơn tự hủy để nhường hàng cho khách khác ạ.`;
  } else if (kind === 'paid') {
    text = order.payment_status === 'deposit'
      ? `Dạ Lunar Lucky đã nhận tiền cọc đơn ${order.code}. Kho bắt đầu chuẩn bị; còn ${money(payment.codDue(order))} anh/chị thanh toán khi nhận hàng ạ. Cảm ơn anh/chị!`
      : `Dạ Lunar Lucky đã nhận đủ tiền đơn ${order.code}. Kho bắt đầu chuẩn bị, giao ${deliveryWhen(order)} ạ. Cảm ơn anh/chị!`;
  } else if (kind === 'review') {
    text = `Dạ Lunar Lucky cảm ơn anh/chị đã tin chọn giỏ quà (đơn ${order.code}) ạ. Anh/chị dành 1 phút cho em xin cảm nhận${order.is_gift ? ' của người nhận' : ''}, kèm ảnh nếu tiện nhé — góp ý của anh/chị giúp bên em làm tốt hơn!`;
  } else return false;
  const ok = await send({ recipient: { id: order.messenger_psid }, messaging_type: 'RESPONSE', message: { metadata: AI_TAG, attachment: { type: 'template', payload: {
    template_type: 'button', text: text.slice(0, 640), buttons: [kind === 'review' ? { type: 'web_url', url: extra.url, title: 'Gửi cảm nhận' } : { type: 'web_url', url: link, title: kind === 'paid' ? 'Xem đơn' : 'Xem đơn & mã QR' }],
  } } } }).catch(() => false);
  return ok;
}

/**
 * (mỗi sáng) Kiểm tra mã trang Facebook: hết hiệu lực / sắp hết hạn truy cập dữ liệu (Facebook bắt cấp quyền lại ~90 ngày)
 * → báo chủ đề BÁO LỖI trước 14 ngày, tránh AI Fanpage tự dừng giữa mùa cao điểm.
 */
let debugToken = async () => {
  const appToken = `${process.env.FB_APP_ID || '2690193658061813'}|${env().secret}`;
  const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(env().token)}`, { headers: { Authorization: `Bearer ${appToken}` }, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  return j.data || null;
};
async function checkToken(now = Date.now()) {
  if (!configured()) return null;
  const d = await debugToken().catch(() => null);
  if (!d) return null;
  const days = (t) => Math.floor((Number(t) * 1000 - now) / 86400000);
  const fmt = (t) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(Number(t) * 1000));
  let warn = '';
  if (d.is_valid === false) warn = 'Mã trang Facebook (FB_PAGE_TOKEN) <b>đã hết hiệu lực</b> — AI Fanpage và bot bình luận đang KHÔNG chạy.';
  else if (d.expires_at && Number(d.expires_at) > 0 && days(d.expires_at) <= 14) warn = `Mã trang Facebook <b>hết hạn ngày ${fmt(d.expires_at)}</b> (còn ${days(d.expires_at)} ngày).`;
  else if (d.data_access_expires_at && days(d.data_access_expires_at) <= 14) warn = `Quyền truy cập dữ liệu của mã trang Facebook <b>hết hạn ngày ${fmt(d.data_access_expires_at)}</b> (còn ${days(d.data_access_expires_at)} ngày).`;
  if (warn) {
    await require('./notify').telegram(`⚠️ ${warn}
👉 Tạo lại mã trang vĩnh viễn (Graph API Explorer → gia hạn mã → lấy mã trang) rồi dán vào Render, biến FB_PAGE_TOKEN.`, null, { topic: 'error' }).catch(() => {});
  }
  return { ...d, warn };
}

// Lời chào + nút câu hỏi gợi ý khi khách mở Messenger lần đầu (gọi khi khởi động; Facebook bỏ qua nếu không đổi)
async function setupProfile() {
  if (!configured()) return false;
  const r = await fetch(`${GRAPH}/me/messenger_profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env().token}` },
    body: JSON.stringify({
      greeting: [{ locale: 'default', text: 'Lunar Lucky — giỏ quà Tết cao cấp, giao toàn quốc. Nhắn để được tư vấn chọn quà, báo giá và lịch giao ngay, cả ngoài giờ.' }],
      ice_breakers: [{ locale: 'default', call_to_actions: [
        { question: 'Tư vấn giỏ quà biếu sếp, đối tác', payload: 'IB_BIEU' },
        { question: 'Quà Tết cho nhân viên (số lượng nhiều)', payload: 'IB_NHANVIEN' },
        { question: 'Bảng giá và thời gian giao hàng', payload: 'IB_GIA' },
        { question: 'Gặp nhân viên tư vấn', payload: 'IB_NGUOI' },
      ] }],
    }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => ({ ok: false, text: async () => err.message }));
  const sub = await fetch(`${GRAPH}/me/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env().token}` },
    body: JSON.stringify({ subscribed_fields: ['messages', 'messaging_postbacks', 'message_echoes', 'messaging_referrals', 'feed'] }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => ({ ok: false, text: async () => err.message }));
  if (!sub.ok) console.error('[messenger] chưa đăng ký được bình luận/quảng cáo cho trang:', sub.status || '', (await sub.text().catch(() => '')).slice(0, 250));
  else console.log('[messenger] trang đã đăng ký: tin nhắn, bình luận (feed), quảng cáo (referral)');
  if (!r.ok) console.error('[messenger] không cài được lời chào/nút gợi ý:', r.status || '', (await r.text().catch(() => '')).slice(0, 200));
  else console.log('[messenger] đã cài lời chào + nút câu hỏi gợi ý');
  return r.ok;
}

module.exports = {
  orderUpdate,
  followUpAbandoned,
  setupProfile,
  checkToken,
  _setDebugToken: (fn) => { debugToken = fn; },
  _setPause: (fn) => { pauseMs = fn; },
  configured, enabled, verifySignature, verifyChallenge, handleWebhook, handleEvent, loadHandoff, plain, AI_TAG,
  _setSend: (fn) => { send = async (b) => {
    const r = await fn(b);
    if (r && r.error) { lastSendError = String(r.error); return false; }
    lastSendError = '';
    rememberSent(b, r && typeof r === 'object' ? r : null);
    return r;
  }; },
  sendRaw: (b) => send(b),
  addNote,
  rememberName,
  replyFromTelegram,
  handleTgCallback,
  STAFF_TAG,
  _setUpload: (fn) => { uploadImage = fn; },
  _setDownloadTg: (fn) => { downloadTgPhoto = fn; },
  _setProfile: (fn) => { fetchProfile = fn; },
  _setConversation: (fn) => { fetchConversation = fn; },
  _setPageId: (id) => { pageId = id; },
  _resetEchoState: () => { ours.mids.clear(); ours.lastSend.clear(); ours.lastIncoming.clear(); nameFail.clear(); ours.appId = ''; },
};
