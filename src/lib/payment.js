/**
 * Chọn tài khoản nhận tiền cho đơn:
 * - Đơn cần xuất hóa đơn VAT → tài khoản công ty (đúng pháp nhân xuất hóa đơn)
 * - Đơn bán lẻ → tài khoản cá nhân
 */
const { vietQrUrl } = require('./vietqr');

/** Mã ngân hàng VietQR thường dùng (gợi ý trong admin, vẫn nhập được mã khác). */
const BANKS = [
  ['VCB', 'Vietcombank'], ['BIDV', 'BIDV'], ['ICB', 'VietinBank'], ['VBA', 'Agribank'],
  ['TCB', 'Techcombank'], ['MB', 'MB Bank'], ['ACB', 'ACB'], ['VPB', 'VPBank'], ['TPB', 'TPBank'],
  ['STB', 'Sacombank'], ['HDB', 'HDBank'], ['VIB', 'VIB'], ['SHB', 'SHB'], ['MSB', 'MSB'],
  ['OCB', 'OCB'], ['SEAB', 'SeABank'], ['EIB', 'Eximbank'], ['LPB', 'LPBank'], ['NAB', 'Nam A Bank'],
  ['VCCB', 'BVBank'], ['ABB', 'ABBANK'], ['BAB', 'Bac A Bank'], ['KLB', 'KienlongBank'], ['PVCB', 'PVcomBank'],
];

function accountFromSettings(type, s) {
  if (type === 'company') {
    return {
      type: 'company',
      bankId: s.company_bank_id, bankName: s.company_bank_name, account: s.company_bank_account,
      holder: s.company_bank_holder, label: 'Tài khoản công ty (xuất VAT)',
    };
  }
  return {
    type: 'personal',
    bankId: s.bank_id, bankName: s.bank_name, account: s.bank_account, holder: s.bank_holder,
    label: 'Tài khoản bán lẻ',
  };
}

function isConfigured(acc) {
  return !!(acc && acc.bankId && acc.account && acc.holder);
}

/** Các cột lưu vào đơn khi tạo đơn / đổi tài khoản. */
function snapshot(acc) {
  return {
    pay_account: acc.type, pay_bank_id: acc.bankId || null, pay_bank_name: acc.bankName || null,
    pay_account_no: acc.account || null, pay_holder: acc.holder || null,
  };
}

/** Tài khoản của một đơn: ưu tiên bản đã lưu trong đơn; đơn cũ (chưa lưu) dùng cài đặt hiện tại. */
function accountForOrder(order, s) {
  if (order.pay_account_no) {
    return {
      type: order.pay_account || 'personal', bankId: order.pay_bank_id, bankName: order.pay_bank_name,
      account: order.pay_account_no, holder: order.pay_holder,
      label: order.pay_account === 'company' ? 'Tài khoản công ty (xuất VAT)' : 'Tài khoản bán lẻ',
    };
  }
  return accountFromSettings(order.needs_vat ? 'company' : 'personal', s);
}

function qrForOrder(order, s) {
  if (order.payment_method !== 'bank') return null;
  const acc = accountForOrder(order, s);
  if (!isConfigured(acc)) return null;
  return vietQrUrl({ bankId: acc.bankId, account: acc.account, holder: acc.holder, amount: order.total, info: order.code });
}

/** "****1234" — dùng trong Telegram để không lộ trọn số tài khoản. */
function maskAccount(no) {
  const s = String(no || '');
  return s.length > 4 ? `****${s.slice(-4)}` : s;
}

/** Phí xuất hóa đơn VAT khách chịu: % × (tiền hàng − giảm giá + phí giao). */
function vatFeePercent(s) {
  const raw = String(s.vat_fee_percent ?? '').trim().replace(',', '.');
  if (!raw) return 11;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 11;
}
function vatFee(baseTotal, s) {
  return Math.round((Number(baseTotal) || 0) * vatFeePercent(s) / 100);
}

module.exports = { vatFeePercent, vatFee, BANKS, accountFromSettings, accountForOrder, isConfigured, snapshot, qrForOrder, maskAccount };
