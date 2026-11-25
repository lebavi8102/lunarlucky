/**
 * Soát web 25/11/2026: tên giỏ có dấu cách thừa ("Hộp Quà  Xuân Hỷ") → gộp về một dấu cách, bỏ cách ở đầu/cuối.
 * Chỉ sửa tên đang có dấu cách thừa, không đụng tên khác.
 */
exports.up = async function up(knex) {
  const rows = await knex('products').select('id', 'name');
  for (const r of rows) {
    const clean = String(r.name || '').replace(/\s+/g, ' ').trim();
    if (clean && clean !== r.name) await knex('products').where({ id: r.id }).update({ name: clean });
  }
};

exports.down = async function down() {};
