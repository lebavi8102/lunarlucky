/**
 * Rút gọn đoạn giới thiệu đầu trang thành 1 câu cho cả người mua lẻ lẫn doanh nghiệp (chủ shop chọn phương án C).
 * Chỉ đổi khi vẫn đang là đoạn cũ — nếu chủ shop đã tự sửa trong admin thì giữ nguyên.
 */
const OLD = 'LUNAR LUCKY tuyển chọn những giỏ quà Tết cao cấp';
const NEW = 'Giỏ quà Tết cao cấp biếu gia đình, sếp, đối tác hay tặng nhân viên. Thiệp viết tay, giao đúng ngày bạn hẹn.';

exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'hero_subtitle' }).first();
  if (row && String(row.value || '').normalize('NFC').startsWith(OLD.normalize('NFC'))) {
    await knex('settings').where({ key: 'hero_subtitle' }).update({ value: NEW });
  }
};

exports.down = async function down() {};
