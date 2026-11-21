/**
 * Chủ shop yêu cầu 21/11/2026: BẬT lại bot Fanpage (sau khi dạy lại theo 7 điểm + chạy thử 19 tình huống).
 * messenger_ai_enabled = 1. Bot web (ai_chat_enabled) VẪN TẮT.
 * Tắt lại: lệnh /ai tat trên Telegram, hoặc Cài đặt → messenger_ai_enabled = 0.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'messenger_ai_enabled' }).first();
  if (!row) await knex('settings').insert({ key: 'messenger_ai_enabled', value: '1' });
  else await knex('settings').where({ key: 'messenger_ai_enabled' }).update({ value: '1' });
};

exports.down = async function down() {};
