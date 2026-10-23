/**
 * Chủ shop chốt (23/10/2026): tiêu đề banner 2 dòng "Trao quà tinh tế / Gửi trọn thịnh vượng", dòng nhỏ "LUNAR LUCKY · QUÀ TẾT 2027".
 * Chỉ đổi khi cài đặt vẫn đúng là chữ cũ đang hiện trên web — nếu chủ shop đã tự sửa trong admin thì giữ nguyên.
 * Lỗi ở đây không được làm web sập khi khởi động.
 */
const CHANGES = [
  { key: 'hero_title', olds: ['Món quà xứng tầm, khởi đầu thịnh vượng', 'Trao lời chúc trọn vẹn trong từng giỏ quà'], value: 'Trao quà tinh tế / Gửi trọn thịnh vượng' },
  { key: 'hero_eyebrow', olds: ['LUNAR LUCKY — Trao quà tinh tế, gửi trọn thịnh vượng', 'Quà Tết an khang, trao trọn phú quý'], value: 'LUNAR LUCKY · QUÀ TẾT 2027' },
];
const norm = (v) => String(v || '').normalize('NFC').trim();

exports.up = async function up(knex) {
  try {
    for (const c of CHANGES) {
      const row = await knex('settings').where({ key: c.key }).first();
      if (row && c.olds.some((o) => norm(o) === norm(row.value))) {
        await knex('settings').where({ key: c.key }).update({ value: c.value });
      }
    }
  } catch (err) {
    console.error('[migration 038] không đổi được chữ banner, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
