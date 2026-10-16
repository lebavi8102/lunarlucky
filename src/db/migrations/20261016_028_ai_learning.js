/** AI học từ cách nhân viên tư vấn: nhật ký hội thoại Fanpage + bài học (chờ duyệt / đã duyệt). */
exports.up = async function up(knex) {
  await knex.schema.createTable('conv_log', (t) => {
    t.increments('id');
    t.string('psid', 64).notNullable();
    t.string('role', 10).notNullable(); // customer | ai | staff
    t.text('text');
    t.bigInteger('created_ms').notNullable().defaultTo(0);
    t.index(['psid', 'created_ms']);
    t.index(['role', 'created_ms']);
  });
  await knex.schema.createTable('ai_lessons', (t) => {
    t.increments('id');
    t.string('text', 500).notNullable();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.string('source', 20);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.bigInteger('learned_ms').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('conv_log');
  await knex.schema.dropTableIfExists('ai_lessons');
  await knex.schema.alterTable('messenger_threads', (t) => { t.dropColumn('learned_ms'); });
};
