/**
 * Giao dịch tiền vào từ SePay (tự xác nhận chuyển khoản).
 * id = mã giao dịch SePay → chống xử lý trùng khi SePay gửi lại.
 */
exports.up = async (knex) => {
  await knex.schema.createTable('bank_transactions', (t) => {
    t.string('id', 64).primary();
    t.string('provider', 20).notNullable().defaultTo('sepay');
    t.bigInteger('amount').notNullable().defaultTo(0);
    t.string('content', 500);
    t.string('reference', 100);
    t.integer('order_id').unsigned().nullable();
    t.string('result', 40);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('orders', (t) => {
    t.timestamp('paid_at').nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('bank_transactions');
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('paid_at');
  });
};
