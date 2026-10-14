/**
 * Tài khoản nhận tiền cho đơn: mọi đơn (kể cả đơn xuất VAT) thu vào tài khoản cá nhân,
 * shop tự thanh toán cho đơn vị xuất hóa đơn → không lộ thông tin công ty trên web.
 * (Vẫn giữ loại 'company' để đơn cũ đã lưu TK công ty hiển thị đúng.)
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
  return accountFromSettings('personal', s);
}

/* ---------- Đặt cọc đơn COD ----------
 * Đơn COD có tiền hàng (sau giảm giá) TRÊN mốc tiền, hoặc số giỏ TỪ mốc số lượng → cọc trước X%,
 * phần còn lại trả khi nhận. 1 giỏ dưới mốc tiền: COD bình thường, không cọc.
 */
function depositRule(s) {
  const num = (v, d) => {
    const n = Number(String(v ?? '').replace(/[^\d]/g, ''));
    return String(v ?? '').trim() === '' || !Number.isFinite(n) ? d : n;
  };
  return { percent: Math.min(100, num(s.cod_deposit_percent, 30)), minTotal: num(s.cod_deposit_min_total, 1000000), minQty: num(s.cod_deposit_min_qty, 2) };
}
/** Số tiền cọc cho đơn COD (0 = không cần cọc). Làm tròn lên nghìn đồng. */
function depositFor({ goods, qty, total }, s) {
  const r = depositRule(s);
  if (!r.percent) return 0;
  const need = goods > r.minTotal || (r.minQty > 0 && qty >= r.minQty);
  return need ? Math.min(Number(total), Math.ceil((Number(total) * r.percent) / 100 / 1000) * 1000) : 0;
}
/** Đơn đang chờ tiền (chưa được soạn/giao): chuyển khoản chưa trả, hoặc COD chờ cọc. */
function awaitingMoney(o) {
  if (o.status === 'cancelled') return false;
  if (o.payment_method === 'bank') return o.payment_status === 'pending';
  return Number(o.deposit_amount) > 0 && o.payment_status === 'pending';
}
/** Số tiền khách cần chuyển NGAY (dùng cho mã QR). */
function amountDue(o) {
  if (o.payment_status === 'paid') return 0;
  if (o.payment_method === 'cod') {
    if (Number(o.deposit_amount) > 0 && o.payment_status === 'pending') return Number(o.deposit_amount);
    if (o.payment_status === 'deposit') return Number(o.total) - Number(o.deposit_amount);
  }
  return Number(o.total);
}
/** Tiền shipper thu khi giao. */
function codDue(o) {
  if (o.payment_method !== 'cod' || o.payment_status === 'paid') return 0;
  if (o.payment_status === 'deposit') return Number(o.total) - Number(o.deposit_amount);
  return Number(o.total);
}

function qrForOrder(order, s) {
  // Cả đơn COD cũng có QR: tiền cọc (nếu cần cọc), hoặc khách muốn chuyển khoản trước
  const acc = accountForOrder(order, s);
  if (!isConfigured(acc)) return null;
  const amount = amountDue(order);
  if (!amount) return null;
  return vietQrUrl({ bankId: acc.bankId, account: acc.account, holder: acc.holder, amount, info: order.code });
}

/** "****1234" — dùng trong Telegram để không lộ trọn số tài khoản. */
function maskAccount(no) {
  const s = String(no || '');
  return s.length > 4 ? `****${s.slice(-4)}` : s;
}

/** Phí xuất hóa đơn VAT khách chịu: % × (tiền hàng − giảm giá), không tính phí giao. */
function vatFeePercent(s) {
  const raw = String(s.vat_fee_percent ?? '').trim().replace(',', '.');
  if (!raw) return 11;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 11;
}
function vatFee(baseTotal, s) {
  return Math.round((Number(baseTotal) || 0) * vatFeePercent(s) / 100);
}

module.exports = { depositRule, depositFor, awaitingMoney, amountDue, codDue, vatFeePercent, vatFee, BANKS, accountFromSettings, accountForOrder, isConfigured, snapshot, qrForOrder, maskAccount };
