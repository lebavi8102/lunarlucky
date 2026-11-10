/**
 * 10/11/2026: chuyển Meta Pixel sang tập dữ liệu mới "Lunar Lucky Web - Auth SS" (4634812540120961),
 * thuộc doanh nghiệp Auth SS (chủ sở hữu Page + tài khoản quảng cáo lunar Lucky).
 * Pixel cũ 1451475576938508 nằm ở doanh nghiệp Lê Bá Vĩ, không chia sẻ sang Auth SS được.
 * Chỉ đổi khi cài đặt đang trống, là pixel cũ hoặc là mã ứng dụng nhầm. Lỗi không được làm web sập.
 */
const NEW_ID = '4634812540120961';
const OLD_IDS = ['', '1451475576938508', '2690193658061813'];

exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'meta_pixel_id' }).first();
    if (!row) {
      await knex('settings').insert({ key: 'meta_pixel_id', value: NEW_ID });
    } else if (OLD_IDS.includes(String(row.value || '').trim())) {
      await knex('settings').where({ key: 'meta_pixel_id' }).update({ value: NEW_ID });
    }
  } catch (err) {
    console.error('[migration 051] không đổi được meta_pixel_id, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
