/** Kho tri thức AI: chủ shop tự viết / sửa chính sách, quy trình, câu hỏi thường gặp trong admin (/admin/kien-thuc). */
exports.up = async function up(knex) {
  await knex.schema.createTable('ai_knowledge', (t) => {
    t.increments('id');
    t.string('title', 120).notNullable();
    t.text('content').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ai_knowledge');
};
