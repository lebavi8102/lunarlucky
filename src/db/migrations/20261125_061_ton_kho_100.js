/**
 * Chủ shop chốt 25/11/2026: tồn kho mỗi giỏ để 100 (trước đó cả 45 giỏ đều 5 → web chặn mua quá 5 giỏ/mẫu
 * và mọi giỏ hiện "Chỉ còn 5 giỏ"). Chỉ sửa giỏ đang còn đúng 5 (giá trị nhập ban đầu), không đụng giỏ đã chỉnh tay.
 * Sau này chỉnh từng giỏ: admin Sản phẩm, đồng bộ Excel, hoặc lệnh kho trên Telegram.
 */
exports.up = async function up(knex) {
  await knex('products').where({ stock: 5 }).update({ stock: 100 });
};

exports.down = async function down() {};
