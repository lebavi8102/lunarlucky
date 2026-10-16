/** Đơn đặt từ AI Fanpage: nhớ người nhắn Messenger → gửi xác nhận đơn, nhắc chuyển khoản, báo đã nhận tiền qua Messenger. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('messenger_psid', 64).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('messenger_psid');
  });
};
