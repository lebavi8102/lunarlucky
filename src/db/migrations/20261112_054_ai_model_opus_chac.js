/**
 * Chủ shop duyệt 12/11/2026: bot tư vấn dùng Opus (mô hình đã huấn luyện, thử khách khó).
 * Migration 052/053 chỉ đổi khi đang để mặc định/"auto", nhưng web thật đang để thẳng Sonnet (lượt thử 12/11 vẫn chạy claude-sonnet-5-5)
 * → đặt hẳn về Opus cho cả "auto" và Sonnet. Bật lại auto/Sonnet sau khi thử với khách khó và chủ shop duyệt.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'ai_model' }).first();
  if (!row) await knex('settings').insert({ key: 'ai_model', value: 'claude-opus-5-5' });
  else if (['', 'auto', 'claude-sonnet-5-5'].includes(String(row.value || '').trim())) {
    await knex('settings').where({ key: 'ai_model' }).update({ value: 'claude-opus-5-5' });
  }
};

exports.down = async function down() {};
