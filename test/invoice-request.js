/**
 * Kiểm thử mẫu tin nhắn "Yêu cầu hóa đơn qua Zalo" (không cần database).
 * Chạy: node test/invoice-request.js
 */
const ir = require('../src/lib/invoice-request');

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};

ok(ir.zaloUrl({}) === 'https://zalo.me/0969000910', 'Mặc định dùng Zalo cá nhân 0969000910');
ok(ir.zaloUrl({ invoice_zalo_url: '  ' }) === 'https://zalo.me/0969000910', 'Cài đặt để trống → vẫn dùng link mặc định');
ok(ir.zaloUrl({ invoice_zalo_url: 'https://zalo.me/0900000000' }) === 'https://zalo.me/0900000000', 'Đổi được link trong cài đặt');
ok(!/oa\.zalo|openapi/.test(ir.zaloUrl({})), 'Không dùng Zalo OA / API');

const vat = ir.message({ code: 'LN261020ABCD', customer_name: 'Chị Lan', email: 'lan@x.vn', needs_vat: 1,
  vat_company: 'Công ty TNHH Thử', vat_tax_code: '0101234567', vat_address: '1 Tràng Tiền, Hà Nội', vat_email: 'kt@thu.vn', total: 1875900 });
ok(/Mã đơn hàng: LN261020ABCD/.test(vat), 'Tin nhắn có mã đơn');
ok(/Tên người mua: Công ty TNHH Thử/.test(vat), 'Đơn VAT: tên người mua = tên công ty');
ok(/Mã số thuế: 0101234567/.test(vat) && /Địa chỉ: 1 Tràng Tiền, Hà Nội/.test(vat) && /Email nhận hóa đơn: kt@thu\.vn/.test(vat), 'Đơn VAT: điền sẵn MST, địa chỉ, email hóa đơn');
ok(!/₫|phí|\d{3}\.\d{3}/i.test(vat), 'Tin nhắn không nhắc phí / số tiền');

const plain = ir.message({ code: 'LN261020WXYZ', customer_name: 'Anh Minh', email: 'minh@x.vn', needs_vat: 0 });
ok(/Tên người mua: Anh Minh/.test(plain) && /Email nhận hóa đơn: minh@x\.vn/.test(plain), 'Đơn thường: lấy tên + email người đặt');
ok(/Mã số thuế: \(điền mã số thuế\)/.test(plain) && /Địa chỉ: \(điền địa chỉ/.test(plain), 'Đơn thường: chừa chỗ điền MST, địa chỉ');
ok(/Email nhận hóa đơn: \(điền email\)/.test(ir.message({ code: 'X', customer_name: 'A' })), 'Không có email → chừa chỗ điền');

console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt');
process.exit(fails ? 1 : 0);
