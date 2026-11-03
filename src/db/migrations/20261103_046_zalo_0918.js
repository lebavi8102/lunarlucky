/**
 * Chủ shop chốt (03/11/2026): Zalo shop chuyển sang số 0918 000 910 (cùng hotline).
 * Chỉ đổi khi cài đặt vẫn là link Zalo số cũ 0969 000 910.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'zalo_url' }).first();
    if (row && /zalo\.me\/0969000910\/?$/.test(String(row.value || '').trim())) {
      await knex('settings').where({ key: 'zalo_url' }).update({ value: 'https://zalo.me/0918000910' });
    }
  } catch (err) {
    console.error('[migration 046] không đổi được link Zalo, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
