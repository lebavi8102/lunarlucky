/** Yêu cầu "Để lại SĐT – Lunar Lucky gọi lại" (khách cần gấp / chưa biết chọn). */
exports.up = async function up(knex) {
  const isMysql = knex.client.config.client === 'mysql2';
  await knex.schema.createTable('callback_requests', (t) => {
    if (isMysql) {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_unicode_ci');
    }
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('phone', 20).notNullable();
    t.integer('product_id').unsigned().nullable();
    t.string('interest', 500); // giỏ khách đang xem / trong giỏ hàng
    t.string('note', 300);
    t.string('source', 20); // san-pham | gio-hang | thanh-toan
    t.string('status', 10).notNullable().defaultTo('new'); // new | done
    t.string('handled_by', 120);
    t.string('tg_chat_id', 40);
    t.bigInteger('tg_message_id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('callback_requests');
};
