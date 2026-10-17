/**
 * Gửi 1 lần báo cáo kết quả thử AI với 50 khách khó tính vào chủ đề BÁO LỖI (chủ shop yêu cầu 17/10).
 * Migration chỉ chạy 1 lần nên tin chỉ gửi 1 lần; Telegram lỗi thì bỏ qua, không chặn khởi động.
 */
const REPORT = [
  '📋 <b>BÁO CÁO THỬ AI TƯ VẤN — 50 KHÁCH KHÓ TÍNH</b> (17/10)',
  'Chi phí thử: ~5,1 USD. Phần lớn chạy giả lập Fanpage, không tạo đơn hay yêu cầu gọi lại thật.',
  'Vòng đầu đạt ngay ~35/50 ca. Lỗi tìm được đã sửa, chạy lại đều đạt.',
  '',
  '<b>Lỗi đã sửa</b>',
  '1. Lời chúc thiệp không vào đơn, AI lặp lại rồi trả lời trống → ô lời chúc bắt buộc, chặn lặp.',
  '2. Đơn quà tặng bị báo thiếu người nhận 3 lần → báo rõ thiếu ô nào.',
  '3. Nói giỏ 1tr490 "vừa đủ miễn phí giao" (ngưỡng 1tr500) → so số chính xác từng giỏ.',
  '4. Gọi "anh/chị Linh" → tên dùng chung nam nữ chỉ gọi "anh/chị".',
  '5. Khách khiếu nại/chửi vẫn chào "rất vui được tư vấn" → chào ngắn rồi xin lỗi, xử lý.',
  '6. Câu "gặp nhân viên" còn chữ "chuyên viên" → đổi theo mẫu "vui lòng đợi em một chút".',
  '7. Đơn lớn/sỉ AI tự báo giá, tự báo ngày → chuyển nhân viên ngay.',
  '8. Hứa "em kiểm tra đổi món" rồi bỏ lửng → chuyển nhân viên ngay hoặc không hứa.',
  '9. Phí VAT nói chung chung → nói đúng +11% tiền hàng.',
  '10. Khách tiếng Anh chào tiếng Việt → chào tiếng Anh.',
  '11. "Dạ hihi" → cấm.',
  '12. Khách gửi ảnh thì bật câu hỏi lại từ đầu → bỏ, AI trả lời đúng mạch.',
  '',
  '<b>Đã cài theo quyết định của chủ shop</b>',
  '• Từ 5 giỏ, mua sỉ, hỏi chiết khấu, nhiều người nhận hoặc nhiều ngày giao → chuyển nhân viên ngay ở tin đầu (chốt giá).',
  '• Khiếu nại / gặp người / hỏi đơn đã đặt → lời chào ngắn.',
  '• Giờ trực Pancake 8h–24h. Từ 0h–8h AI hẹn "sáng mai từ 8h em gửi/báo anh chị ngay", không hứa "ngay đây". Đổi giờ ở Cài đặt (staff_from_hour, staff_to_hour).',
  '• Khách chưa chọn giỏ → AI hỏi cần thêm thông tin giỏ nào; vẫn phân vân → chuyển nhân viên.',
  '',
  '<b>Việc cần anh/chị</b>',
  '• Nhân viên trực Pancake 8h–24h phải trả lời nhanh: AI đã hứa "đợi em một chút".',
  '• Giữ số dư Claude trên 20 USD (hôm nay hết tiền ~20 phút, AI ngừng trả lời khách).',
  '• Khi chạy quảng cáo: đổi Cài đặt ai_model = auto để giảm ~40% chi phí (mỗi khách tư vấn ~5–10 nghìn đồng).',
  '• Thử vài lượt trên Fanpage thật (kết quả trên là giả lập qua web).',
].join('\n');

exports.up = async function up() {
  try {
    await require('../../lib/notify').telegram(REPORT, null, { topic: 'error' });
  } catch (err) {
    console.error('[báo cáo thử AI] gửi Telegram lỗi:', err.message);
  }
};

exports.down = async function down() {};
