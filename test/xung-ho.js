/** Kiểm thử xưng hô theo tên Facebook (không cần database). Chạy: node test/xung-ho.js */
const { guess, callWith } = require('../src/lib/xung-ho');
let fails = 0;
const eq = (got, want, msg) => { const ok = got === want; console.log(`${ok ? '✔' : '✘'} ${msg}: ${got}${ok ? '' : ` (cần: ${want})`}`); if (!ok) fails++; };
const cases = [
  ['Lê Đức Anh', 'anh Đức Anh'], ['Nguyễn Kim Anh', 'chị Kim Anh'], ['Nguyễn Tuấn Anh', 'anh Tuấn Anh'],
  ['Vũ Phương Anh', 'chị Phương Anh'], ['Phạm Minh Anh', 'anh/chị'], ['Lê Anh', 'anh/chị'],
  ['Trần Văn Tuấn', 'anh Tuấn'], ['Trần Thị Lan', 'chị Lan'], ['Nguyễn Thị Hà', 'chị Hà'], ['Trần Mạnh Hà', 'anh Hà'],
  ['Đức Anh Lê', 'anh Đức Anh'], ['Anh Lê Đức', 'anh Đức Anh'], ['Kim Anh', 'chị Kim Anh'],
  ['Nguyen Van Anh', 'anh/chị'], ['Shop Quà Tặng 99', 'anh/chị'], ['', 'anh/chị'], [null, 'anh/chị'],
];
for (const [name, want] of cases) eq(guess(name).call, want, `guess("${name}")`);
eq(callWith('chị', 'Lê Minh Anh'), 'chị Minh Anh', 'khách tự xưng chị, tên Minh Anh');
eq(callWith('anh', ''), 'anh', 'khách tự xưng anh, chưa biết tên');
if (fails) { console.error(`\n${fails} lỗi`); process.exit(1); }
console.log('\nTất cả đều đúng.');
