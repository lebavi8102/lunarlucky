/** Kênh của đơn (website, Facebook, Zalo, Instagram, TikTok, điện thoại…) + nhân viên đặt hộ. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('source', 20).nullable();
    t.string('created_by', 80).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('source');
    t.dropColumn('created_by');
  });
};
