/**
 * anh_chuan_hoa: ảnh sản phẩm cũ (goc_id) → bản đã chuẩn hóa 1080×1350 (moi_id).
 * Ảnh gốc không bị xóa; bảng này dùng để khôi phục (trỏ sản phẩm về ảnh gốc).
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    if (!(await knex.schema.hasTable('anh_chuan_hoa'))) {
      await knex.schema.createTable('anh_chuan_hoa', (t) => {
        t.increments('id');
        t.integer('goc_id').unsigned().notNullable().unique();
        t.integer('moi_id').unsigned().notNullable();
        t.string('cach', 16);
        t.string('goc_kich', 20);
        t.timestamp('created_at').defaultTo(knex.fn.now());
      });
    }
  } catch (err) {
    console.error('[migration 049] không tạo được bảng anh_chuan_hoa:', err.message);
  }
};

exports.down = async function down() {};
