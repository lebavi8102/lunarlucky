/**
 * Chủ shop yêu cầu 20/11/2026: TẮT bot AI trả lời tin nhắn Fanpage ("làm mất hết khách").
 * messenger_ai_enabled = 0 → bot im hoàn toàn với tin nhắn mới, nhân viên trả lời tay (Pancake / Business Suite).
 * Bật lại: lệnh /ai trên Telegram, hoặc Cài đặt → messenger_ai_enabled = 1.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'messenger_ai_enabled' }).first();
  if (!row) await knex('settings').insert({ key: 'messenger_ai_enabled', value: '0' });
  else await knex('settings').where({ key: 'messenger_ai_enabled' }).update({ value: '0' });
};

exports.down = async function down() {};
