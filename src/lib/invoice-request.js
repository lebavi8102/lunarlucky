/**
 * Yêu cầu hóa đơn điện tử qua Zalo cá nhân (không dùng Zalo OA / API).
 * Link zalo.me/<số> không cho điền sẵn tin nhắn → soạn sẵn mẫu để khách chép rồi dán.
 * Chỉ soạn tin nhắn: không cộng phí, không đổi số tiền của đơn.
 */
const DEFAULT_URL = 'https://zalo.me/0969000910';

function zaloUrl(s) {
  return String((s && s.invoice_zalo_url) || '').trim() || DEFAULT_URL;
}

/** Đơn đã khai VAT lúc đặt → điền sẵn thông tin công ty; đơn thường → để chỗ trống cho khách tự điền. */
function message(order) {
  const v = (x, blank) => String(x || '').trim() || blank;
  return [
    `Lunar Lucky ơi, mình cần xuất hóa đơn điện tử cho đơn hàng ${order.code}.`,
    `- Mã đơn hàng: ${order.code}`,
    `- Tên người mua: ${v(order.needs_vat ? order.vat_company : order.customer_name, '(điền tên người mua / công ty)')}`,
    `- Mã số thuế: ${v(order.vat_tax_code, '(điền mã số thuế)')}`,
    `- Địa chỉ: ${v(order.vat_address, '(điền địa chỉ theo đăng ký kinh doanh)')}`,
    `- Email nhận hóa đơn: ${v(order.vat_email || order.email, '(điền email)')}`,
  ].join('\n');
}

module.exports = { DEFAULT_URL, zaloUrl, message };
