/**
 * Trả lời khách Fanpage ngay trong Telegram:
 * - tg_fb_links: tin Telegram nào (cảnh báo / tin khách chuyển về) thuộc khách Fanpage nào → nhân viên trả lời (reply) tin đó là nhắn khách.
 * - messenger_threads.relay_until_ms: đến lúc này, tin khách nhắn (khi AI tạm dừng) được chuyển về Telegram.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('tg_fb_links', (t) => {
    t.increments('id');
    t.string('chat_id', 32).notNullable();
    t.bigInteger('message_id').notNullable();
    t.string('psid', 64).notNullable();
    t.bigInteger('created_ms').notNullable().index();
    t.index(['chat_id', 'message_id']);
  });
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.bigInteger('relay_until_ms').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => { t.dropColumn('relay_until_ms'); });
  await knex.schema.dropTableIfExists('tg_fb_links');
};
