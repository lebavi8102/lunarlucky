/**
 * Đơn cần xuất VAT + tài khoản nhận tiền đã hiển thị cho khách (lưu lại để đổi Cài đặt không làm sai đơn cũ).
 * pay_account: 'personal' (bán lẻ) | 'company' (xuất VAT)
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.boolean('needs_vat').notNullable().defaultTo(false);
    t.string('vat_company', 200);
    t.string('vat_tax_code', 20);
    t.string('vat_address', 255);
    t.string('vat_email', 190);
    t.string('pay_account', 10);
    t.string('pay_bank_id', 20);
    t.string('pay_bank_name', 80);
    t.string('pay_account_no', 40);
    t.string('pay_holder', 120);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    for (const c of ['needs_vat', 'vat_company', 'vat_tax_code', 'vat_address', 'vat_email', 'pay_account',
      'pay_bank_id', 'pay_bank_name', 'pay_account_no', 'pay_holder']) {
      t.dropColumn(c);
    }
  });
};
