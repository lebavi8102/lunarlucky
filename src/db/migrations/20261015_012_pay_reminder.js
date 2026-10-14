/** Email nhắc khách chuyển khoản/cọc trước khi đơn tự hủy: chỉ nhắc 1 lần. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.timestamp('pay_reminded_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('pay_reminded_at');
  });
};
