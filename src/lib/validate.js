const { normalizePhone, todayVN } = require('./format');

const PHONE_RE = /^(0|\+84)(3|5|7|8|9|2)\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v, max = 255) {
  return String(v ?? '').trim().slice(0, max);
}

/**
 * Bộ kiểm tra nhỏ: gom lỗi theo field để hiển thị ngay dưới ô nhập.
 */
class Form {
  constructor(body) {
    this.body = body || {};
    this.values = {};
    this.errors = {};
  }

  text(name, { label, required = false, min = 0, max = 255 } = {}) {
    const v = str(this.body[name], max);
    this.values[name] = v;
    if (required && !v) this.errors[name] = `Vui lòng nhập ${label}.`;
    else if (v && v.length < min) this.errors[name] = `${label} cần ít nhất ${min} ký tự.`;
    return v;
  }

  phone(name, { label = 'số điện thoại', required = true } = {}) {
    const raw = str(this.body[name], 30);
    this.values[name] = raw;
    const v = normalizePhone(raw);
    if (!v) {
      if (required) this.errors[name] = `Vui lòng nhập ${label}.`;
      return '';
    }
    if (!PHONE_RE.test(v)) this.errors[name] = 'Số điện thoại chưa đúng định dạng (VD: 0912 345 678).';
    return v;
  }

  email(name, { required = false } = {}) {
    const v = str(this.body[name], 190).toLowerCase();
    this.values[name] = v;
    if (!v) {
      if (required) this.errors[name] = 'Vui lòng nhập email.';
      return '';
    }
    if (!EMAIL_RE.test(v)) this.errors[name] = 'Email chưa đúng định dạng.';
    return v;
  }

  date(name, { label = 'ngày', required = false, minOffset = 0, maxOffset = 365 } = {}) {
    const v = str(this.body[name], 10);
    this.values[name] = v;
    if (!v) {
      if (required) this.errors[name] = `Vui lòng chọn ${label}.`;
      return '';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      this.errors[name] = `${label[0].toUpperCase() + label.slice(1)} không hợp lệ.`;
      return '';
    }
    if (v < todayVN(minOffset)) this.errors[name] = `Vui lòng chọn ${label} từ ${todayVN(minOffset).split('-').reverse().join('/')} trở đi.`;
    else if (v > todayVN(maxOffset)) this.errors[name] = `${label[0].toUpperCase() + label.slice(1)} quá xa.`;
    return v;
  }

  int(name, { label, min = 0, max = 1e9, required = false } = {}) {
    const raw = str(this.body[name], 20);
    this.values[name] = raw;
    if (!raw) {
      if (required) this.errors[name] = `Vui lòng nhập ${label}.`;
      return null;
    }
    const n = Number(raw.replace(/[.,\s]/g, ''));
    if (!Number.isFinite(n) || n < min || n > max) {
      this.errors[name] = `${label[0].toUpperCase() + label.slice(1)} phải từ ${min} đến ${max}.`;
      return null;
    }
    return Math.floor(n);
  }

  oneOf(name, options, fallback) {
    const v = str(this.body[name], 40);
    const out = options.includes(v) ? v : fallback;
    this.values[name] = out;
    return out;
  }

  bool(name) {
    const v = ['1', 'on', 'true', 'yes'].includes(String(this.body[name]));
    this.values[name] = v;
    return v;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }
}

module.exports = { Form, str, PHONE_RE, EMAIL_RE };
