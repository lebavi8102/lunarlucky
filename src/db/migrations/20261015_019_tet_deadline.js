/**
 * Chủ shop chốt bán đến 29 tháng Chạp (05/02/2027), không phải 30/01.
 * Web thật đang lưu 2027-01-30 (lưu Cài đặt trước khi đổi) → sửa lại, kèm cách gọi âm lịch.
 * Chỉ sửa khi vẫn là giá trị cũ; nếu chủ shop đã tự đổi sang ngày khác thì giữ nguyên.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'order_deadline' }).first();
  if (!row || row.value !== '2027-01-30') return;
  await knex('settings').where({ key: 'order_deadline' }).update({ value: '2027-02-05' });
  const label = await knex('settings').where({ key: 'order_deadline_label' }).first();
  if (!label) await knex('settings').insert({ key: 'order_deadline_label', value: '29 tháng Chạp' });
  else if (!String(label.value || '').trim()) await knex('settings').where({ key: 'order_deadline_label' }).update({ value: '29 tháng Chạp' });
};

exports.down = async function down() {};
