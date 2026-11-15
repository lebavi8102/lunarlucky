/**
 * Chủ shop chốt 15/11/2026: bot tư vấn chuyển sang Claude Haiku cho rẻ và nhanh (Opus đắt, mùa Tết tin nhắn nhiều).
 * Haiku lỗi yêu cầu (400) → ai-sales.js tự thử lại bằng Sonnet, bot không bị im.
 * Kèm cài đặt gộp tin: chờ khách ngừng gõ 8 giây rồi trả lời 1 lần.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'ai_model' }).first();
  if (!row) await knex('settings').insert({ key: 'ai_model', value: 'claude-haiku-5-5' });
  else await knex('settings').where({ key: 'ai_model' }).update({ value: 'claude-haiku-5-5' });
  const g = await knex('settings').where({ key: 'messenger_gather_seconds' }).first();
  if (!g) await knex('settings').insert({ key: 'messenger_gather_seconds', value: '8' });
};

exports.down = async function down(knex) {
  await knex('settings').where({ key: 'ai_model' }).update({ value: 'claude-opus-5-5' });
};
