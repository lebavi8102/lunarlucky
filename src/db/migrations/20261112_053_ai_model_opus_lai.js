/**
 * Chủ shop chốt 12/11/2026 (sau lần thử 11:12 bot bỏ câu chào): chưa chạy quảng cáo nên dùng lại Opus,
 * mô hình đã được huấn luyện và thử với khách khó. Bật lại "auto" sau khi thử Sonnet với các kiểu khách khó và chủ shop duyệt.
 * Chỉ đổi khi web đang để "auto" (do migration 052); chủ shop đã tự chọn mô hình khác thì giữ nguyên.
 */
exports.up = async function up(knex) {
  await knex('settings').where({ key: 'ai_model', value: 'auto' }).update({ value: 'claude-opus-5-5' });
};

exports.down = async function down() {};
