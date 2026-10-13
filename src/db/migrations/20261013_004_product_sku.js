/** Mã SP (dùng chung cho web, admin và lệnh kho trên Telegram). Sản phẩm cũ được cấp mã LL001, LL002… */
exports.up = async function up(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.string('sku', 40).unique();
  });
  const rows = await knex('products').select('id').orderBy('id');
  for (const r of rows) {
    await knex('products').where({ id: r.id }).update({ sku: `LL${String(r.id).padStart(3, '0')}` });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropUnique(['sku']);
    t.dropColumn('sku');
  });
};
