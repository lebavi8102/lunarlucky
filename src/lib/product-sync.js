/**
 * Đồng bộ sản phẩm từ file Excel của chủ shop (tool trên máy tính tự gửi lên mỗi khi bấm Lưu).
 * - Khớp sản phẩm theo Mã SP, không có mã thì theo đúng tên. Không khớp → thêm sản phẩm mới.
 * - Cập nhật: tên, danh mục, giá bán, giá gốc, giá vốn, nhãn, mô tả, thành phần, ảnh, nổi bật, đang bán, link video.
 * - TỒN KHO: chỉ áp khi ô tồn kho trong Excel ĐỔI so với lần gửi trước (products.excel_stock). Không đổi → web giữ
 *   số đang có (web tự trừ khi có đơn) → gửi lại file cũ không làm sai tồn kho.
 * - Dòng bị xóa khỏi Excel: không xóa trên web (muốn ngừng bán thì ghi "Không" ở cột Đang bán).
 * - Ảnh: cột ảnh ghi tên file. Trùng tên ảnh đang dùng → giữ nguyên; tên khác → cần gửi kèm file ảnh đó.
 *   Lượt đầu tool chỉ gửi Excel; web trả danh sách ảnh cần (need_images) mà KHÔNG sửa gì; lượt sau gửi kèm ảnh.
 * - Web và AI tư vấn (web + Fanpage) đọc chung bảng products nên đổi ở đây là AI thấy ngay.
 */
const db = require('../db');
const { readXlsx } = require('./xlsx-read');
const { buildXlsx } = require('./xlsx');
const { slugify } = require('./format');
const { sniff } = require('./media');

const CATEGORY_ALIASES = [
  ['Biếu sếp & đối tác', 'Quà tặng sếp & đối tác'],
  ['Quà gia đình', 'Quà tặng gia đình'],
  ['Quà doanh nghiệp', 'Quà tặng doanh nghiệp'],
  ['Hộp quà nhỏ xinh', 'Quà tặng bạn bè'],
];
const idOf = (r) => (r && typeof r === 'object' ? r.id : r);
const norm = (s) => slugify(String(s || '')).replace(/-/g, ' ').trim();
// Khóa so ảnh = đủ đường dẫn (nhiều giỏ cùng có "1.jpg" ở thư mục khác nhau), không phân biệt hoa thường
const fileKey = (s) => String(s || '').replace(/"/g, '').trim().replace(/\//g, '\\').normalize('NFC').toLowerCase();

// Tiêu đề cột (không dấu, chữ thường) → trường. Kiểm tra theo thứ tự, khớp phần đầu tiêu đề.
const HEADERS = [
  ['ghi chu gia von', null],
  ['gia nhap si', null], // file chủ shop: giá vốn lấy theo giá nhập LẺ (an toàn khi tính lãi)
  ['gia nhap le', 'cost_price'],
  ['giam', null], // cột "% giảm" tự tính
  ['kiem tra', null],
  ['anh chinh', 'image'],
  ['anh phu', 'gallery'],
  ['thu tu', 'sort'],
  ['tieu de seo', 'seo_title'],
  ['mo ta seo', 'seo_desc'],
  ['ma sp', 'sku'],
  ['ten san pham', 'name'],
  ['danh muc', 'category'],
  ['gia ban', 'price'],
  ['gia goc', 'compare_price'],
  ['gia von', 'cost_price'],
  ['ton kho', 'stock'],
  ['nhan', 'badge'],
  ['mo ta ngan', 'short_desc'],
  ['thanh phan', 'contents'],
  ['mo ta chi tiet', 'description'],
  ['ten file anh chinh', 'image'],
  ['ten file anh phu', 'gallery'],
  ['link video', 'video_url'],
  ['noi bat', 'is_featured'],
  ['dang ban', 'is_active'],
];

function fieldOf(header) {
  const h = norm(header);
  if (!h) return null;
  for (const [prefix, field] of HEADERS) if (h.startsWith(prefix)) return field;
  return null;
}

/** "1.890.000 ₫" / 1890000 / "1,89tr" → số nguyên đồng; trống → null; không hiểu → NaN */
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  const tr = /^(\d+(?:[.,]\d+)?)(tr|trieu|triệu)$/.exec(s);
  if (tr) return Math.round(Number(tr[1].replace(',', '.')) * 1e6);
  const k = /^(\d+(?:[.,]\d+)?)k$/.exec(s);
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 1e3);
  const digits = s.replace(/[.,₫đd]|vnd/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : NaN;
}

