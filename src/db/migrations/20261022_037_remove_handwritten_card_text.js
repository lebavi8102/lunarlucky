/**
 * Chủ shop bỏ thiệp viết tay (22/10/2026): đoạn giới thiệu đầu trang chủ lưu trong cài đặt còn nhắc "Thiệp viết tay".
 * Chỉ đổi khi vẫn đúng là câu cũ — nếu chủ shop đã tự sửa trong admin thì giữ nguyên. Lỗi ở đây không được làm web sập.
 */
const OLD = 'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Thiệp viết tay, giao đúng ngày bạn hẹn.';
const NEW = 'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Giao đúng ngày bạn hẹn.';

exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'hero_subtitle' }).first();
    if (row && String(row.value || '').normalize('NFC').trim() === OLD.normalize('NFC')) {
      await knex('settings').where({ key: 'hero_subtitle' }).update({ value: NEW });
    }
  } catch (err) {
    console.error('[migration 037] không đổi được hero_subtitle, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
