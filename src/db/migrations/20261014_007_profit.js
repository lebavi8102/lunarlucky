/**
 * Báo cáo lợi nhuận:
 * - products.cost_price: giá vốn (giá nhập) mỗi sản phẩm
 * - order_items.unit_cost: giá vốn lưu lại lúc đặt (đổi giá nhập sau này không làm sai số đơn cũ)
 * - expenses: chi phí vận hành (ship, bao bì, quảng cáo, hosting...)
 */
exports.up = async function up(knex) {
  const isMysql = knex.client.config.client === 'mysql2';
  await knex.schema.alterTable('products', (t) => {
    t.integer('cost_price').unsigned().nullable();
  });
  await knex.schema.alterTable('order_items', (t) => {
    t.integer('unit_cost').unsigned().nullable();
  });
  await knex.schema.createTable('expenses', (t) => {
    if (isMysql) {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_unicode_ci');
    }
    t.increments('id');
    t.string('spent_on', 10).notNullable(); // YYYY-MM-DD (giờ VN), lưu dạng chuỗi để không lệch múi giờ
    t.string('category', 60).notNullable();
    t.integer('amount').unsigned().notNullable();
    t.string('note', 300);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['spent_on']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('expenses');
  await knex.schema.alterTable('order_items', (t) => {
    t.dropColumn('unit_cost');
  });
  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('cost_price');
  });
};
