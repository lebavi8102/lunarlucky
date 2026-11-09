/**
 * 09/11/2026: cài đặt meta_pixel_id đang là 2690193658061813 — đó là MÃ ỨNG DỤNG Facebook (bot Messenger),
 * không phải Pixel, nên Meta chưa nhận được sự kiện nào từ web. Pixel thật của web là
 * "Lunar Lucky Web" 1451475576938508 (doanh nghiệp Lê Bá Vĩ, đã chạy tốt tới 19/10).
 * Chỉ đổi khi cài đặt vẫn đang là mã ứng dụng. Lỗi ở đây không được làm web sập khi khởi động.
 */
exports.up = async function up(knex) {
  try {
    const row = await knex('settings').where({ key: 'meta_pixel_id' }).first();
    if (row && String(row.value || '').trim() === '2690193658061813') {
      await knex('settings').where({ key: 'meta_pixel_id' }).update({ value: '1451475576938508' });
    }
  } catch (err) {
    console.error('[migration 050] không đổi được meta_pixel_id, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
