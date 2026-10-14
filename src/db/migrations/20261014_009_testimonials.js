/** "Khách đã nhận quà": ảnh giao hàng thật + lời nhận xét (chỉ hiện khi đã duyệt). */
exports.up = async function up(knex) {
  const isMysql = knex.client.config.client === 'mysql2';
  await knex.schema.createTable('testimonials', (t) => {
    if (isMysql) {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_unicode_ci');
    }
    t.increments('id');
    t.string('customer_name', 120).notNullable(); // hiển thị, VD: "Chị Lan · Cầu Giấy"
    t.string('content', 400); // lời nhận xét (không bắt buộc)
    t.integer('image_id').unsigned().nullable();
    t.integer('product_id').unsigned().nullable();
    t.string('order_code', 20);
    t.boolean('is_active').notNullable().defaultTo(false); // chờ duyệt: chỉ đăng khi khách đồng ý
    t.integer('sort').notNullable().defaultTo(0);
    t.string('source', 20); // admin | telegram
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('testimonials');
};
