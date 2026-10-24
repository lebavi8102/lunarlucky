/**
 * orders.cta: nút khách bấm gần nhất trước khi đặt ('buy_now' | 'add_to_cart') — để đo đơn GIAO THÀNH CÔNG theo nút, không chỉ số lần bấm.
 * products.video_url: link video giỏ thực tế (YouTube / TikTok / Facebook / file mp4), nhập trong admin.
 * Thêm cột, không đổi dữ liệu cũ; lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    if (!(await knex.schema.hasColumn('orders', 'cta'))) {
      await knex.schema.alterTable('orders', (t) => { t.string('cta', 16); });
    }
    if (!(await knex.schema.hasColumn('products', 'video_url'))) {
      await knex.schema.alterTable('products', (t) => { t.string('video_url', 500); });
    }
  } catch (err) {
    console.error('[migration 042] không thêm được cột cta/video_url:', err.message);
  }
};

exports.down = async function down() {};
