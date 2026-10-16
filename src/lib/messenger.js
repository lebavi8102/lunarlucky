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
  }
  return r.ok;
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

async function pause(psid, hours) {
  await saveThread(psid, { paused_until_ms: Date.now() + hours * 3600000 });
}

/** Lưu giỏ + thông tin điền sẵn → link ngắn mở trang thanh toán trên web. */
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
    if (ev.message.metadata !== AI_TAG && ev.recipient && ev.recipient.id) await pause(ev.recipient.id, pauseHours);
    return 'echo';
  }
  const psid = ev.sender && ev.sender.id;
  if (!psid) return 'skip';
  const text = String((ev.message && (ev.message.quick_reply ? ev.message.text || ev.message.quick_reply.payload : ev.message.text))
    || (ev.postback && (ev.postback.title || ev.postback.payload)) || '').trim();

  const { row, history } = await thread(psid);
  if (row && Number(row.paused_until_ms) > Date.now()) return 'paused'; // người thật đang tư vấn
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
    await require('./notify').telegram(`💬 <b>Khách Fanpage cần gặp người thật</b>\nTin: ${text.slice(0, 200).replace(/[<>&]/g, '')}\n👉 Mở hộp thư Fanpage để trả lời (AI tạm dừng với khách này ${pauseHours} giờ).`).catch(() => {});
    return 'human';
  }

  typing(psid);
  let session = { aiChat: history };
  let r = await ai.chat({ session }, text, { channel: 'messenger' });
  if (r.full) { // cuộc trò chuyện quá dài → bắt đầu lại, giữ trải nghiệm liền mạch trên Messenger
    session = { aiChat: [] };
    r = await ai.chat({ session }, text, { channel: 'messenger' });
  }
  await saveThread(psid, { history: JSON.stringify(session.aiChat || []) });
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
  _setSend: (fn) => { send = fn; },
};
