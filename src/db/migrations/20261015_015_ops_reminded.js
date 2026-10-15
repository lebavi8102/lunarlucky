/** Nhắc "đơn mới quá 2 giờ chưa ai xác nhận" chỉ 1 lần mỗi đơn. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.timestamp('ops_reminded_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('ops_reminded_at');
  });
};
