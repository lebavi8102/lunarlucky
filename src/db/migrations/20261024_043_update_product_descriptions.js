/**
 * Chủ shop gửi file Excel mới (24/10/2026): cập nhật CHỈ "Mô tả ngắn" và "Mô tả chi tiết" của 7 giỏ quà thật; mọi cột khác giữ nguyên.
 * Chỉ ghi đè khi mô tả trên web vẫn đúng là bản nhập ngày 22/10 — nếu chủ shop đã tự sửa trong admin thì giữ nguyên, ghi log.
 * Khớp theo tên + đang bán (bản mẫu bị ẩn trùng tên không bị đụng). Lỗi ở đây không được làm web sập khi khởi động.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'seed-data', 'real-products-2026-10', 'descriptions-2026-10-24.json');
const norm = (v) => String(v || '').normalize('NFC').replace(/\r\n/g, '\n').trim();

exports.up = async function up(knex) {
  try {
    const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const it of items) {
      const row = await knex('products').where({ name: it.name, is_active: true }).first();
      if (!row) continue;
      const same = norm(row.short_desc) === norm(it.old_short_desc) && norm(row.description) === norm(it.old_description);
      if (!same) {
        console.log(`[migration 043] "${it.name}" đã được sửa trong admin, giữ nguyên mô tả.`);
        continue;
      }
      await knex('products').where({ id: row.id }).update({ short_desc: it.short_desc, description: it.description });
    }
  } catch (err) {
    console.error('[migration 043] không cập nhật được mô tả sản phẩm, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
