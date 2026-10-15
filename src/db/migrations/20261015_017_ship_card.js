/** Thẻ giao hàng trong chủ đề SHIPPER (tách khỏi tin đơn chính): nhớ tin để sửa khi đổi trạng thái. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('tg_ship_chat_id', 32).nullable();
    t.integer('tg_ship_message_id').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('tg_ship_chat_id');
    t.dropColumn('tg_ship_message_id');
  });
};
