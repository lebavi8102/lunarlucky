/** Buổi giao mong muốn (Hà Nội): sang | chieu | toi; trống = buổi nào cũng được. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('delivery_slot', 10).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('delivery_slot');
  });
};
