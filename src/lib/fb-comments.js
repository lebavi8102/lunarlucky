/**
 * Bot bình luận Facebook: khách bình luận "giá?", "ib", "xin giá"… dưới bài đăng / quảng cáo
 * → trả lời công khai 1 câu ngắn + nhắn riêng (private reply) → khách trả lời là AI Messenger tư vấn tiếp.
 * Bình luận có số điện thoại → ẩn bình luận (đối thủ không lấy được số) + tạo yêu cầu gọi lại.
 * Cần: webhook trang đăng ký mục "feed"; mã trang có quyền pages_manage_engagement (trả lời/ẩn bình luận).
 */
const db = require('../db');
const settings = require('./settings');

const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v23.0'}`;
const token = () => process.env.FB_PAGE_TOKEN || '';

// Khách hỏi mua / hỏi giá → trả lời. Khen chung chung ("đẹp quá") thì để người thật tương tác.
// (ranh giới từ theo chữ Unicode: \b của JS không hiểu chữ có dấu như "giá")
const INTENT = /(?<![\p{L}\d])(gi[aá]|ib|inbox|in box|check|tư vấn|tu van|bao nhi[eê]u|bn|xin|còn (hàng|không|ko)|ship|giao|đặt|dat|mua|order|báo giá|bao gia|liên hệ|lh|địa chỉ|ở đâu|sđt|zalo|giỏ|gio|set|combo)(?![\p{L}\d])|\?/iu;
const PHONE = /(?:\+?84|0)[\s.-]?(?:\d[\s.-]?){8}\d/;

let graph = async (path, body) => {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.error('[bình luận FB] lỗi', path.split('/')[0], r.status, JSON.stringify(j).slice(0, 250));
  return r.ok ? j : null;
};

const salute = (name) => (name ? `anh/chị ${String(name).trim().split(/\s+/).pop()}` : 'anh/chị');

async function priceRange() {
  const r = await db('products').where({ is_active: true }).min({ lo: 'price' }).max({ hi: 'price' }).first();
  const { money } = require('./format');
  return r && r.lo ? `${money(r.lo)} – ${money(r.hi)}` : '';
}

/** Xử lý 1 bình luận (value của webhook field "feed"). Trả về hành động đã làm. */
async function handleComment(v, { pageId } = {}) {
  if (!v || v.item !== 'comment' || v.verb !== 'add' || !v.comment_id) return 'skip';
  const from = v.from || {};
  if (pageId && String(from.id) === String(pageId)) return 'own'; // trang tự bình luận
  const s = await settings.all();
  if (String(s.comment_bot_enabled) === '0' || !token()) return 'off';
  if (await db('fb_comments').where({ comment_id: v.comment_id }).first()) return 'dup';
  const text = String(v.message || '').trim();
  const row = { comment_id: v.comment_id, post_id: v.post_id || null, from_id: from.id || null, from_name: from.name ? String(from.name).slice(0, 120) : null, message: text.slice(0, 500), created_ms: Date.now() };
  const phone = (PHONE.exec(text) || [])[0];

  if (!phone && !INTENT.test(text)) {
    await db('fb_comments').insert({ ...row, action: 'skip' });
    return 'skip';
  }
  // Cùng người, cùng bài, trong 24 giờ đã trả lời rồi → không nhắn lại (tránh spam)
  if (!phone && from.id && await db('fb_comments').where({ from_id: from.id, post_id: v.post_id || null }).whereIn('action', ['reply', 'phone']).andWhere('created_ms', '>', Date.now() - 86400000).first()) {
    await db('fb_comments').insert({ ...row, action: 'repeat' });
    return 'repeat';
  }
  await db('fb_comments').insert({ ...row, action: phone ? 'phone' : 'reply' });
  const who = salute(from.name);

  if (phone) {
    // Ẩn bình luận có SĐT (bảo mật, đối thủ không gom số) + báo nhóm gọi lại
    await graph(v.comment_id, { is_hidden: true });
    await graph(`${v.comment_id}/comments`, { message: `Dạ Lunar Lucky đã nhận số, sẽ gọi ${who} ngay ạ. Bình luận được ẩn để bảo mật số điện thoại 🙏` });
    await require('./callbacks').create({ name: from.name || 'Khách bình luận Facebook', phone: phone.replace(/\D/g, '').replace(/^84/, '0'), interest: text.slice(0, 300), note: 'Bình luận Facebook (đã ẩn số)', source: 'facebook' }).catch(() => {});
  } else {
    await graph(`${v.comment_id}/comments`, { message: String(s.comment_public_reply || 'Dạ Lunar Lucky đã nhắn tin riêng cho {ten} ạ, {ten} xem tin nhắn giúp em nhé 💌').replace(/\{ten\}/g, who) });
  }
  // Nhắn riêng (private reply) → mở cuộc trò chuyện Messenger, khách trả lời là AI tư vấn tiếp
  const range = await priceRange();
  const msg = phone
    ? `Dạ em chào ${who}, Lunar Lucky đã nhận số điện thoại và chuyên viên sẽ gọi ${who} sớm nhất ạ. Trong lúc chờ, ${who} cần xem mẫu hay hỏi gì cứ nhắn em ngay tại đây nhé!`
    : `Dạ em chào ${who}, em là trợ lý tư vấn của Lunar Lucky ạ. Giỏ quà Tết bên em ${range ? `có giá từ ${range}, ` : ''}thiệp viết tay miễn phí, giao đúng ngày ${who} chọn.\n${who.charAt(0).toUpperCase() + who.slice(1)} cho em biết quà tặng ai (sếp, đối tác, bố mẹ…) và ngân sách khoảng bao nhiêu để em gợi ý mẫu hợp nhất nhé?`;
  const m = require('./messenger');
  const res = await m.sendRaw({ recipient: { comment_id: v.comment_id }, message: { text: msg, metadata: m.AI_TAG } }).catch(() => null);
  const psid = res && res.recipient_id ? String(res.recipient_id) : null;
  if (psid) {
    await db('fb_comments').where({ comment_id: v.comment_id }).update({ psid });
    await m.rememberName(psid, await db('messenger_threads').where({ psid }).first(), from.name || '');
    // Cho AI biết khách đến từ bình luận nào, em đã nhắn gì → khách trả lời là AI nói tiếp đúng mạch
    await m.addNote(psid, `Khách bình luận Facebook: "${text.slice(0, 200)}"`);
    await m.addNote(psid, `Nhân viên: ${msg}`);
  }
  return phone ? 'phone' : 'reply';
}

module.exports = { handleComment, INTENT, PHONE, _setGraph: (fn) => { graph = fn; } };
