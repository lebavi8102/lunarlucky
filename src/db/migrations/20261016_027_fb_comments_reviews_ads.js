/**
 * Bot bình luận Facebook (fb_comments: mỗi bình luận xử lý 1 lần), bot xin đánh giá sau giao (orders.completed_at,
 * review_requested_at, testimonials.rating), báo cáo quảng cáo (quảng cáo nào đưa khách vào Messenger → ra đơn).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('fb_comments', (t) => {
    t.string('comment_id', 80).primary();
    t.string('post_id', 80).nullable().index();
    t.string('from_id', 64).nullable().index();
    t.string('from_name', 120).nullable();
    t.string('message', 500).nullable();
    t.string('action', 20).nullable(); // reply | phone | skip
    t.string('psid', 64).nullable();
    t.bigInteger('created_ms').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('orders', (t) => {
    t.timestamp('completed_at').nullable();
    t.timestamp('review_requested_at').nullable();
    t.string('ad_id', 40).nullable().index();
  });
  await knex.schema.alterTable('testimonials', (t) => {
    t.integer('rating').nullable();
  });
  await knex.schema.alterTable('messenger_threads', (t) => {
    t.string('ad_id', 40).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fb_comments');
  await knex.schema.alterTable('orders', (t) => { t.dropColumn('completed_at'); t.dropColumn('review_requested_at'); t.dropColumn('ad_id'); });
  await knex.schema.alterTable('testimonials', (t) => { t.dropColumn('rating'); });
  await knex.schema.alterTable('messenger_threads', (t) => { t.dropColumn('ad_id'); });
};
