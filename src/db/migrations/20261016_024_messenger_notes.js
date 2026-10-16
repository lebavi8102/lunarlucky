/**
 * AI Fanpage: ghi lại những gì nhân viên và khách nhắn trong lúc AI tạm dừng (để AI nói tiếp không mâu thuẫn),
 * và đếm số tin mỗi ngày của từng khách (chặn spam làm tốn tiền AI).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.text('notes').nullable();
    t.string('day_key', 10).nullable();
    t.integer('day_count').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.dropColumn('notes');
    t.dropColumn('day_key');
    t.dropColumn('day_count');
  });
};