function bool(v, dflt) {
  if (v == null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = norm(v);
  if (['co', 'x', 'yes', 'y', '1', 'true', 'dung', 'bat'].includes(s)) return true;
  if (['khong', 'k', 'no', 'n', '0', 'false', 'sai', 'tat'].includes(s)) return false;
  return dflt;
}

const text = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/\r\n?/g, '\n').trim();
  return s ? (max ? s.slice(0, max) : s) : null;
};
const IMG_EXT = /\.(jpe?g|png|webp|avif)$/i;
/** Ô ảnh → danh sách tên/đường dẫn ảnh. Tách theo ; hoặc xuống dòng; dấu phẩy chỉ tách khi mọi phần đều là tên ảnh
 *  (tên ảnh ChatGPT có dấu phẩy: "Ảnh ChatGPT 16_30_56 22 thg 10, 2026.png"). Bỏ dấu ngoặc kép khi copy đường dẫn. */
const fileList = (v) =>
  String(v || '')
    .split(/[;\n]/)
    .flatMap((piece) => {
      const parts = piece.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
      return parts.length > 1 && parts.every((x) => IMG_EXT.test(x.replace(/"/g, ''))) ? parts : [piece];
    })
    .map((x) => x.replace(/"/g, '').trim())
    .filter(Boolean);


/** Đọc sheet sản phẩm → { rows: [{ line, ...trường }], errors } */
function parseRows(buffer) {
  const sheets = readXlsx(buffer);
  const sheet = sheets.find((s) => norm(s.name) === 'san pham') || sheets[0];
  if (!sheet) throw Object.assign(new Error('File Excel không có sheet nào.'), { status: 400 });
  const headerAt = sheet.rows.findIndex((r) => r.some((c) => fieldOf(c) === 'name'));
  if (headerAt < 0) throw Object.assign(new Error('Không thấy cột "Tên sản phẩm" trong file Excel.'), { status: 400 });
  const map = sheet.rows[headerAt].map(fieldOf);

  const rows = [];
  const errors = [];
  let skipped = 0;
  for (let i = headerAt + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] || [];
    const raw = {};
    map.forEach((f, ci) => { if (f && raw[f] == null) raw[f] = cells[ci] ?? null; });
    const line = i + 1;
    const name = text(raw.name, 160);
    if (!name) {
      if (cells.some((c) => c != null && String(c).trim())) errors.push({ line, error: 'Thiếu tên sản phẩm, bỏ qua dòng này.' });
      continue;
    }
    if (/^\(?\s*v[ií] d[uụ]/i.test(name)) continue; // dòng ví dụ trong file mẫu
    if (raw.price == null || String(raw.price).trim() === '') { skipped++; continue; } // chưa có giá = giỏ đang soạn, để sau
    const r = {
      line,
      sku: text(raw.sku, 40) ? String(raw.sku).toUpperCase().replace(/[^A-Z0-9_-]/g, '') : null,
      name,
      category: text(raw.category),
      price: money(raw.price),
      compare_price: money(raw.compare_price),
      cost_price: money(raw.cost_price),
      stock: raw.stock == null || raw.stock === '' ? null : Math.round(Number(raw.stock)),
      badge: text(raw.badge, 40),
      short_desc: text(raw.short_desc, 300),
      contents: text(raw.contents) && text(raw.contents).split('\n').map((x) => x.trim()).filter(Boolean).join('\n'),
      description: text(raw.description),
      image: fileList(raw.image)[0] || null,
      gallery: fileList(raw.gallery),
      video_url: text(raw.video_url, 500),
      sort: raw.sort == null || raw.sort === '' ? 0 : Math.round(Number(raw.sort)) || 0,
      seo_title: text(raw.seo_title, 180),
      seo_desc: text(raw.seo_desc, 300),
      is_featured: bool(raw.is_featured, false),
      is_active: bool(raw.is_active, true),
      has: Object.fromEntries(map.filter(Boolean).map((f) => [f, true])), // cột nào có trong file
    };
    const bad = [];
    if (!r.category) bad.push('thiếu Danh mục');
    if (r.price == null || Number.isNaN(r.price) || r.price <= 0) bad.push('Giá bán không hợp lệ');
    if (Number.isNaN(r.compare_price)) bad.push('Giá gốc không hợp lệ');
    if (Number.isNaN(r.cost_price)) bad.push('Giá vốn không hợp lệ');
    if (r.stock != null && (!Number.isInteger(r.stock) || r.stock < 0)) bad.push('Tồn kho không hợp lệ');
    if (bad.length) { errors.push({ line, name, error: bad.join(', ') }); continue; }
    if (r.compare_price != null && r.compare_price <= r.price) r.compare_price = null; // giá gạch phải lớn hơn giá bán
    rows.push(r);
  }

  // trùng mã / trùng tên trong cùng file → không biết dòng nào đúng, bỏ cả hai
  const seen = new Map();
  for (const r of rows) {
    for (const key of [r.sku && `sku:${r.sku}`, `name:${norm(r.name)}`].filter(Boolean)) {
      if (seen.has(key)) { r.dup = true; seen.get(key).dup = true; }
      else seen.set(key, r);
    }
  }
  for (const r of rows.filter((x) => x.dup)) errors.push({ line: r.line, name: r.name, error: 'Trùng mã SP hoặc trùng tên với dòng khác trong file, bỏ qua.' });
  return { rows: rows.filter((x) => !x.dup), errors, skipped };
}

/**
 * files: [{ originalname, buffer }] ảnh gửi kèm. final=false: thiếu ảnh thì chỉ trả need_images, không sửa gì.
 * final=true: ảnh vẫn thiếu thì giữ ảnh cũ + báo lỗi dòng đó.
 */
async function syncFromExcel(buffer, files = [], { final = false, check = false } = {}) {
  const { rows, errors, skipped } = parseRows(buffer);
  const uploaded = new Map(files.map((f) => [fileKey(f.originalname), f]));
  const cats = Object.fromEntries((await db('categories').select('id', 'name')).map((c) => [norm(c.name), c.id]));
  // tên danh mục cũ (trước 24/10/2026) trong file chủ shop → tên mới trên web
  for (const [oldName, newName] of CATEGORY_ALIASES) if (!cats[norm(oldName)] && cats[norm(newName)]) cats[norm(oldName)] = cats[norm(newName)];
  const products = await db('products').select('*');
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [String(p.sku).toUpperCase(), p]));
  const byName = new Map();
  // trùng tên (giỏ mẫu cũ đã ẩn cùng tên giỏ thật) → ưu tiên giỏ đang bán, mới hơn
  const ranked = [...products].sort((a, b) => Number(Boolean(b.is_active)) - Number(Boolean(a.is_active)) || b.id - a.id);
  for (const p of ranked) if (!byName.has(norm(p.name))) byName.set(norm(p.name), p);

  const mediaIds = new Set();
  for (const p of products) {
    if (p.image_id) mediaIds.add(p.image_id);
    for (const g of gallery(p)) mediaIds.add(g);
  }
  const mediaName = Object.fromEntries(
    (mediaIds.size ? await db('media').whereIn('id', [...mediaIds]).select('id', 'filename') : []).map((m) => [m.id, fileKey(m.filename)]),
  );

  const plan = [];
  const need = new Set();
  for (const r of rows) {
    const catId = cats[norm(r.category)];
    if (!catId) { errors.push({ line: r.line, name: r.name, error: `Danh mục "${r.category}" không có trên web.` }); continue; }
    const p = (r.sku && bySku.get(r.sku)) || (!r.sku && byName.get(norm(r.name))) || null;
    const other = byName.get(norm(r.name));
    if (p && r.sku && other && other.id !== p.id && other.is_active) {
      errors.push({ line: r.line, name: r.name, error: `Mã ${r.sku} trên web là "${p.name}", còn "${r.name}" đang là mã ${other.sku}. Sửa mã cho khớp để không ghi đè nhầm.` });
      continue;
    }
    if (r.sku && !p && other && other.is_active && other.sku) {
      errors.push({ line: r.line, name: r.name, error: `Tên trùng sản phẩm mã ${other.sku} nhưng mã SP ghi ${r.sku}. Sửa lại mã cho khớp.` });
      continue;
    }
    // ảnh: tên trùng ảnh đang dùng → giữ, khác → cần file
    const wantImgs = [r.image, ...r.gallery].filter(Boolean);
    const curNames = p ? [mediaName[p.image_id], ...gallery(p).map((g) => mediaName[g])].filter(Boolean) : [];
    const missing = wantImgs.filter((f) => !curNames.includes(fileKey(f)) && !uploaded.has(fileKey(f)));
    missing.forEach((f) => need.add(f));
    plan.push({ r, p, catId, missing });
  }

  // check: chỉ hỏi, không sửa — trả cả danh sách ảnh Excel đang ghi để tool gửi lại ảnh đã thay nội dung (cùng tên)
  const images = [...new Set(plan.flatMap(({ r }) => [r.image, ...r.gallery].filter(Boolean)))];
  if (check || (need.size && !final)) return { ok: true, applied: false, need_images: [...need], images, errors, skipped };

  const result = { ok: true, applied: true, created: [], updated: [], unchanged: 0, skipped, errors, need_images: [] };
  const savedMedia = new Map(); // tên file → media id (một ảnh dùng cho nhiều giỏ chỉ lưu 1 lần)
  await db.transaction(async (trx) => {
    const saveImg = async (name, alt) => {
      const key = fileKey(name);
      if (savedMedia.has(key)) return savedMedia.get(key);
      const f = uploaded.get(key);
      const mime = sniff(f.buffer);
      if (!mime) throw Object.assign(new Error(`Tệp "${name}" không phải ảnh JPG/PNG/WebP.`), { status: 400 });
      const id = idOf((await trx('media').insert({ filename: String(name).replace(/"/g, '').trim().normalize('NFC').slice(0, 255), mime, size: f.buffer.length, alt: String(alt).slice(0, 255), data: f.buffer }))[0]);
      savedMedia.set(key, id);
      return id;
    };
    // ảnh theo tên: file gửi kèm → lưu mới (kể cả cùng tên = ảnh đã thay nội dung); không gửi → ảnh đang dùng cùng tên; thiếu → undefined
    const resolve = async (name, p, alt) => {
      if (uploaded.has(fileKey(name))) return saveImg(name, alt);
      if (p) {
        const cur = [p.image_id, ...gallery(p)].find((id) => id && mediaName[id] === fileKey(name));
        if (cur) return cur;
      }
      return undefined;
    };

    for (const { r, p, catId, missing } of plan) {
      if (missing.length) errors.push({ line: r.line, name: r.name, error: `Không thấy ảnh: ${missing.join(', ')} → giữ ảnh cũ.` });
      const v = {
        name: r.name,
        category_id: catId,
        price: r.price,
        compare_price: r.compare_price,
        cost_price: r.cost_price,
        badge: r.badge,
        short_desc: r.short_desc,
        contents: r.contents,
        description: r.description,
        is_featured: r.is_featured,
        is_active: r.is_active,
      };
      // Tồn kho: chỉ áp khi chủ shop SỬA ô tồn kho trong Excel (khác lần gửi trước). Không sửa → web giữ số đang có (đã trừ đơn).
      if (r.stock != null && p && (p.excel_stock == null || Number(p.excel_stock) !== r.stock)) {
        v.stock = r.stock;
        v.excel_stock = r.stock;
      }
      if (r.has.video_url) v.video_url = r.video_url;
      if (r.has.sort) v.sort = r.sort;
      if (r.has.seo_title) v.seo_title = r.seo_title;
      if (r.has.seo_desc) v.seo_desc = r.seo_desc;
      if (r.image && !missing.includes(r.image)) {
        const id = await resolve(r.image, p, r.name);
        if (id) v.image_id = id;
      }
      if (r.gallery.length && !r.gallery.some((g) => missing.includes(g))) {
        const ids = [];
        for (const g of r.gallery) {
          const id = await resolve(g, p, r.name);
          if (id) ids.push(id);
        }
        v.gallery = JSON.stringify(ids);
      } else if (r.has.gallery && !r.gallery.length && p && gallery(p).length) {
        v.gallery = '[]'; // xóa hết tên ảnh phụ trong Excel → bỏ ảnh phụ
      }

      if (!p) {
        let slug = slugify(r.name) || 'gio-qua';
        for (let n = 2; await trx('products').where({ slug }).first('id'); n++) slug = `${slugify(r.name) || 'gio-qua'}-${n}`;
        const sku = r.sku || (await nextSku(trx));
        await trx('products').insert({
          ...v, sku, slug, stock: r.stock || 0, excel_stock: r.stock ?? null, gallery: v.gallery || '[]', sort: v.sort ?? 0, sold: 0,
          created_at: new Date(), updated_at: new Date(),
        });
        result.created.push({ line: r.line, sku, name: r.name });
        continue;
      }
      const changed = Object.keys(v).filter((k) => !same(p[k], v[k]));
      if (!changed.length) { result.unchanged++; continue; }
      const patch = Object.fromEntries(changed.map((k) => [k, v[k]]));
      // đổi tên → đổi luôn đường dẫn, trừ khi trùng sản phẩm khác
      if (patch.name) {
        const slug = slugify(r.name);
        if (slug && slug !== p.slug && !(await trx('products').where({ slug }).whereNot({ id: p.id }).first('id'))) patch.slug = slug;
      }
      await trx('products').where({ id: p.id }).update({ ...patch, updated_at: new Date() });
      result.updated.push({ line: r.line, sku: p.sku, name: r.name, fields: changed });
    }
  });
  result.errors.sort((a, b) => a.line - b.line);
  return result;
}

function gallery(p) {
  try {
    const g = JSON.parse(p.gallery || '[]');
    return Array.isArray(g) ? g.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function same(a, b) {
  if (typeof b === 'boolean') return Boolean(a) === b;
  if (b == null || b === '') return a == null || a === '';
  if (typeof b === 'number') return Number(a) === b;
  return String(a ?? '').replace(/\r\n?/g, '\n').trim() === String(b);
}

/** Mã SP mới dạng LL001… (giống admin), đọc trong giao dịch để không trùng khi thêm nhiều giỏ một lượt. */
async function nextSku(trx) {
  let max = 0;
  for (const r of await trx('products').whereNotNull('sku').select('sku')) {
    const m = /^LL-?(\d+)$/.exec(r.sku || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LL-${String(max + 1).padStart(3, '0')}`;
}

/** File Excel sản phẩm đang có trên web (đúng mẫu nhập) — tool tải về lần đầu để chủ shop sửa tiếp. */
async function exportExcel() {
  const [products, cats] = await Promise.all([
    db('products').select('*').orderBy([{ column: 'sort' }, { column: 'id' }]),
    db('categories').select('id', 'name', 'tagline').orderBy([{ column: 'sort' }, { column: 'id' }]),
  ]);
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  // bỏ 12 giỏ mẫu ban đầu (LL001–LL012) đã ẩn
  const list = products.filter((p) => p.is_active || !/^LL(00[1-9]|01[0-2])$/.test(p.sku || ''));
  const ids = new Set();
  for (const p of list) {
    if (p.image_id) ids.add(p.image_id);
    gallery(p).forEach((g) => ids.add(g));
  }
  const names = Object.fromEntries((ids.size ? await db('media').whereIn('id', [...ids]).select('id', 'filename') : []).map((m) => [m.id, m.filename]));
  const rows = list.map((p) => ({
    sku: p.sku, name: p.name, category: catName[p.category_id] || '', price: p.price, compare_price: p.compare_price, cost_price: p.cost_price,
    cost_note: '', stock: p.stock, badge: p.badge, short_desc: p.short_desc, contents: p.contents, description: p.description,
    image: names[p.image_id] || '', gallery: gallery(p).map((g) => names[g]).filter(Boolean).join(', '),
    is_featured: p.is_featured ? 'Có' : 'Không', is_active: p.is_active ? 'Có' : 'Không', video_url: p.video_url || '',
  }));
  return buildXlsx([
    {
      name: 'Sản phẩm',
      columns: [
        { header: 'Mã SP (để trống nếu chưa có)', key: 'sku', width: 12 },
        { header: 'Tên sản phẩm *', key: 'name', width: 26 },
        { header: 'Danh mục *', key: 'category', width: 22 },
        { header: 'Giá bán (₫) *', key: 'price', type: 'money', width: 14 },
        { header: 'Giá gốc / giá niêm yết (₫)', key: 'compare_price', type: 'money', width: 14 },
        { header: 'GIÁ VỐN (₫) *', key: 'cost_price', type: 'money', width: 14 },
        { header: 'Ghi chú giá vốn (nguồn, ngày báo giá)', key: 'cost_note', width: 20 },
        { header: 'Tồn kho (chỉ dùng khi THÊM giỏ mới) *', key: 'stock', type: 'number', width: 12 },
        { header: 'Nhãn (Bán chạy / Mới / Giới hạn…)', key: 'badge', width: 12 },
        { header: 'Mô tả ngắn (tối đa 300 ký tự)', key: 'short_desc', width: 40 },
        { header: 'Thành phần giỏ — mỗi món một dòng, ghi đủ tên + khối lượng *', key: 'contents', width: 40 },
        { header: 'Mô tả chi tiết', key: 'description', width: 40 },
        { header: 'Tên file ảnh chính (4:5)', key: 'image', width: 22 },
        { header: 'Tên file ảnh phụ (cách nhau dấu phẩy)', key: 'gallery', width: 26 },
        { header: 'Nổi bật trang chủ (Có/Không)', key: 'is_featured', width: 12 },
        { header: 'Đang bán (Có/Không)', key: 'is_active', width: 12 },
        { header: 'Link video giỏ thực tế', key: 'video_url', width: 24 },
      ],
      rows,
    },
    { name: 'Danh mục', columns: [{ header: 'Tên danh mục', key: 'name', width: 26 }, { header: 'Mô tả', key: 'tagline', width: 50 }], rows: cats },
    {
      name: 'Hướng dẫn',
      columns: [{ header: 'Hướng dẫn', key: 't', width: 120 }],
      rows: [
        '1. Sửa xong bấm Lưu (Ctrl+S) → khoảng 10 giây sau web và AI tư vấn (web + Fanpage) tự cập nhật.',
        '2. Mỗi giỏ một dòng. Thêm giỏ mới: thêm dòng, để trống Mã SP (web tự cấp mã).',
        '3. TỒN KHO chỉ dùng khi thêm giỏ mới. Giỏ đã có: web tự trừ khi có đơn; nhập thêm hàng bằng lệnh /nhap trên Telegram.',
        '4. Ngừng bán: ghi "Không" ở cột Đang bán. Xóa dòng khỏi Excel KHÔNG xóa giỏ trên web.',
        '5. Ảnh: bỏ ảnh vào thư mục "anh" cạnh file này, ghi đúng tên file vào cột ảnh. Giữ nguyên tên cũ = giữ ảnh cũ.',
        '6. Danh mục: ghi đúng tên ở sheet "Danh mục".',
        '7. Thành phần ghi đúng món THẬT trong giỏ — AI tư vấn đọc phần này, ghi sai sẽ bị khách khiếu nại.',
      ].map((t) => ({ t })),
    },
  ]);
}

module.exports = { parseRows, syncFromExcel, exportExcel, money, bool };
