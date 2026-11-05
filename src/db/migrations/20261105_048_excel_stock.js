/**
 * products.excel_stock: số tồn kho trong file Excel của chủ shop ở lần đồng bộ gần nhất.
 * Đồng bộ chỉ đặt lại tồn kho khi chủ shop sửa ô này trong Excel; không sửa thì web giữ số đã trừ theo đơn.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    if (!(await knex.schema.hasColumn('products', 'excel_stock'))) {
      await knex.schema.alterTable('products', (t) => { t.integer('excel_stock'); });
    }
  } catch (err) {
    console.error('[migration 048] không thêm được cột excel_stock:', err.message);
  }
};

exports.down = async function down() {};
