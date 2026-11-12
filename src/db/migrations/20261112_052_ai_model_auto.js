/**
 * Chủ shop chốt 12/11/2026 (chuẩn bị chạy quảng cáo): bot AI tư vấn dùng chế độ "auto"
 * — ngày ít khách dùng Sonnet (rẻ hơn ~40%), số tin trong ngày vượt ai_busy_from thì tự chuyển Opus.
 * Lỗi 400 ở Sonnet tự thử lại bằng Opus (ai-sales.js), nên không làm bot im.
 * Chỉ đổi khi web thật vẫn để mặc định Opus hoặc chưa có dòng cài đặt; chủ shop đã tự chọn khác thì giữ nguyên.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'ai_model' }).first();
  if (!row) await knex('settings').insert({ key: 'ai_model', value: 'auto' });
  else if (['', 'claude-opus-5-5'].includes(String(row.value || '').trim())) {
    await knex('settings').where({ key: 'ai_model' }).update({ value: 'auto' });
  }
};

exports.down = async function down(knex) {
  await knex('settings').where({ key: 'ai_model', value: 'auto' }).update({ value: 'claude-opus-5-5' });
};
