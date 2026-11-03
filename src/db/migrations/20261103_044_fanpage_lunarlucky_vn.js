/**
 * Chủ shop tạo page mới (03/11/2026): facebook.com/lunarlucky.vn — đổi nút Fanpage/Messenger trên web sang page này.
 * Chỉ đổi khi cài đặt vẫn là link page trước (profile.php?id=61595557273128 / m.me/1335103099693898) hoặc còn trống.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
const CHANGES = [
  { key: 'fanpage_url', olds: ['https://www.facebook.com/profile.php?id=61595557273128'], value: 'https://www.facebook.com/lunarlucky.vn' },
  { key: 'messenger_url', olds: ['https://m.me/1335103099693898'], value: 'https://m.me/lunarlucky.vn' },
];

exports.up = async function up(knex) {
  try {
    for (const c of CHANGES) {
      const row = await knex('settings').where({ key: c.key }).first();
      if (!row) continue;
      const cur = String(row.value || '').trim();
      if (!cur || c.olds.includes(cur)) await knex('settings').where({ key: c.key }).update({ value: c.value });
    }
  } catch (err) {
    console.error('[migration 044] không đổi được link Fanpage, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
