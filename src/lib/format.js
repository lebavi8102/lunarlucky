const vnd = new Intl.NumberFormat('vi-VN');

function money(n) {
  return `${vnd.format(Math.round(Number(n) || 0))}₫`;
}

/** Chuyển mọi dạng thời gian từ MySQL/SQLite về Date. */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v);
  if (/^\d+$/.test(s)) return new Date(Number(s));
  // SQLite CURRENT_TIMESTAMP là UTC dạng "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s);
}

const dateFmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
});
const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
const longDateFmt = new Intl.DateTimeFormat('vi-VN', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
});

function date(v) {
  const d = toDate(v);
  return d ? dateFmt.format(d) : '';
}
function dateTime(v) {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d) : '';
}
function longDate(v) {
  const d = toDate(v);
  return d ? longDateFmt.format(d) : '';
}
/** "2027-01-25" -> "25/01/2027" */
function ymd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
function todayVN(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}

function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function lines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/** Kênh khách đến / kênh chốt đơn. */
const SOURCES = { web: 'Website', facebook: 'Facebook', zalo: 'Zalo', instagram: 'Instagram', tiktok: 'TikTok', phone: 'Điện thoại', other: 'Khác' };
const sourceLabel = (s) => SOURCES[s] || SOURCES.web;

/** Buổi giao (Hà Nội). */
const SLOTS = { sang: 'Sáng (8h–12h)', chieu: 'Chiều (13h–17h)', toi: 'Tối (18h–20h)' };
const slotLabel = (s) => SLOTS[s] || '';
/** "20/10/2026 · Sáng (8h–12h)" */
const deliveryWhen = (o) => [ymd(o.delivery_date), slotLabel(o.delivery_slot)].filter(Boolean).join(' · ');

function normalizePhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}

module.exports = {
  SLOTS, slotLabel, deliveryWhen, SOURCES, sourceLabel,
  money, toDate, date, dateTime, longDate, ymd, todayVN, slugify, lines, parseJson, truncate,
  normalizePhone,
};
