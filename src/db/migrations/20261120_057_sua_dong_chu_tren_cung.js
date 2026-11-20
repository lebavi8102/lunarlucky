/**
 * Chủ shop duyệt 20/11/2026 (soát giao diện): dòng chữ trên cùng đang "GIỎ  QUÀ TẾT CAO CẤP DOANH NGHIỆP CẤP · CÁ NHÂN"
 * (thừa chữ "CẤP", thừa dấu cách) → sửa thành "GIỎ QUÀ TẾT CAO CẤP · CÁ NHÂN & DOANH NGHIỆP".
 * Chỉ đổi khi nội dung vẫn đúng câu lỗi đó, để không ghi đè nếu chủ shop đã tự sửa.
 */
exports.up = async function up(knex) {
  const row = await knex('settings').where({ key: 'announcement' }).first();
  if (!row) return;
  const v = String(row.value || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (v.includes('DOANH NGHIỆP CẤP')) {
    await knex('settings').where({ key: 'announcement' }).update({ value: 'GIỎ QUÀ TẾT CAO CẤP · CÁ NHÂN & DOANH NGHIỆP' });
  }
};

exports.down = async function down() {};
