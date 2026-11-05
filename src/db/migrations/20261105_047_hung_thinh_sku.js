/**
 * Chủ shop chốt (05/11/2026): file Excel sản phẩm của chủ shop là bản gốc. Trong file, mã LL-008 là "Giỏ Tài Lộc",
 * còn "Giỏ Hưng Thịnh" là LL-015 → đổi mã giỏ Hưng Thịnh trên web cho khớp, để đồng bộ Excel không ghi đè nhầm giỏ.
 * Chỉ đổi khi LL-008 trên web vẫn là Hưng Thịnh và LL-015 chưa ai dùng. Lỗi không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    const p = await knex('products').where({ sku: 'LL-008' }).first('id', 'name');
    const taken = await knex('products').where({ sku: 'LL-015' }).first('id');
    if (p && String(p.name).normalize('NFC').trim() === 'Giỏ Hưng Thịnh' && !taken) {
      await knex('products').where({ id: p.id }).update({ sku: 'LL-015' });
    }
  } catch (err) {
    console.error('[migration 047] không đổi được mã giỏ Hưng Thịnh:', err.message);
  }
};

exports.down = async function down() {};
