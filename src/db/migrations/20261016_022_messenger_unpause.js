/** Sửa lỗi: tin của chính AI bị hiểu nhầm là người thật trả lời → AI im. Mở lại cho các khách bị dừng nhầm. */
exports.up = async function up(knex) {
  await knex('messenger_threads').update({ paused_until_ms: 0 });
};

exports.down = async function down() {};
