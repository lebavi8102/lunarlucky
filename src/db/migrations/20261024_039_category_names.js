/**
 * Chủ shop chốt (24/10/2026): đổi tên 4 bộ sưu tập và dòng mô tả ngắn hiện ở trang chủ.
 * Chỉ đổi khi tên + mô tả vẫn đúng là chữ cũ — nếu chủ shop đã tự sửa trong admin thì giữ nguyên.
 * Đường dẫn (slug) không đổi nên liên kết cũ vẫn chạy. Lỗi ở đây không được làm web sập khi khởi động.
 */
const CHANGES = [
  { slug: 'bieu-sep-doi-tac', oldName: 'Biếu sếp & đối tác', oldTagline: 'Sang trọng, chỉn chu cho người quan trọng', name: 'Quà tặng sếp & đối tác', tagline: 'Chỉn chu món quà, trọn vẹn tri ân' },
  { slug: 'qua-gia-dinh', oldName: 'Quà gia đình', oldTagline: 'Ấm áp, đủ đầy cho ngày sum vầy', name: 'Quà tặng gia đình', tagline: 'Gửi trao sum vầy, đong đầy yêu thương' },
  { slug: 'qua-doanh-nghiep', oldName: 'Quà doanh nghiệp', oldTagline: 'Số lượng lớn, in logo thương hiệu', name: 'Quà tặng doanh nghiệp', tagline: 'Đặt quà số lượng lớn, mang dấu ấn riêng' },
  { slug: 'hop-qua-nho-xinh', oldName: 'Hộp quà nhỏ xinh', oldTagline: 'Gửi bạn bè, đồng nghiệp, dưới 1 triệu', name: 'Quà tặng bạn bè', tagline: 'Món quà tinh tế, gửi lời chúc thân tình' },
];
const norm = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim();

exports.up = async function up(knex) {
  try {
    for (const c of CHANGES) {
      const row = await knex('categories').where({ slug: c.slug }).first();
      if (row && norm(row.name) === norm(c.oldName) && norm(row.tagline) === norm(c.oldTagline)) {
        await knex('categories').where({ slug: c.slug }).update({ name: c.name, tagline: c.tagline });
      }
    }
  } catch (err) {
    console.error('[migration 039] không đổi được tên bộ sưu tập, giữ nguyên:', err.message);
  }
};

exports.down = async function down() {};
