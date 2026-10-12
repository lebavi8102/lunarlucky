const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const config = require('../config');
const { money, ymd } = require('./format');

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

async function sendMail({ to, subject, template, data }) {
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
    await t.sendMail({ from: config.mail.from, to, subject, html });
  } catch (err) {
    console.error('[mail] gửi thất bại:', err.message);
  }
}

function escapeTg(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function telegram(html) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) {
    console.log('[telegram] (chưa cấu hình)\n' + html.replace(/<[^>]+>/g, ''));
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error('[telegram] lỗi', r.status, await r.text());
  } catch (err) {
    console.error('[telegram] gửi thất bại:', err.message);
  }
}

function orderTelegram(order, items) {
  const e = escapeTg;
  const list = items.map((i) => `• ${e(i.name)} × ${i.qty} = ${money(i.line_total)}`).join('\n');
  return [
    `🧧 <b>ĐƠN MỚI ${e(order.code)}</b>`,
    `👤 ${e(order.customer_name)} · ${e(order.phone)}`,
    `📍 ${e(order.address)}${order.province ? ', ' + e(order.province) : ''}`,
    order.is_gift ? `🎁 Gửi tặng: ${e(order.recipient_name)} · ${e(order.recipient_phone)}\n    ${e(order.recipient_address)}` : null,
    order.delivery_date ? `📅 Giao ngày: ${ymd(order.delivery_date)}` : null,
    '',
    list,
    '',
    order.discount ? `Giảm giá (${e(order.coupon_code)}): −${money(order.discount)}` : null,
    `Phí giao: ${money(order.shipping_fee)}`,
    `<b>Tổng: ${money(order.total)}</b> · ${order.payment_method === 'bank' ? 'Chuyển khoản' : 'COD'}`,
    order.card_message ? `💌 Thiệp: “${e(order.card_message)}”` : null,
    order.note ? `📝 ${e(order.note)}` : null,
    `\n${config.siteUrl}/admin/don-hang/${order.id}`,
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
    `\n${config.siteUrl}/admin/bao-gia`,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = { sendMail, telegram, orderTelegram, quoteTelegram };
