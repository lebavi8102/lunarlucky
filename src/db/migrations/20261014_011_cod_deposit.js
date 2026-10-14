/** Đặt cọc cho đơn COD (đơn từ 2 giỏ hoặc trên 1 triệu): số tiền cọc + thời điểm nhận cọc. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.integer('deposit_amount').unsigned().notNullable().defaultTo(0);
    t.timestamp('deposit_paid_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('deposit_amount');
    t.dropColumn('deposit_paid_at');
  });
};
