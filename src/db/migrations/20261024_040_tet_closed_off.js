/**
 * Chủ shop chốt (24/10/2026): tắt ngày nghỉ Tết 06–10/02/2027, khách chọn giao được mọi ngày.
 * Chỉ tắt khi cài đặt vẫn đúng là ngày mặc định cũ — nếu chủ shop đã tự sửa trong admin thì giữ nguyên.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
const CHANGES = [
  { key: 'tet_closed_from', old: '2027-02-06' },
  { key: 'tet_closed_to', old: '2027-02-10' },
];

exports.up = async function up(knex) {
  try {
    for (const c of CHANGES) {
      const row = await knex('settings').where({ key: c.key }).first();
      if (row && String(row.value || '').trim() === c.old) {
        await knex('settings').where({ key: c.key }).update({ value: '' });
      }
    }
  } catch (err) {
    console.error('[migration 040] không tắt được ngày nghỉ Tết, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
