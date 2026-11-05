/**
 * Đọc file Excel (.xlsx) đơn giản, không cần thư viện ngoài: giải nén zip (zlib) + đọc XML của sheet.
 *   readXlsx(buffer) → [{ name: 'Sản phẩm', rows: [[ô A1, ô B1, …], …] }]
 * Ô số trả về Number, ô chữ trả về String (giữ xuống dòng), ô trống là null.
 * Đủ dùng cho file nhập sản phẩm do Excel / WPS / Google Sheets lưu ra.
 */
const zlib = require('zlib');

const MAX_UNZIPPED = 30 * 1024 * 1024; // chặn file zip "bom"

/** Giải nén: trả về Map tên tệp → Buffer (chỉ lấy tệp .xml / .rels). */
function unzip(buf) {
  // tìm "End of central directory" (cuối file)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad('Tệp không phải Excel .xlsx hợp lệ.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw bad('Tệp Excel bị hỏng.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    total += usize;
    if (total > MAX_UNZIPPED) throw bad('Tệp Excel quá lớn.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out.set(name.replace(/^\/+/, ''), method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }));
  }
  return out;
}

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const decode = (s) =>
  String(s)
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => (h.toUpperCase() === '000D' ? '' : String.fromCharCode(parseInt(h, 16))))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Ghép chữ trong <si> / <is> (kể cả chữ nhiều định dạng <r><t>…</t></r>), bỏ phần phiên âm <rPh>. */
const textOf = (xml) => decode([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => m[1] || '').join(''));

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
};

/** "B12" → chỉ số cột 1 */
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '');
  if (!letters) return null;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw bad('Tệp không phải Excel .xlsx hợp lệ.');
  const files = unzip(buf);
  const str = (name) => (files.get(name) ? files.get(name).toString('utf8') : '');

  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textOf(m[1] || ''));

  // tên sheet → đường dẫn tệp XML của sheet
  const rels = {};
  for (const m of str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(m[0], 'Target');
    rels[attr(m[0], 'Id')] = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheets = [];
  for (const m of str('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    const xml = str(rels[rid] || '');
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[0].slice(0, rm[0].indexOf('>') + 1), 'r')) - 1;
    const idx = Number.isInteger(r) && r >= 0 ? r : rows.length;
    const cells = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = `<c${cm[1]}>`;
      const ci = colIndex(attr(head, 'r'));
      const col = ci == null ? next : ci;
      next = col + 1;
      const type = attr(head, 't');
      const inner = cm[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let val = null;
      if (type === 's') val = v ? shared[Number(v[1])] ?? null : null;
      else if (type === 'inlineStr') val = textOf(inner);
      else if (type === 'str' || type === 'e') val = v ? decode(v[1]) : null;
      else if (type === 'b') val = v ? v[1] === '1' : null;
      else if (v) val = Number.isFinite(Number(v[1])) ? Number(v[1]) : decode(v[1]);
      if (typeof val === 'string' && val === '') val = null;
      cells[col] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[idx] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

module.exports = { readXlsx };
