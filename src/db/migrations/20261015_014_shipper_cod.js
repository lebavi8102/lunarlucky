/** Bàn giao người xử lý ↔ shipper: ai đang giao, ai đã thu tiền COD (bao nhiêu, lúc nào). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('shipper', 80).nullable();
    t.string('cod_collected_by', 80).nullable();
    t.integer('cod_collected_amount').nullable();
    t.timestamp('cod_collected_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('shipper');
    t.dropColumn('cod_collected_by');
    t.dropColumn('cod_collected_amount');
    t.dropColumn('cod_collected_at');
  });
};
