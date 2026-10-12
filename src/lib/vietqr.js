/**
 * Tạo link ảnh QR chuyển khoản theo chuẩn VietQR (dịch vụ img.vietqr.io miễn phí).
 * bankId: mã ngân hàng viết tắt (VCB, TCB, MB, ACB...) hoặc mã BIN.
 */
function vietQrUrl({ bankId, account, holder, amount, info }) {
  const params = new URLSearchParams({
    amount: String(Math.round(amount)),
    addInfo: info,
    accountName: holder,
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(account)}-compact2.png?${params}`;
}

module.exports = { vietQrUrl };
