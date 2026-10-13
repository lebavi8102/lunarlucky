/** Lịch sử xử lý đơn + tin nhắn Telegram tương ứng (để cập nhật nút xử lý). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.text('handled_log');
    t.string('tg_chat_id', 30);
    t.bigInteger('tg_message_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('handled_log');
    t.dropColumn('tg_chat_id');
    t.dropColumn('tg_message_id');
  });
};
