/**
 * Đưa 7 sản phẩm thật (từ file Excel chủ shop, 22/10/2026) lên web và ẩn 12 sản phẩm mẫu (mã LL001–LL012).
 * - Chạy một lần; sản phẩm đã có mã SKU thì bỏ qua (chạy lại không tạo trùng).
 * - Sản phẩm mẫu chỉ bị ẩn, không xóa (đơn cũ vẫn trỏ tới được); mẫu trùng tên với sản phẩm mới được đổi đường dẫn thêm "-mau".
 * - Kho mã này công khai nên KHÔNG chứa giá nhập: giá vốn nhập riêng trong admin (Sản phẩm → Giá vốn).
 */
const fs = require('fs');
const path = require('path');
const { slugify } = require('../../lib/format');

const DIR = path.join(__dirname, '..', 'seed-data', 'real-products-2026-10');
const idOf = (r) => (r && typeof r === 'object' ? r.id : r);

/** Lỗi trong migration làm server không khởi động được → bắt lại: ghi log, giao dịch tự hoàn tác, web vẫn chạy như cũ. */
exports.up = async function up(knex) {
  try {
    await importAll(knex);
  } catch (err) {
    console.error('[migration 036] không nhập được sản phẩm thật, giữ nguyên dữ liệu cũ:', err.message);
  }
};

async function importAll(knex) {
  const items = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf8'));
  const cats = Object.fromEntries((await knex('categories').select('id', 'name')).map((c) => [c.name.trim(), c.id]));
  const newNames = new Set(items.map((i) => i.name.trim()));

  await knex.transaction(async (trx) => {
    // 1. ẩn sản phẩm mẫu, nhường đường dẫn cho sản phẩm thật cùng tên
    const samples = (await trx('products').select('id', 'sku', 'name', 'slug')).filter((p) => /^LL\d{3}$/.test(p.sku || ''));
    for (const s of samples) {
      const change = { is_active: false, updated_at: new Date() };
      if (newNames.has(String(s.name).trim()) && !String(s.slug).endsWith('-mau')) change.slug = `${s.slug}-mau`;
      await trx('products').where({ id: s.id }).update(change);
    }

    // 2. thêm sản phẩm thật (kèm ảnh vào bảng media)
    for (const it of items) {
      if (await trx('products').where({ sku: it.sku }).first()) continue;
      const data = fs.readFileSync(path.join(DIR, it.file));
      const mediaId = idOf((await trx('media').insert({ filename: it.file, mime: 'image/webp', size: data.length, alt: it.name, data }))[0]);
      let slug = slugify(it.name);
      for (let n = 2; await trx('products').where({ slug }).first(); n++) slug = `${slugify(it.name)}-${n}`;
      await trx('products').insert({
        category_id: cats[it.category] || null, name: it.name, slug, sku: it.sku, // không thấy danh mục → để trống, chủ shop chọn lại trong admin
        short_desc: it.short_desc || null, description: it.description || null, contents: it.contents || null,
        price: it.price, compare_price: it.compare_price || null, stock: it.stock || 0, badge: it.badge || null,
        image_id: mediaId, gallery: '[]', is_featured: !!it.is_featured, is_active: !!it.is_active, sort: it.sort || 0, sold: 0,
        seo_title: it.seo_title || null, seo_desc: it.seo_desc || null,
        created_at: new Date(), updated_at: new Date(),
      });
    }
  });
}

exports.down = async function down(knex) {
  const items = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf8'));
  await knex.transaction(async (trx) => {
    for (const it of items) {
      const p = await trx('products').where({ sku: it.sku }).first();
      if (!p) continue;
      await trx('products').where({ id: p.id }).del();
      if (p.image_id) await trx('media').where({ id: p.image_id }).del();
    }
    for (const s of (await trx('products').select('id', 'sku', 'slug')).filter((p) => /^LL\d{3}$/.test(p.sku || ''))) {
      await trx('products').where({ id: s.id }).update({ is_active: true, slug: String(s.slug).replace(/-mau$/, '') });
    }
  });
};
