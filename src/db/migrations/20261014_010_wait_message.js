/** Tin "⏳ chờ chuyển khoản" trong nhóm Telegram (để sửa thành "đã nhận tiền"/"tự hủy" sau). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.bigInteger('tg_wait_message_id').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('tg_wait_message_id');
  });
};
