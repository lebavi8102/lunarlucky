/**
 * Chủ shop chốt (03/11/2026): số điện thoại shop là 0918 000 910 (giống trên Fanpage lunarlucky.vn).
 * Chỉ đổi khi cài đặt vẫn là số cũ 0969 000 910 — Zalo giữ nguyên vì là tài khoản riêng.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'shop_phone' }).first();
    if (row && String(row.value || '').replace(/\D/g, '') === '0969000910') {
      await knex('settings').where({ key: 'shop_phone' }).update({ value: '091 800 09 10' });
    }
  } catch (err) {
    console.error('[migration 045] không đổi được số điện thoại shop, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
