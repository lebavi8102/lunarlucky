/** Báo giá doanh nghiệp: giao 1 hay nhiều địa chỉ, số điểm giao, khu vực giao, giỏ khách đã chọn trên web. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('quotes', (t) => {
    t.string('delivery_mode', 10).nullable(); // 'one' | 'many'
    t.integer('delivery_points').unsigned().nullable();
    t.string('delivery_area', 500).nullable();
    t.text('cart_summary').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('quotes', (t) => {
    t.dropColumn('delivery_mode');
    t.dropColumn('delivery_points');
    t.dropColumn('delivery_area');
    t.dropColumn('cart_summary');
  });
};
