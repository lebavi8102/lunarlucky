/** Điều chỉnh giá khi chủ shop đặt hộ (khách đổi món): số dương = tăng, âm = giảm, kèm lý do. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.integer('adjustment').notNullable().defaultTo(0);
    t.string('adjustment_note', 200).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('adjustment');
    t.dropColumn('adjustment_note');
  });
};
