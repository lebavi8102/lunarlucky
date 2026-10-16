/**
 * Câu hỏi thường gặp — số liệu (phí giao, cọc, ngày chuẩn bị, hạn giao Tết) lấy từ Cài đặt
 * để đổi quy định trong admin là trang FAQ (và dữ liệu Google) tự đúng theo.
 */
const { money } = require('./format');
const payment = require('./payment');

function faq(s = {}) {
  const fee = money(Number(s.shipping_fee) || 0);
  const free = money(Number(s.free_ship_threshold) || 0);
  const tiers = require('../routes/checkout').bulkTiers(s);
  const bulkText = tiers.map((t, i) => {
    const nx = tiers[i + 1];
    return `đơn ${nx ? `${t.qty}–${nx.qty - 1}` : `từ ${t.qty}`} giỏ cần ${t.maxDays > t.days ? `${t.days}–${t.maxDays}` : t.days} ngày chuẩn bị${nx ? '' : ' (tùy tình hình thực tế)'}`;
  }).join('; ');
  const vn = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const deadline = vn(s.order_deadline);
  const tet = s.tet_closed_from && s.tet_closed_to ? `Lunar Lucky nghỉ giao hàng từ ${vn(s.tet_closed_from)} đến ${vn(s.tet_closed_to)}.` : '';
  return [
    {
      q: 'Tôi nên đặt giỏ quà Tết trước bao lâu?',
      a: `Đơn lẻ ở Hà Nội giao được từ ngày hôm sau; ${bulkText}; các tỉnh khác cần thêm 2–4 ngày vận chuyển. Giai đoạn cao điểm (từ 15 tháng Chạp), bạn nên đặt trước 5–7 ngày để giữ được ngày giao mong muốn.${deadline ? ` Lunar Lucky giao quà Tết đến hết ${s.order_deadline_label ? s.order_deadline_label + ' (' + deadline + ')' : deadline}.` : ''} ${tet}`.trim(),
    },
    {
      q: 'Tôi có thể chọn ngày và giờ giao hàng không?',
      a: 'Có. Ở bước thanh toán, bạn chọn ngày giao mong muốn; giao trong Hà Nội còn chọn được buổi sáng (8h–12h), chiều (13h–17h) hoặc tối (18h–20h). Shipper gọi trước khi giao và Lunar Lucky gửi ảnh xác nhận khi quà tới tay.',
    },
    {
      q: 'Tôi muốn gửi quà tặng trực tiếp cho người thân, đối tác?',
      a: 'Bạn chọn "Gửi tặng người khác" khi thanh toán và nhập thông tin người nhận. Hóa đơn giá tiền sẽ không được đặt trong giỏ quà, kèm thiệp chúc viết tay theo lời nhắn của bạn. Đơn gửi tặng thanh toán bằng chuyển khoản để không thu tiền người nhận.',
    },
    {
      q: 'Lunar Lucky nhận những hình thức thanh toán nào?',
      a: `Chuyển khoản qua mã VietQR hiện ngay sau khi đặt — hệ thống tự xác nhận khi tiền về; hoặc thanh toán khi nhận hàng (COD). Đơn COD cần đặt cọc qua mã QR để giữ hàng: ${payment.depositText(s)}; phần còn lại trả khi nhận.`,
    },
    {
      q: 'Phí giao hàng được tính thế nào?',
      a: `Phí giao đồng giá ${fee} mỗi đơn, miễn phí cho đơn từ ${free}. Nội thành Hà Nội giao bằng Ahamove hoặc Lunar Lucky tự giao, đúng ngày bạn chọn; các tỉnh khác giao qua đơn vị vận chuyển trong 2–4 ngày.`,
    },
    {
      q: 'Tôi có thể đổi món trong giỏ hoặc làm giỏ theo yêu cầu không?',
      a: 'Có. Bạn chọn giỏ gần ý mình nhất rồi nhắn Lunar Lucky qua Zalo hoặc Fanpage (nút "Nhắn Zalo đổi món" trên trang mỗi giỏ). Chuyên viên tư vấn đổi món theo hàng đang có và báo giá trực tiếp. Gần Tết hàng khan, việc đổi món có thể hạn chế hơn — đặt sớm để có nhiều lựa chọn.',
    },
    {
      q: 'Doanh nghiệp đặt số lượng lớn có được ưu đãi và in logo không?',
      a: 'Có. Lunar Lucky nhận đơn doanh nghiệp từ 5 giỏ: tư vấn ngân sách, xuất hóa đơn VAT và giao hàng loạt theo danh sách. In logo lên thiệp từ 5 giỏ, lên hộp và nơ từ 100 giỏ, thiết kế hộp riêng từ 500 giỏ; từ 20 giỏ có giá ưu đãi theo số lượng. Gửi yêu cầu tại trang Quà tặng doanh nghiệp để nhận báo giá trong 24 giờ.',
    },
    {
      q: 'Nếu giỏ quà bị hư hỏng khi nhận thì sao?',
      a: 'Vui lòng kiểm tra giỏ khi nhận, quay video khi mở hàng và liên hệ Lunar Lucky trong 24 giờ. Chúng tôi sẽ đổi mới món bị hư hỏng hoặc hoàn tiền tương ứng qua chuyển khoản.',
    },
  ];
}

module.exports = faq;
