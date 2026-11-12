const assert = require('assert');
const { classify: c } = require('../src/lib/spam');
const cases = [
  ['😍😍😍', 'junk'], ['...', 'junk'], ['sdfghjkl', 'junk'], ['aaaaaaa', 'junk'], ['https://bit.ly/xyz', 'junk'],
  ['Việc nhẹ lương cao, inbox ngay', 'promo'], ['Tuyển CTV bán hàng online', 'promo'], ['Fanpage của bạn sẽ bị khóa', 'promo'],
  ['Xem mẫu & bảng giá giỏ quà', ''], ['alo', ''], ['hi', ''], ['50', ''], ['0912345678', ''], ['hahahaha', ''],
  ['giá bao nhiêu shop', ''], ['ok', ''], ['Chính sách vận chuyển như thế nào?', ''],
];
for (const [t, want] of cases) assert.strictEqual(c(t), want, t);
assert.strictEqual(c('👍', { first: false }), '');
assert.strictEqual(c('vay tiền nhanh', { first: false }), 'promo');
console.log('spam ok', cases.length + 2);
