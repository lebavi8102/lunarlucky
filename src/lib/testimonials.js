/**
 * "Khách đã nhận quà": shipper gửi ảnh giao hàng vào nhóm Telegram
 *   ảnh + chú thích: /anhgiao LN261014ABCD [lời khách nhận xét]
 * → lưu ảnh vào web ở trạng thái CHỜ DUYỆT (chỉ đăng khi khách đồng ý), duyệt trong admin.
 */
const db = require('../db');
const config = require('../config');
const notify = require('./notify');
const { saveBuffer, sniff } = require('./media');
const { todayVN } = require('./format');

/** "Nguyễn Thanh Huyền" + "Hà Nội" → "Chị Huyền · Hà Nội" kiểu ẩn bớt: "Khách Thanh H. · Hà Nội" */
function displayName(fullName, province) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  let name = 'Khách hàng';
  if (parts.length === 1) name = parts[0];
  else if (parts.length > 1) name = `${parts[parts.length - 2]} ${parts[parts.length - 1][0]}.`;
  const place = String(province || '').split(',')[0].trim();
  return place ? `${name} · ${place}` : name;
}

async function downloadTelegramPhoto(photos) {
  const best = [...photos].sort((a, b) => (b.file_size || b.width * b.height) - (a.file_size || a.width * a.height))[0];
  const file = await notify.tgApi('getFile', { file_id: best.file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Không tải được ảnh từ Telegram (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

const PHONE_IN_TEXT = /(?:\+?84|0)[\s.-]?(?:\d[\s.-]?){8}\d/;

/**
 * Shipper ghi SĐT khách thay cho mã đơn → tìm đơn khớp (SĐT người đặt hoặc người nhận quà).
 * Nhiều đơn cùng SĐT: ưu tiên đơn đang giao / vừa giao, ngày giao gần hôm nay nhất.
 */
async function findOrderByPhone(phone) {
  const tail = String(phone || '').replace(/\D/g, '').slice(-9);
  if (tail.length < 9) return null;
  const rows = await db('orders')
    .whereNot('status', 'cancelled')
    .andWhere((w) => w.where('phone', 'like', `%${tail}`).orWhere('recipient_phone', 'like', `%${tail}`))
    .orderBy('id', 'desc').limit(30);
  if (!rows.length) return null;
  const today = Date.parse(todayVN());
  const rank = (o) => ({ shipping: 0, completed: 1, packing: 2, confirmed: 3, new: 4 }[o.status] ?? 5);
  const dist = (o) => (o.delivery_date ? Math.abs((o.delivery_date instanceof Date ? o.delivery_date.getTime() : Date.parse(String(o.delivery_date).slice(0, 10))) - today) : Infinity);
  return rows.sort((a, b) => rank(a) - rank(b) || dist(a) - dist(b) || b.id - a.id)[0];
}

/** Xử lý tin có ảnh + chú thích /anhgiao. Trả về câu trả lời gửi lại nhóm. */
async function fromTelegram(msg) {
  // Lệnh nằm ở chú thích ảnh, hoặc là tin chữ TRẢ LỜI (reply) vào một ảnh đã gửi trước đó
  const caption = String(msg.caption || msg.text || '').trim();
  const m = /^\/anhgiao(?:@\w+)?\s*([A-Z0-9]*)\s*([\s\S]*)$/i.exec(caption);
  if (!m) return null;
  const photo = (msg.photo && msg.photo.length && msg.photo) || (msg.reply_to_message && msg.reply_to_message.photo) || null;
  if (!photo) {
    return 'Chưa thấy ảnh. Cách gửi:\n1) Gửi <b>ảnh</b> kèm chú thích <code>/anhgiao MÃĐƠN lời khen</code>, hoặc\n2) Gửi ảnh trước, rồi <b>trả lời (reply) vào ảnh</b> bằng <code>/anhgiao MÃĐƠN lời khen</code>';
  }
  msg = { ...msg, photo };
  let code = m[1].toUpperCase();
  const content = m[2].trim().slice(0, 400) || null;
  // Ghi SĐT khách thay cho mã đơn
  const byPhone = /^\+?\d{9,12}$/.test(code);
  const order = !code ? null : byPhone ? await findOrderByPhone(code) : await db('orders').where({ code }).first();
  if (code && !order) {
    return byPhone
      ? `Không tìm thấy đơn nào có SĐT <b>${notify.escapeTg(code)}</b>. Kiểm tra lại số, hoặc ghi mã đơn.`
      : `Không tìm thấy đơn <b>${notify.escapeTg(code)}</b>. Kiểm tra lại mã đơn trong chú thích ảnh.`;
  }
  if (order) code = order.code;

  const buf = await downloadTelegramPhoto(msg.photo);
  const mime = sniff(buf) || 'image/jpeg';
  const imageId = await saveBuffer(buf, mime, `giao-${code || Date.now()}.jpg`, order ? `Giao quà cho ${displayName(order.customer_name, order.province)}` : 'Giao quà Lunar Lucky');
  const item = order ? await db('order_items').where({ order_id: order.id }).whereNotNull('product_id').first() : null;
  const [id] = await db('testimonials').insert({
    customer_name: order ? displayName(order.customer_name, order.province) : 'Khách hàng',
    content, image_id: imageId, product_id: item ? item.product_id : null, order_code: order ? order.code : null,
    is_active: false, source: 'telegram',
  });
  const tid = typeof id === 'object' ? id.id : id;
  return [
    `📸 Đã lưu ảnh giao ${order ? `đơn <b>${order.code}</b> · ${notify.escapeTg(order.is_gift ? order.recipient_name || order.customer_name : order.customer_name)}` : 'hàng'} vào web — <b>chờ duyệt</b>.`,
    'Chỉ bật hiển thị khi khách <b>đồng ý</b> đăng ảnh.',
    `Duyệt tại: ${config.publicUrl}/admin/khach-nhan-qua/${tid}`,
  ].join('\n');
}

async function listActive({ productId, limit = 8 } = {}) {
  return db('testimonials')
    .where({ is_active: true })
    .whereNotNull('image_id')
    .modify((q) => productId && q.andWhere({ product_id: productId }))
    .orderBy([{ column: 'sort', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(limit);
}

module.exports = { fromTelegram, listActive, displayName, findOrderByPhone, PHONE_IN_TEXT };
