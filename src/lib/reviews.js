/**
 * Bot xin đánh giá sau khi giao: đơn "Hoàn tất" được 3 giờ (trong khung 9h–20h) → gửi khách link
 * /danh-gia/MÃĐƠN?k=… (email nếu có, Messenger nếu đặt qua AI Fanpage). Khách chấm sao, viết cảm nhận,
 * gửi ảnh (không bắt buộc) → lưu vào "Khách đã nhận quà" CHỜ DUYỆT, báo nhóm Telegram để duyệt.
 */
const db = require('../db');
const config = require('../config');
const settings = require('./settings');

const link = (code) => `${config.publicUrl}/danh-gia/${code}?k=${require('../routes/checkout').orderKey(code)}`;
const vnHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()));

/** (chạy mỗi phút) Gửi lời xin đánh giá cho đơn đã giao xong. */
async function requestReviews({ now = Date.now(), force = false } = {}) {
  const s = await settings.all();
  if (String(s.review_request) === '0') return 0;
  if (!force && (vnHour() < 9 || vnHour() >= 20)) return 0; // không nhắn khách lúc tối muộn / sáng sớm
  const hours = Math.max(1, Number(s.review_delay_hours) || 3);
  const rows = await db('orders').where({ status: 'completed' }).whereNull('review_requested_at').whereNotNull('completed_at')
    .andWhere('completed_at', '<', new Date(now - hours * 3600000)).andWhere('completed_at', '>', new Date(now - 14 * 86400000))
    .andWhere((w) => w.where((x) => x.whereNotNull('email').whereNot('email', '')).orWhereNotNull('messenger_psid'))
    .limit(20);
  for (const o of rows) {
    await db('orders').where({ id: o.id }).update({ review_requested_at: new Date() });
    const url = link(o.code);
    if (o.email) {
      require('./notify').sendMail({ to: o.email, subject: `${o.customer_name.split(' ').pop()} ơi, giỏ quà Lunar Lucky có làm người nhận vui không?`, template: 'review-request', data: { order: o, url, s } });
    }
    if (o.messenger_psid) require('./messenger').orderUpdate(o, 'review', { url }).catch(() => {});
  }
  return rows.length;
}

/** Lưu đánh giá khách gửi → chờ duyệt; báo nhóm. */
async function saveReview(order, { rating, content, imageId, consent }) {
  const { displayName } = require('./testimonials');
  const item = await db('order_items').where({ order_id: order.id }).whereNotNull('product_id').first();
  const [id] = await db('testimonials').insert({
    customer_name: displayName(order.customer_name, order.province),
    content: content || null, image_id: imageId || null, product_id: item ? item.product_id : null,
    order_code: order.code, is_active: false, source: consent ? 'customer' : 'customer-private', rating,
  });
  const tid = typeof id === 'object' ? id.id : id;
  const e = require('./notify').escapeTg;
  await require('./notify').telegram([
    `${'⭐'.repeat(rating)} <b>Khách đánh giá đơn ${order.code}</b> (${rating}/5)`,
    `👤 ${e(order.customer_name)}${imageId ? ' · có ảnh 📷' : ''}`,
    content ? `💭 “${e(content)}”` : null,
    rating <= 3 ? '⚠️ Đánh giá thấp — gọi hỏi thăm khách sớm' : null,
    consent ? `Khách <b>đồng ý</b> đăng lên web → duyệt: ${config.publicUrl}/admin/khach-nhan-qua/${tid}` : 'Khách <b>không</b> đồng ý đăng công khai (chỉ để shop tham khảo).',
  ].filter(Boolean).join('\n'), null, { topic: 'consult' }).catch(() => {});
  return tid;
}

module.exports = { requestReviews, saveReview, link };
