/**
 * Chủ shop yêu cầu 20/11/2026: TẮT luôn AI tư vấn trên website (sau khi đã tắt bot Fanpage ở migration 056).
 * ai_chat_enabled = 0 → ẩn nút "Tư vấn chọn quà", khung chat AI và mục AI trong nút "Hỗ trợ" trên điện thoại.
 * Nút Zalo / Gọi điện vẫn giữ. Bật lại: Cài đặt → ai_chat_enabled = 1.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'ai_chat_enabled' }).first();
  if (!row) await knex('settings').insert({ key: 'ai_chat_enabled', value: '0' });
  else await knex('settings').where({ key: 'ai_chat_enabled' }).update({ value: '0' });
};

exports.down = async function down() {};
