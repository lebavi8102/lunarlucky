/**
 * Chủ shop chốt 17/10: từ 5 giỏ trở lên AI chuyển nhân viên chốt giá ngay (trước là 20).
 * Chỉ đổi khi web thật vẫn để mức cũ 20; chủ shop đã tự đổi số khác thì giữ nguyên.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'ai_escalate_qty' }).first();
  if (row && String(row.value) === '20') await knex('settings').where({ key: 'ai_escalate_qty' }).update({ value: '5' });
};

exports.down = async function down() {};
