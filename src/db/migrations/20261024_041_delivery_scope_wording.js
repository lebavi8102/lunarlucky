/**
 * Chủ shop chốt (24/10/2026): chữ cam kết giao hàng nói rõ phạm vi — Hà Nội đúng ngày, tỉnh khác 2–4 ngày.
 * Chỉ đổi dòng mô tả banner khi cài đặt vẫn đúng là chữ cũ; nếu chủ shop đã tự sửa trong admin thì giữ nguyên.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
const OLD = 'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Giao đúng ngày bạn hẹn.';
const NEW = 'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Hà Nội giao đúng ngày bạn hẹn, tỉnh khác 2–4 ngày.';
const norm = (v) => String(v || '').normalize('NFC').trim();

exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'hero_subtitle' }).first();
    if (row && norm(row.value) === norm(OLD)) {
      await knex('settings').where({ key: 'hero_subtitle' }).update({ value: NEW });
    }
  } catch (err) {
    console.error('[migration 041] không đổi được dòng mô tả banner, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
