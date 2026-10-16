/** Tên Facebook của khách Messenger → AI gọi đúng "anh/chị + tên". */
exports.up = async function up(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.string('name', 120).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.dropColumn('name');
  });
};
