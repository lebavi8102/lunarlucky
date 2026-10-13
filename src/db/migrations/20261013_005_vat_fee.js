/** Phí xuất hóa đơn VAT (khách chịu, cộng vào tổng đơn) và tỉ lệ % áp dụng lúc đặt. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.integer('vat_fee').unsigned().notNullable().defaultTo(0);
    t.decimal('vat_fee_percent', 5, 2);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('vat_fee');
    t.dropColumn('vat_fee_percent');
  });
};
