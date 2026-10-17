/**
 * Voucher riêng để AI tư vấn tặng khi khách mặc cả lần 2 / so sánh giá (give_voucher).
 * Giữ lợi nhuận: giảm cố định 50.000₫ (không theo %), chỉ đơn từ 1.000.000₫ (giỏ rẻ biên mỏng không áp),
 * tối đa 300 lượt, hết hạn cùng hạn chốt đơn. Miễn phí giao tính trên tiền SAU giảm nên không mất thêm phí ship.
 * Chỉ gắn vào ai_voucher_code khi chủ shop chưa tự đặt mã khác.
 */
const CODE = 'QUARIENG50';

exports.up = async function up(knex) {
  const exists = await knex('coupons').whereRaw('UPPER(code) = ?', [CODE]).first();
  if (!exists) {
    await knex('coupons').insert({
      code: CODE,
      description: 'Voucher riêng AI tư vấn tặng khi khách mặc cả (giảm 50k, đơn từ 1 triệu)',
      type: 'fixed',
      value: 50000,
      min_order: 1000000,
      max_discount: null,
      max_uses: 300,
      used_count: 0,
      starts_at: null,
      ends_at: '2027-02-05',
      is_active: true,
    });
  }
  const row = await knex('settings').where({ key: 'ai_voucher_code' }).first();
  if (!row) await knex('settings').insert({ key: 'ai_voucher_code', value: CODE });
  else if (!String(row.value || '').trim()) await knex('settings').where({ key: 'ai_voucher_code' }).update({ value: CODE });
};

exports.down = async function down() {};
