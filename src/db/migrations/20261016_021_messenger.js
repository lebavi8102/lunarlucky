/** AI tư vấn trên Fanpage: lịch sử trò chuyện theo từng khách Messenger + link đặt hàng gửi qua Messenger. */
exports.up = async function up(knex) {
  await knex.schema.createTable('messenger_threads', (t) => {
    t.string('psid', 64).primary();
    t.text('history', 'longtext');
    t.bigInteger('paused_until_ms').notNullable().defaultTo(0); // người thật đang trả lời → AI im đến lúc này
    t.bigInteger('updated_ms').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('ai_handoffs', (t) => {
    t.string('token', 40).primary();
    t.text('data', 'mediumtext');
    t.bigInteger('expires_ms').notNullable().index();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ai_handoffs');
  await knex.schema.dropTableIfExists('messenger_threads');
};
