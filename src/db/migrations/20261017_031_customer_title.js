/** AI Fanpage: khách cho biết là anh hay chị → lưu lại để xưng hô đúng cả những lần nhắn sau. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.string('title', 10).nullable(); // 'anh' | 'chị'
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => { t.dropColumn('title'); });
};
