/**
 * Kiểm thử chuẩn hóa ảnh sản phẩm (ảnh mới + ảnh đang có), trên database local tạm.
 * Chạy: SQLITE_FILE=<bản sao>.sqlite node test/chuan-hoa-anh.js [thư mục ảnh thật]
 */
delete process.env.DATABASE_URL;
process.env.DB_CLIENT = 'better-sqlite3';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
if (db.isMysql) { console.error('Chỉ chạy với database local.'); process.exit(1); }
const { chuanHoa, kichThuoc, init } = require('../src/lib/chuan-hoa-anh');
const hl = require('../src/lib/chuan-hoa-hang-loat');
const { saveFile } = require('../src/lib/media');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };

async function jpeg(w, h) {
  const enc = (await init()).encode;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = (i % w) * 255 / w; d[i * 4 + 1] = 120; d[i * 4 + 2] = 200; d[i * 4 + 3] = 255; }
  return Buffer.from(await enc({ data: d, width: w, height: h }, { quality: 80 }));
}

(async () => {
  await db.migrate.latest();
  ok(await db.schema.hasTable('anh_chuan_hoa'), 'có bảng anh_chuan_hoa');

  // 1. ảnh tổng hợp nhiều tỉ lệ
  for (const [w, h] of [[1086, 1448], [941, 1672], [1263, 1170], [1080, 1350], [400, 300]]) {
    const r = await chuanHoa(await jpeg(w, h));
    const k = kichThuoc(r.data);
    ok(k.w === 1080 && k.h === 1350, `${w}×${h} → ${k.w}×${k.h} (${r.cach})`);
  }

  // 2. saveFile có/không chuẩn hóa
  const buf = await jpeg(1024, 1536);
  const a = await saveFile({ buffer: buf, size: buf.length, originalname: 'thu-a.jpg' }, 'thu', { chuanHoa: true });
  const b = await saveFile({ buffer: buf, size: buf.length, originalname: 'thu-b.jpg' }, 'thu');
  const ma = await db('media').where({ id: a }).first();
  const mb = await db('media').where({ id: b }).first();
  ok(kichThuoc(ma.data).h === 1350 && ma.filename === 'thu-a.jpg', 'ảnh sản phẩm tải lên → 1080×1350, giữ tên tệp');
  ok(kichThuoc(mb.data).h === 1536, 'ảnh không phải sản phẩm giữ nguyên');

  // 3. hàng loạt: sản phẩm thử dùng ảnh thật (nếu có) + ảnh tổng hợp
  const dir = process.argv[2];
  const goc = [];
  const files = dir ? fs.readdirSync(dir).filter((f) => f.startsWith('goc_')).slice(0, 3) : [];
  for (const f of files) {
    const d = fs.readFileSync(path.join(dir, f));
    goc.push(await saveFile({ buffer: d, size: d.length, originalname: f + '.jpg' }, 'thật'));
  }
  const s1 = await jpeg(941, 1672); const s2 = await jpeg(1080, 1350);
  goc.push(await saveFile({ buffer: s1, size: s1.length, originalname: 'cao.jpg' }, 'x'));
  const da = await saveFile({ buffer: s2, size: s2.length, originalname: 'dung.jpg' }, 'x');
  const p0 = await db('products').first();
  const pid = (await db('products').insert({ ...p0, id: undefined, slug: 'thu-chuan-hoa-' + Date.now(), sku: null, name: 'ZZ thử chuẩn hóa', image_id: goc[0], gallery: JSON.stringify([...goc.slice(1), da]) }))[0];
  const pidN = typeof pid === 'object' ? pid.id : pid;

  const ds = (await hl.danhSach()).filter((r) => r.sanPham.includes('ZZ thử chuẩn hóa'));
  ok(ds.length === goc.length + 1, `danh sách có ${ds.length} ảnh của sản phẩm thử`);
  ok(ds.find((r) => r.id === da).cach === 'da-chuan', 'ảnh đã 1080×1350 không cần làm');
  const t0 = Date.now();
  const r1 = await hl.apDung(ds.map((r) => r.id));
  console.log(`   áp dụng ${r1.lam} ảnh trong ${Date.now() - t0} ms`);
  ok(r1.lam === goc.length && r1.boQua === 1, `áp dụng: làm ${r1.lam}, bỏ qua ${r1.boQua}`);
  let p = await db('products').where({ id: pidN }).first();
  const g = JSON.parse(p.gallery);
  ok(p.image_id !== goc[0] && g[g.length - 1] === da && g.length === goc.length, 'sản phẩm trỏ sang ảnh mới, ảnh đã chuẩn giữ nguyên, đúng thứ tự');
  const moi = await db('media').where({ id: p.image_id }).first();
  ok(moi.filename === files.concat('cao')[0] + (files.length ? '.jpg' : '.jpg') && kichThuoc(moi.data).h === 1350, 'ảnh mới giữ tên tệp gốc, 1080×1350');
  ok(await db('media').where({ id: goc[0] }).first('id'), 'ảnh gốc vẫn còn');
  const r2 = await hl.apDung(JSON.parse(p.gallery).concat(p.image_id));
  ok(r2.lam === 0, 'chạy lại không tạo thêm ảnh');

  const r3 = await hl.khoiPhuc();
  p = await db('products').where({ id: pidN }).first();
  ok(r3.sanPham >= 1 && p.image_id === goc[0] && JSON.parse(p.gallery).join() === [...goc.slice(1), da].join(), 'khôi phục: trở về đúng ảnh gốc');
  const nMedia = (await db('media').count({ n: '*' }).first()).n;
  const r4 = await hl.apDung(goc);
  ok(r4.lam === goc.length && (await db('media').count({ n: '*' }).first()).n === nMedia, 'áp dụng lại sau khôi phục dùng lại ảnh đã làm, không tạo mới');

  console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt');
  await db.destroy();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
