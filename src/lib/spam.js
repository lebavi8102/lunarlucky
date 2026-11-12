/**
 * Lọc tin rác trên Fanpage — chạy TRƯỚC khi gọi AI để không tốn tiền Claude cho nick ảo.
 *   'promo'  → tin quảng cáo/lừa đảo (kiếm tiền, vay, tăng like…)  → im lặng, không trả lời
 *   'junk'   → tin vô nghĩa ở tin ĐẦU TIÊN (chỉ emoji/ký hiệu, gõ bừa, chỉ link) → trả 1 câu soạn sẵn, lần sau im
 *   ''       → tin bình thường → AI trả lời
 * Thận trọng: giữa cuộc trò chuyện chỉ chặn 'promo' (khách thật hay trả lời "50", "👍", số điện thoại…).
 */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// So trên chữ đã bỏ dấu (khách gõ có dấu hay không đều bắt được)
const PROMO = [
  /viec\s*nhe\s*luong\s*cao/,
  /kiem\s*tien\s*(online|tai\s*nha|moi\s*ngay)/,
  /tuyen\s*(ctv|cong\s*tac\s*vien)/,
  /(vay|cho\s*vay)\s*(tien|von|nhanh|online)/,
  /(tang|ban)\s*(like|follow|sub|tuong\s*tac)/,
  /(crypto|bitcoin|usdt|forex|nhan\s*thuong|trung\s*thuong)/,
  /(fanpage|trang)\s*(cua\s*ban)?\s*(se\s*)?bi\s*(khoa|vo\s*hieu|vi\s*pham)/,
  /(meta|facebook)\s*(support|business|ho\s*tro).*(khang|xac\s*minh|vi\s*pham)/,
];

function classify(text, { first = true } = {}) {
  const t = String(text || '').trim();
  if (!t) return '';
  const f = fold(t);
  if (PROMO.some((re) => re.test(f))) return 'promo';
  if (!first) return '';
  if (/\d{8,}/.test(f.replace(/[\s.-]/g, ''))) return ''; // có số điện thoại → khách thật
  if (/^(https?:\/\/\S+\s*)+$/i.test(t)) return 'junk'; // chỉ dán link
  const letters = f.replace(/[^a-z]/g, '');
  if (!letters) return /\d/.test(f) ? '' : 'junk'; // chỉ emoji/ký hiệu (số thì có thể là số lượng)
  if (/(.)\1{4,}/.test(letters) && new Set(letters).size <= 2) return 'junk'; // "aaaaaa", "hahahaha" vẫn qua
  // Gõ bừa: một cụm dài không có nguyên âm ("sdfghjk", "qwrtpsd")
  if (f.split(/\s+/).some((w) => w.replace(/[^a-z]/g, '').length >= 6 && !/[aeiouy]/.test(w))) return 'junk';
  return '';
}

module.exports = { classify };
