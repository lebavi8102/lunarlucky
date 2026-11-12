/**
 * Xưng hô theo tên Facebook — đoán bằng code, không để AI tự đoán.
 *   Lê Đức Anh      → { title: 'anh', name: 'Đức Anh', call: 'anh Đức Anh' }
 *   Nguyễn Kim Anh  → { title: 'chị', name: 'Kim Anh', call: 'chị Kim Anh' }
 *   Trần Văn Tuấn   → { title: 'anh', name: 'Tuấn',    call: 'anh Tuấn' }
 *   Phạm Minh Anh   → { title: '',    name: '',        call: 'anh/chị' }   (tên dùng chung → không đoán)
 * Không chắc thì luôn trả "anh/chị" và không kèm tên: gọi sai giới tính tệ hơn không gọi tên.
 */

// Bỏ dấu để so họ (khách hay để tên không dấu: "Nguyen Van A")
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
// So tên có dấu (tên không dấu không đủ chắc để đoán nam/nữ: "Van" có thể là Văn hoặc Vân)
const low = (s) => String(s || '').normalize('NFC').toLowerCase();

const SURNAMES = new Set(['nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'vu', 'vo', 'phan', 'truong', 'bui', 'dang', 'do', 'ngo', 'ho', 'duong', 'ly', 'dinh', 'dao', 'doan', 'lam', 'mai', 'trinh', 'cao', 'luong', 'luu', 'ta', 'ha', 'chu', 'kieu', 'quach', 'thai', 'ton', 'trieu', 'tang', 'la', 'khuc', 'vuong', 'phung', 'nghiem', 'tong', 'hua', 'ung', 'au', 'giang', 'van', 'mac', 'dieu', 'khong', 'bach', 'thach', 'lai', 'tieu', 'nong', 'quan', 'dong', 'tu', 'diep', 'ninh', 'thieu']);

// Tên gọi chỉ 1 chữ nghe cụt/dễ nhầm → gọi kèm tên đệm ("anh Đức Anh", "chị Kim Anh")
const WITH_MIDDLE = new Set(['anh', 'em', 'út', 'bé', 'tí', 'tý', 'hai', 'ba', 'tư', 'cả']);

const MALE_GIVEN = new Set(['tuấn', 'hùng', 'dũng', 'cường', 'thắng', 'hải', 'long', 'đức', 'quân', 'sơn', 'vĩ', 'huy', 'hoàng', 'nam', 'phong', 'tùng', 'bình', 'trung', 'kiên', 'toàn', 'thành', 'vinh', 'khoa', 'đạt', 'hiếu', 'việt', 'mạnh', 'tiến', 'cương', 'hưng', 'thịnh', 'lực', 'khải', 'khang', 'phúc', 'tài', 'lâm', 'quang', 'trường', 'thái', 'nghĩa', 'dương', 'luân', 'hậu', 'lộc', 'công', 'chiến', 'quý', 'tú', 'duy', 'khôi', 'kiệt', 'nhân', 'tân', 'thuận', 'sang', 'vũ', 'định', 'đông', 'thiện']);
const FEMALE_GIVEN = new Set(['lan', 'hương', 'trang', 'hoa', 'mai', 'huyền', 'thảo', 'nhung', 'hằng', 'loan', 'hạnh', 'yến', 'vân', 'ngân', 'nga', 'thủy', 'thuỷ', 'diệp', 'quyên', 'oanh', 'trinh', 'nhi', 'vy', 'vi', 'my', 'hồng', 'dung', 'liên', 'thơ', 'thư', 'trâm', 'ly', 'ánh', 'nguyệt', 'cúc', 'đào', 'tuyết', 'quỳnh', 'diễm', 'kiều', 'thắm', 'lụa', 'nhàn', 'nương', 'phượng', 'thúy', 'thuý', 'uyên', 'hiền', 'châu', 'chi', 'duyên', 'gấm', 'huệ', 'lệ', 'lài', 'mơ', 'mến', 'ngà', 'nhạn', 'nhã', 'nhị', 'thanh hương', 'thoa', 'trà', 'tâm anh', 'tiên', 'vui', 'xuyến', 'hà', 'giang', 'liễu', 'lý', 'hoài', 'hảo', 'mỹ', 'thùy']);
// Tên đệm thường gặp (chỉ dùng khi tên gọi không tự nói được nam/nữ, trừ "Thị")
const MALE_MIDDLE = new Set(['văn', 'bá', 'hữu', 'đình', 'công', 'đức', 'quang', 'trọng', 'quốc', 'mạnh', 'tiến', 'tuấn', 'việt', 'hùng', 'trung', 'thế', 'chí', 'đăng', 'huy', 'duy', 'thành', 'hoàng', 'nam', 'sơn', 'hải']);
const FEMALE_MIDDLE = new Set(['thị', 'kim', 'thu', 'thùy', 'thuỳ', 'thúy', 'thuý', 'diệu', 'mỹ', 'bích', 'ngọc', 'phương', 'quỳnh', 'tuyết', 'hồng', 'lan', 'hương', 'mai', 'trà', 'vân', 'nguyệt', 'diễm', 'cẩm', 'yến', 'hoài', 'tố', 'lệ', 'nhã', 'uyên', 'thảo']);

// Chữ Việt (có dấu hoặc không): chỉ chữ cái, không số/ký hiệu
const WORD = /^[a-zA-ZÀ-ỹĐđ]+$/u;
const cap = (w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi');

/** Tách họ tên thành { middle: [...], given } theo thứ tự Việt. null nếu không giống tên người. */
function parse(full) {
  const raw = String(full || '').normalize('NFC').replace(/[^\p{L}\s]/gu, ' ').trim();
  if (!raw) return null;
  let w = raw.split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 5 || !w.every((x) => WORD.test(x) && x.length <= 7)) return null;
  // Facebook đôi khi đảo thứ tự: "Đức Anh Lê" hoặc "Anh Lê Đức" → đưa về "Lê Đức Anh"
  if (w.length >= 2 && !SURNAMES.has(fold(w[0]))) {
    if (SURNAMES.has(fold(w[w.length - 1]))) w = [w[w.length - 1], ...w.slice(0, -1)];
    else if (w.length >= 3 && SURNAMES.has(fold(w[1]))) w = [...w.slice(1), w[0]];
  }
  const hasSurname = w.length >= 2 && SURNAMES.has(fold(w[0]));
  const rest = hasSurname ? w.slice(1) : w;
  return { middle: rest.slice(0, -1).map(cap), given: cap(rest[rest.length - 1]) };
}

/** Đoán anh/chị từ tên đệm + tên gọi. '' khi không chắc. */
function gender(p) {
  const g = low(p.given);
  const mids = p.middle.map(low);
  const lastMid = mids[mids.length - 1] || '';
  if (mids.includes('thị')) return 'chị';
  if (mids.includes('văn')) return 'anh';
  // Tên ghép rõ nghĩa ("Thanh Hương", "Tâm Anh") tra cả cụm trước
  const pair = lastMid ? `${lastMid} ${g}` : '';
  if (pair && FEMALE_GIVEN.has(pair)) return 'chị';
  if (MALE_GIVEN.has(g) && !FEMALE_MIDDLE.has(lastMid)) return 'anh';
  if (FEMALE_GIVEN.has(g) && !MALE_MIDDLE.has(lastMid)) return 'chị';
  // Tên gọi dùng chung (Anh, Linh, Ngọc, Minh…) → nhờ tên đệm sát nhất
  if (MALE_MIDDLE.has(lastMid)) return 'anh';
  if (FEMALE_MIDDLE.has(lastMid)) return 'chị';
  return '';
}

/**
 * Cách gọi khách từ họ tên Facebook.
 * @returns {{ title: 'anh'|'chị'|'', name: string, call: string }}
 */
function guess(full) {
  const none = { title: '', name: '', call: 'anh/chị' };
  const p = parse(full);
  if (!p) return none;
  const title = gender(p);
  if (!title) return none;
  const lastMid = p.middle[p.middle.length - 1];
  const name = WITH_MIDDLE.has(low(p.given)) && lastMid ? `${lastMid} ${p.given}` : p.given;
  return { title, name, call: `${title} ${name}` };
}

/** Cách gọi khi đã biết anh/chị (khách tự xưng) — tên vẫn theo quy tắc kèm tên đệm. */
function callWith(title, full) {
  if (!['anh', 'chị'].includes(title)) return 'anh/chị';
  const p = parse(full);
  if (!p) return title;
  const lastMid = p.middle[p.middle.length - 1];
  const name = WITH_MIDDLE.has(low(p.given)) && lastMid ? `${lastMid} ${p.given}` : p.given;
  return `${title} ${name}`;
}

module.exports = { guess, callWith, parse };
