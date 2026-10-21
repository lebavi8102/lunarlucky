/** Nhật ký lỗi chatbot AI (web + Fanpage) để chủ shop xem trong admin (/admin/ai-loi) thay vì phải mở log Render. */
exports.up = async function up(knex) {
  await knex.schema.createTable('ai_errors', (t) => {
    t.increments('id');
    t.string('kind', 30).notNullable().index();
    t.string('channel', 12).notNullable().defaultTo('web'); // web | messenger
    t.string('model', 40).nullable();
    t.integer('status').nullable(); // mã HTTP của Claude / Facebook
    t.string('message', 400).notNullable().defaultTo('');
    t.string('ref', 40).nullable(); // vd "fb…a1b2": 4 số cuối mã khách Fanpage, không lưu mã đầy đủ
    t.integer('count').notNullable().defaultTo(1); // lỗi giống nhau liên tiếp gộp lại
    t.timestamp('created_at').nullable();
    t.timestamp('last_at').nullable().index();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ai_errors');
};
