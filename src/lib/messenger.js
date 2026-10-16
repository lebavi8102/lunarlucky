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
  const psid = body && body.recipient && body.recipient.id;
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
    return false;
  }
  rememberSent(body, await r.json().catch(() => null));
  return true;
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
}

async function createHandoff(session) {
  const token = crypto.randomBytes(16).toString('base64url');
  await db('ai_handoffs').insert({
    token,
    data: JSON.stringify({ cart: session.cart, prefill: { ...session.aiPrefill, source: 'ai_fb' } }),
    expires_ms: Date.now() + HANDOFF_HOURS * 3600000,
  });
  await db('ai_handoffs').where('expires_ms', '<', Date.now()).del().catch(() => {});
  return `${config.siteUrl}/tu-van/don/${token}`;
}

async function loadHandoff(token) {
  if (!/^[\w-]{10,40}$/.test(String(token || ''))) return null;
  const row = await db('ai_handoffs').where({ token }).first();
  if (!row || Number(row.expires_ms) < Date.now()) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

const HUMAN = /(gặp|nói chuyện|chat|nối máy|chuyển).{0,12}(người thật|nhân viên|tư vấn viên|chủ shop|admin)|(người thật|nhân viên) (tư vấn|trả lời)/i;

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
    }
    return 'echo';
  }
  const psid = ev.sender && ev.sender.id;
  if (!psid) return 'skip';
  ours.lastIncoming.set(psid, Number(ev.timestamp) || Date.now());
  const text = String((ev.message && (ev.message.quick_reply ? ev.message.text || ev.message.quick_reply.payload : ev.message.text))
    || (ev.postback && (ev.postback.title || ev.postback.payload)) || '').trim();

  if (/^(xo[aá]|x[oó]a)\s*(d[uữ]\s*li[eệ]u|l[iị]ch\s*s[uử]|tin\s*nh[aắ]n)/i.test(text) && configured()) {
    await db('messenger_threads').where({ psid }).del();
    await sendText(psid, 'Dạ em đã xóa toàn bộ lịch sử trò chuyện của anh/chị với trợ lý Lunar Lucky. Cần tư vấn lại anh/chị cứ nhắn em nhé!');
    return 'deleted';
  }

  const { row, history } = await thread(psid);
  if (row && Number(row.paused_until_ms) > Date.now()) { // người thật đang tư vấn → AI im, nhưng ghi lại để nói tiếp cho khớp
    if (text) await addNote(psid, `Khách: ${text}`);
    return 'paused';
  }
  if (!enabled(s)) return 'off';

  if (!text) {
    // Sticker "like" → bỏ qua; ảnh/tệp → nhờ khách gõ chữ
    if (ev.message && ev.message.sticker_id) return 'sticker';
    if (ev.message && ev.message.attachments) {
      await sendText(psid, 'Em đã nhận ảnh/tệp của anh/chị. Em là trợ lý tự động nên chỉ đọc được tin chữ — anh/chị mô tả giúp em (vd: ngân sách, tặng ai, giao ở đâu) để em tư vấn nhé! Cần người thật xem ảnh thì nhắn "gặp nhân viên" ạ.');
      return 'attachment';
    }
    return 'skip';
  }

  if (HUMAN.test(text)) {
    await pause(psid, pauseHours);
    await sendText(psid, `Dạ em đã báo chuyên viên Lunar Lucky, anh/chị đợi một chút sẽ có người trả lời ngay tại đây ạ. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} nhé!`);
    await require('./notify').telegram(`💬 <b>Khách Fanpage cần gặp người thật</b>\nTin: ${text.slice(0, 200).replace(/[<>&]/g, '')}\n👉 Mở hộp thư Fanpage để trả lời (AI tạm dừng với khách này ${pauseHours} giờ).`, null, { topic: 'consult' }).catch(() => {});
    return 'human';
  }

  // Chặn spam: quá số tin/ngày → nhờ người thật, AI tạm dừng với khách này
  const cap = Math.max(10, Number(s.messenger_daily_cap) || 60);
  if ((await countToday(psid, row)) > cap) {
    await pause(psid, pauseHours);
    await sendText(psid, `Dạ hôm nay anh/chị đã nhắn khá nhiều, em chuyển chuyên viên Lunar Lucky trả lời trực tiếp tại đây ạ. Cần gấp anh/chị gọi ${s.shop_phone || 'hotline'} nhé!`);
    await require('./notify').telegram(`💬 <b>Khách Fanpage nhắn quá ${cap} tin hôm nay</b> — AI tạm dừng ${pauseHours} giờ với khách này.\nTin cuối: ${text.slice(0, 200).replace(/[<>&]/g, '')}\n👉 Mở hộp thư Fanpage để trả lời.`, null, { topic: 'consult' }).catch(() => {});
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
  await sendText(psid, r.reply);
  if (r.action && session.cart && session.aiPrefill) {
    const url = await createHandoff(session);
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
    for (const ev of entry.messaging || []) {
      const key = (ev.message && ev.message.is_echo ? ev.recipient && ev.recipient.id : ev.sender && ev.sender.id) || 'x';
      jobs.push(enqueue(key, () => handleEvent(ev)));
    }
  }
  return Promise.all(jobs);
}

module.exports = {
  configured, enabled, verifySignature, verifyChallenge, handleWebhook, handleEvent, loadHandoff, plain, AI_TAG,
  _setSend: (fn) => { send = async (b) => { const r = await fn(b); rememberSent(b, r && typeof r === 'object' ? r : null); return !!r; }; },
  _setProfile: (fn) => { fetchProfile = fn; },
  _resetEchoState: () => { ours.mids.clear(); ours.lastSend.clear(); ours.lastIncoming.clear(); nameFail.clear(); ours.appId = ''; },
};
