/** Khách Fanpage đã chốt với AI (có link đặt hàng) mà chưa đặt → nhắc nhóm gọi lại. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('ai_handoffs', (t) => {
    t.string('psid', 64).nullable().index();
    t.bigInteger('created_ms').notNullable().defaultTo(0);
    t.boolean('followed').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('ai_handoffs', (t) => {
    t.dropColumn('psid');
    t.dropColumn('created_ms');
    t.dropColumn('followed');
  });
};
