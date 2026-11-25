/**
 * Đối soát với nhà cung cấp (chủ shop 25/11/2026): nhà cung cấp giữ hàng + nhận tiền khách vào tài khoản của họ,
 * chủ shop chạy quảng cáo + bán. Mỗi tuần chốt: tiền khách trả − tiền hàng theo giá nhập = phần nhà cung cấp chuyển lại.
 * - products.cost_price_si: giá nhập SỈ (cột "Giá nhập sỉ" trong Excel); cost_price giữ là giá nhập LẺ
 * - orders.settlement_id: đơn đã vào kỳ đối soát nào (đã chốt thì khóa, không tính lại)
 * - supplier_settlements: mỗi kỳ đã chốt
 */
exports.up = async function up(knex) {
  const isMysql = knex.client.config.client === 'mysql2';
  await knex.schema.alterTable('products', (t) => {
    t.integer('cost_price_si').unsigned().nullable();
  });
  await knex.schema.alterTable('orders', (t) => {
    t.integer('settlement_id').unsigned().nullable().index();
  });
  await knex.schema.createTable('supplier_settlements', (t) => {
    if (isMysql) {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_unicode_ci');
    }
    t.increments('id');
    t.string('period_from', 10).notNullable();
    t.string('period_to', 10).notNullable();
    t.integer('orders_count').unsigned().notNullable().defaultTo(0);
    t.bigInteger('revenue').notNullable().defaultTo(0); // tổng khách trả (vào tài khoản / tiền mặt nhà cung cấp)
    t.bigInteger('cost').notNullable().defaultTo(0); // tổng tiền hàng theo giá nhập
    t.bigInteger('owner_due').notNullable().defaultTo(0); // nhà cung cấp chuyển lại chủ shop
    t.string('status', 20).notNullable().defaultTo('closed'); // closed = đã chốt chờ tiền · received = đã nhận tiền
    t.timestamp('received_at').nullable();
    t.string('note', 300).nullable();
    t.string('created_by', 120).nullable();
    t.timestamps(true, true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('supplier_settlements');
  await knex.schema.alterTable('orders', (t) => t.dropColumn('settlement_id'));
  await knex.schema.alterTable('products', (t) => t.dropColumn('cost_price_si'));
};
