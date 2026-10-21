/**
 * Kiểm thử AI tư vấn bán hàng với "Claude giả lập" (không gọi API thật, không tốn tiền).
 * Chạy: node test/ai-sales.js   (database local)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
const ai = require('../src/lib/ai-sales');
const settings = require('../src/lib/settings');
const { todayVN, money } = require('../src/lib/format');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };

(async () => {
  try {
    await db.migrate.latest();
    const prod = await db('products').where({ is_active: true }).andWhere('stock', '>', 5).orderBy('price').first();
    const sys = await ai.systemPrompt();
    ok(sys.includes(`[${prod.id}] ${prod.name}`) && /Hạn dùng tối thiểu 3 tháng/.test(sys) && !/\d{4}-\d{2}-\d{2}T/.test(sys), 'Lời dặn AI có danh mục thật + cam kết, không chứa giờ (giữ cache)');
    const defs = ai.tools();
    ok(defs.every((t) => t.strict && t.input_schema.additionalProperties === false), '4 công cụ đều strict, không nhận trường lạ');

    const req = { session: {} };
    const out = {};
    const s1 = await ai.runTool('search_products', { query: 'bieu sep', max_price: 5000000 }, req, out);
    ok(s1.results.length && s1.results.every((p) => p.price <= 5000000 && p.url.startsWith('/san-pham/')), 'search_products: lọc giá, trả giá + link thật');
    // ── Ngân sách: đọc câu khách ──
    const pb = (q) => { const b = ai.parseBudget(q); return b ? `${b.min ?? '-'}..${b.max ?? '-'}` : 'null'; };
    ok(pb('tầm 2tr') === '-..2000000' && pb('khoảng 2 triệu') === '-..2000000' && pb('dưới 1tr5') === '-..1500000' && pb('tối đa 800k') === '-..800000' && pb('2tr') === '-..2000000',
      'Ngân sách "tầm/khoảng/dưới/tối đa X" hoặc chỉ "X" → trần X (không nới ±25%)');
    ok(pb('giỏ 1tr890') === '-..1890000' && pb('không quá 1.500.000đ') === '-..1500000' && pb('khong hon 2tr') === '-..2000000', 'Đọc đúng 1tr890, 1.500.000đ, "không hơn"');
    ok(pb('từ 1tr đến 2tr') === '1000000..2000000' && pb('1tr - 1tr5') === '1000000..1500000' && pb('tu 2tr toi 1tr') === '1000000..2000000', 'Khoảng "từ X đến Y" → [X, Y]');
    ok(pb('trên 2tr') === '2000000..-' && pb('từ 3 triệu') === '3000000..-' && pb('3tr trở lên') === '3000000..-' && pb('hơn 1tr') === '1000000..-', '"Trên/từ X", "X trở lên" → chỉ mức tối thiểu');
    ok(pb('biếu sếp') === 'null' && pb('2 giỏ cho bố mẹ') === 'null' && pb('sđt 0912345678') === 'null' && pb('giao ngày 2027') === 'null', 'Không có số tiền → không suy diễn ngân sách (số giỏ, SĐT, năm không tính)');
    ok(ai.parseBudget('2tr 3 giỏ').amount === 2000000 && ai.parseBudget('2tr 3 giỏ').baskets === 3, '"2tr 3 giỏ" là 2tr (không phải 2tr3) và 3 giỏ');
    ok(pb('2 đến 3 triệu') === '2000000..3000000' && pb('từ 2 đến 3 triệu') === '2000000..3000000' && pb('2-3tr') === '2000000..3000000' && pb('2tr–3tr') === '2000000..3000000' && pb('từ 1tr5 tới 2tr') === '1500000..2000000',
      'Khoảng "2 đến 3 triệu", "từ 2 đến 3 triệu", "2-3tr", "2tr–3tr", "từ 1tr5 tới 2tr" → giữ cả min và max');
    ok(pb('1,5tr') === '-..1500000' && pb('1.5 triệu') === '-..1500000' && pb('dưới 2 triệu') === '-..2000000' && pb('2 triệu, 3 giỏ') === '-..2000000' && pb('3 giỏ quà, mỗi giỏ khoảng 2 triệu') === '-..2000000',
      'Giữ đúng: 1,5tr, 1.5 triệu, dưới 2 triệu; "2 triệu, 3 giỏ" và "mỗi giỏ khoảng 2 triệu" → 2tr mỗi giỏ (số giỏ không thành tiền)');
    const t6 = ai.parseBudget('Tổng 6 triệu cho 3 giỏ');
    ok(t6.max === 2000000 && t6.total === 6000000 && t6.baskets === 3 && !t6.clarify, '"Tổng 6 triệu cho 3 giỏ" → 2tr mỗi giỏ (không dùng 6tr làm trần)');
    // D1 (chủ shop chốt): không có chữ "tổng" và không có "mỗi giỏ" → hỏi khách là tổng hay mỗi giỏ
    for (const q of ['2 triệu cho 3 giỏ', '3 giỏ 2 triệu', '3 giỏ quà tầm 2 triệu', '2tr 3 giỏ']) {
      const b = ai.parseBudget(q);
      ok(b.clarify === 'per_or_total' && b.amount === 2000000 && b.baskets === 3 && b.max == null && b.total == null, `"${q}" → hỏi lại tổng hay mỗi giỏ, không tự chia, không tự đặt trần`);
    }
    for (const q of ['mỗi giỏ 2 triệu, lấy 3 giỏ', '2tr/giỏ, 3 giỏ', '2 triệu một giỏ, 3 giỏ']) ok(pb(q) === '-..2000000' && !ai.parseBudget(q).clarify, `"${q}" → tối đa 2tr mỗi giỏ`);
    const t6b = ai.parseBudget('tổng 6 triệu');
    ok(t6b.clarify === 'no_qty' && t6b.max == null, '"Tổng 6 triệu" chưa rõ số giỏ → cần hỏi lại, không tự đặt trần mỗi giỏ');
    ok(ai.parseBudget('tổng 6tr, 1 giỏ 3tr còn 2 giỏ').clarify === 'mixed' && ai.parseBudget('1 giỏ 3tr, 2 giỏ 1tr').clarify === 'mixed', 'Các giỏ ngân sách khác nhau → hỏi lại, không chia đều máy móc');
    ok(pb('không quá 2tr, trên 1tr') === '1000000..2000000' && pb('trên 1tr, tối đa 2tr') === '1000000..2000000', '"Không quá 2tr, trên 1tr" → gộp thành khoảng 1–2tr');
    ok(ai.parseBudget('trên 3tr, dưới 2tr').clarify === 'conflict', 'Điều kiện mâu thuẫn (tối thiểu > tối đa) → cần hỏi lại');

    // ── Ngân sách: lọc + xếp (danh sách giả lập, không đụng dữ liệu) ──
    const P = (id, price, stock = 10) => ({ id, price, stock });
    const names = (r) => r.items.map((p) => p.id).join(',');
    const many = [P(1, 590000), P(2, 690000), P(3, 890000), P(4, 990000), P(5, 1290000), P(6, 1490000), P(7, 1690000), P(8, 1890000), P(9, 2490000), P(10, 3290000)];
    ok(names(ai.rankByBudget(many, { max: 2000000 })).startsWith('8,7,6,5,4,3') && ai.rankByBudget(many, { max: 2000000 }).items.every((p) => p.price <= 2000000),
      'Hơn 6 giỏ hợp ngân sách → 6 giỏ đầu là sát ngân sách nhất (1tr890, 1tr690…), không phải rẻ nhất');
    ok(names(ai.rankByBudget(many, { min: 1000000, max: 1500000 })) === '6,5', 'Khoảng 1tr–1tr5 → chỉ giỏ trong khoảng, sát 1tr5 trước');
    ok(names(ai.rankByBudget(many, { min: 2000000 })) === '9,10', '"Trên 2tr" → chỉ lọc tối thiểu, giữ thứ tự sẵn có, không coi là trần');
    ok(names(ai.rankByBudget(many, { max: 300000 })) === '', 'Không giỏ nào hợp ngân sách → rỗng (không trả giỏ đắt hơn)');
    const junk = [P(1, null), P(2, undefined), P(3, ''), P(4, 'abc'), P(5, 0), P(6, -50000), P(7, NaN), P(8, true), P(9, '1200000'), P(10, 900000)];
    ok(names(ai.rankByBudget(junk, { max: 2000000 })) === '9,10' && names(ai.rankByBudget(junk)) === '9,10', 'Giá thiếu / sai kiểu / bằng 0 / âm → bị loại (giá dạng chuỗi số vẫn nhận)');
    const oos = ai.rankByBudget([P(1, 1900000, 0), P(2, 1800000, '0'), P(3, 1500000), P(4, 1400000, null), P(5, 2500000, 0)], { max: 2000000 });
    ok(names(oos) === '3' && oos.outOfStock === 3, 'Giỏ hết hàng không chiếm chỗ, chỉ đếm (giỏ hết hàng ngoài ngân sách không tính)');
    const tie = [P(11, 1500000), P(12, 1890000), P(13, 1500000), P(14, 1890000), P(15, 1500000)];
    ok(names(ai.rankByBudget(tie, { max: 2000000 })) === '12,14,11,13,15' && names(ai.rankByBudget(tie)) === '11,12,13,14,15', 'Cùng giá → giữ nguyên thứ tự sẵn có (độ khớp từ khóa / bán chạy)');

    // ── Ngân sách: công cụ search_products trên danh mục local ──
    const act = await db('products').where({ is_active: true }).select('price', 'stock');
    const sell = act.filter((p) => p.price > 0 && p.stock > 0);
    const under2 = sell.filter((p) => p.price <= 2000000).map((p) => p.price).sort((a, b) => b - a);
    const sMax = await ai.runTool('search_products', { max_price: 2000000 }, req, out);
    ok(sMax.results.length === Math.min(6, under2.length) && sMax.results.every((p, i) => p.price === under2[i]) && sMax.budget.max === 2000000,
      `search_products max 2tr → giỏ sát 2tr trước (${sMax.results.map((p) => p.price_text).join(', ')})`);
    const sTam = await ai.runTool('search_products', { query: 'tầm 2tr' }, req, out);
    ok(sTam.results.length && sTam.results.every((p) => p.price <= 2000000) && sTam.results[0].price === under2[0], '"tầm 2tr" chỉ trong từ khóa → không giỏ nào vượt 2tr, giỏ sát 2tr trước');
    const sBoth = await ai.runTool('search_products', { query: 'dưới 1tr', max_price: 2000000 }, req, out);
    const sBoth2 = await ai.runTool('search_products', { query: 'tầm 2tr', max_price: 1000000 }, req, out);
    ok(sBoth.results.every((p) => p.price <= 1000000) && sBoth.budget.max === 1000000 && sBoth2.budget.max === 1000000, 'max_price và ngân sách trong câu khác nhau → lấy mức chặt hơn');
    const sRange = await ai.runTool('search_products', { query: 'từ 1tr đến 2tr' }, req, out);
    ok(sRange.results.every((p) => p.price >= 1000000 && p.price <= 2000000) && sRange.results[0].price === under2[0], 'search_products "từ 1tr đến 2tr" → trong khoảng, sát 2tr trước');
    const sMin = await ai.runTool('search_products', { query: 'trên 2tr' }, req, out);
    ok(sMin.results.length && sMin.results.every((p) => p.price > 2000000) && sMin.budget.max === null, 'search_products "trên 2tr" → chỉ giỏ trên 2tr, không có trần');
    const cc = ai.parseBudget('2 triệu cho cả 3 giỏ');
    ok(cc.total === 2000000 && cc.baskets === 3 && cc.max === 666666 && !cc.clarify, '"2 triệu cho cả 3 giỏ" (khách trả lời câu hỏi lại) → tổng, mỗi giỏ tối đa 666k, không hỏi vòng lặp');
    // AI chỉ gửi max_price, bỏ mất "3 giỏ" → vẫn đọc câu khách vừa nhắn và bắt hỏi lại
    const sLastAmb = await ai.runTool('search_products', { max_price: 2000000 }, req, { userText: 'mình cần 3 giỏ 2 triệu' });
    ok(sLastAmb.results.length === 0 && /cho cả 3 giỏ hay/.test(sLastAmb.note || ''), 'Câu khách "3 giỏ 2 triệu" + AI chỉ gửi max_price → không gợi ý, bắt hỏi tổng hay mỗi giỏ');
    const sOkLast = await ai.runTool('search_products', { max_price: 2000000 }, req, { userText: 'biếu sếp tầm 2tr' });
    ok(sOkLast.results.length && sOkLast.results.every((p) => p.price <= 2000000) && !sOkLast.note, 'Câu khách rõ ngân sách mỗi giỏ → gợi ý bình thường');
    const sAnswered = await ai.runTool('search_products', { max_price: 666666 }, req, { userText: '2 triệu cho cả 3 giỏ nhé' });
    ok(!/hay .* cho mỗi giỏ/.test(sAnswered.note || ''), 'Khách đã trả lời "cho cả 3 giỏ" → không hỏi lại lần nữa');
    // Tra cứu đơn: chỉ khi mã đơn + số điện thoại cùng khớp; chỉ trả thông tin khách cần
    {
      const prod = (await db('products').first());
      const [lr] = await db('orders').insert({
        code: 'LN261021TRA1', customer_name: 'Khách Tra', phone: '0912345678', email: 'kin@example.com', address: 'Số 1 Phố Bí Mật', province: 'Hà Nội',
        delivery_date: '2026-12-20', delivery_slot: 'sang', payment_method: 'cod', payment_status: 'deposit', deposit_amount: 300000, deposit_paid_at: new Date(),
        status: 'packing', subtotal: 1000000, discount: 0, shipping_fee: 50000, total: 1050000, admin_note: 'BÍ MẬT NỘI BỘ', shipper: 'Hùng', vat_company: 'Cty Bí Mật',
      });
      const lid = typeof lr === 'object' ? lr.id : lr;
      await db('order_items').insert({ order_id: lid, product_id: prod.id, name: 'Giỏ Thử Tra', price: 500000, qty: 2, line_total: 1000000 });
      try {
        const lreq = () => ({ session: {}, get: () => '' });
        const good = await ai.runTool('lookup_order', { order_code: 'ln261021tra1', phone: '+84 912 345 678' }, lreq(), {});
        ok(good.found && good.tinh_trang === 'Shop đang đóng gói' && good.san_pham[0] === '2 × Giỏ Thử Tra' && good.con_phai_thu_khi_giao === money(750000),
          'lookup_order: mã + SĐT khớp (gõ thường, +84, dấu cách) → đúng tình trạng, sản phẩm, số tiền còn phải thu (trừ cọc)');
        const dump = JSON.stringify(good);
        ok(!/BÍ MẬT|Hùng|Cty|kin@example|Phố Bí Mật|0912345678/.test(dump), 'lookup_order: không lộ ghi chú nội bộ, shipper, hóa đơn, email, địa chỉ, SĐT');
        const bad = await ai.runTool('lookup_order', { order_code: 'LN261021TRA1', phone: '0999888777' }, lreq(), {});
        const none = await ai.runTool('lookup_order', { order_code: 'LN261021ZZZZ', phone: '0912345678' }, lreq(), {});
        ok(bad.found === false && none.found === false && bad.note === none.note && !/packing|đóng gói|Giỏ Thử/.test(JSON.stringify(bad)),
          'lookup_order: sai SĐT hoặc mã không có → cùng một câu trả lời, không lộ đơn có tồn tại');
        ok((await ai.runTool('lookup_order', { order_code: 'abc', phone: '0912345678' }, lreq(), {})).error && (await ai.runTool('lookup_order', { order_code: 'LN261021TRA1', phone: '12' }, lreq(), {})).error,
          'lookup_order: mã sai dạng / SĐT ngắn → nhờ khách đưa lại, chưa tra');
        const sess = { session: {}, get: () => '' };
        for (let i = 0; i < 5; i++) await ai.runTool('lookup_order', { order_code: 'LN261021TRA1', phone: `09000000${i}0` }, sess, {});
        const blocked = await ai.runTool('lookup_order', { order_code: 'LN261021TRA1', phone: '0912345678' }, sess, {});
        ok(blocked.error && /quá nhiều lần/.test(blocked.error) && !blocked.found, 'lookup_order: sai 5 lần trong một cuộc trò chuyện → chặn, kể cả lần có SĐT đúng');
        await db('orders').where({ id: lid }).update({ status: 'cancelled' });
        const cx = await ai.runTool('lookup_order', { order_code: 'LN261021TRA1', phone: '0912345678' }, lreq(), {});
        ok(cx.tinh_trang === 'Đơn đã hủy' && !cx.con_phai_thu_khi_giao, 'lookup_order: đơn đã hủy → báo hủy, không còn số tiền phải thu');
      } finally {
        await db('order_items').where({ order_id: lid }).del();
        await db('orders').where({ id: lid }).del();
      }
    }
    const sNone = await ai.runTool('search_products', { max_price: 100000 }, req, out);
    ok(sNone.results.length === 0 && /KHÔNG tự gợi ý giỏ vượt ngân sách/.test(sNone.note || ''), 'Không giỏ nào trong ngân sách → rỗng + dặn AI hỏi khách điều chỉnh');
    const sAll = await ai.runTool('search_products', { query: 'ruou vang' }, req, out);
    ok(sAll.results.length && sAll.results.every((p) => p.in_stock !== 'hết hàng') && !sAll.note && !sAll.budget, 'Không nêu ngân sách → không lọc giá, không có giỏ hết hàng');
    // Khoảng giá: không giỏ nào dưới min / trên max
    const all = sell.map((p) => p.price);
    for (const q of ['2 đến 3 triệu', '2-3tr', 'từ 1tr5 tới 2tr', 'không quá 2tr, trên 1tr']) {
      const b = ai.parseBudget(q);
      const r = await ai.runTool('search_products', { query: q }, req, out);
      const want = all.filter((x) => x >= b.min && x <= b.max).sort((x, y) => y - x).slice(0, 6);
      ok(r.results.every((p) => p.price >= b.min && p.price <= b.max) && r.results.map((p) => p.price).join() === want.join() && r.budget.min === b.min && r.budget.max === b.max,
        `search_products "${q}" → chỉ giỏ trong khoảng, sát mức trên trước (${r.results.map((p) => p.price_text).join(', ') || 'rỗng'})`);
    }
    // Tổng nhiều giỏ
    const sTot = await ai.runTool('search_products', { query: 'tổng 6 triệu cho 3 giỏ' }, req, out);
    ok(sTot.results.length && sTot.results.every((p) => p.price <= 2000000) && sTot.budget.max === 2000000 && /mỗi giỏ tối đa/.test(sTot.note || ''), 'search_products "tổng 6 triệu cho 3 giỏ" → giỏ ≤ 2tr, nói rõ cách hiểu');
    const sTot2 = await ai.runTool('search_products', { query: 'tổng 6 triệu' }, req, out);
    ok(sTot2.results.length === 0 && /mấy giỏ/.test(sTot2.note || ''), 'search_products "tổng 6 triệu" → rỗng, dặn hỏi số giỏ + ngân sách mỗi giỏ');
    const sConf = await ai.runTool('search_products', { query: 'trên 3tr', max_price: 2000000 }, req, out);
    ok(sConf.results.length === 0 && /mâu thuẫn/.test(sConf.note || ''), 'min_price > max_price → rỗng, dặn hỏi lại (không nới ngân sách)');
    // Từ khóa không khớp: không âm thầm trả giỏ khác
    const sMiss = await ai.runTool('search_products', { query: 'sâm ngọc linh xyz tầm 2tr' }, req, out);
    const sMiss2 = await ai.runTool('search_products', { query: 'xyzqw', max_price: 5000000 }, req, out);
    ok(sMiss.results.length === 0 && /Không có giỏ nào có/.test(sMiss.note || '') && /trong ngân sách/.test(sMiss.note) && sMiss.budget.max === 2000000 && sMiss2.results.length === 0 && /KHÔNG kèm từ khóa/.test(sMiss2.note || ''),
      'Từ khóa không khớp giỏ nào (có ngân sách) → rỗng, dặn hỏi khách có muốn xem giỏ khác, không trả giỏ khác');
    const sGeneric = await ai.runTool('search_products', { query: 'giỏ quà Tết tầm 2tr' }, req, out);
    ok(sGeneric.results.length && sGeneric.results.every((p) => p.price <= 2000000) && !sGeneric.note, 'Chỉ chữ chung chung ("giỏ quà Tết") + ngân sách → không coi là từ khóa lạ, vẫn gợi ý trong ngân sách');
    const sWine = await ai.runTool('search_products', { query: 'giỏ quà có rượu vang tầm 2 triệu' }, req, out);
    ok(sWine.results.length && sWine.results.every((p) => p.price <= 2000000 && /vang/i.test(p.name + p.description + p.contents.join(' '))), '"rượu vang tầm 2 triệu" → chỉ giỏ có rượu vang, không quá 2tr');
    // D1 qua công cụ: "2 triệu cho 3 giỏ" → rỗng + câu hỏi đúng mẫu
    const sAmb = await ai.runTool('search_products', { query: '2 triệu cho 3 giỏ' }, req, out);
    ok(sAmb.results.length === 0 && /cho cả 3 giỏ hay .* cho mỗi giỏ ạ\?/.test(sAmb.note || ''), 'search_products "2 triệu cho 3 giỏ" → rỗng, hỏi "cho cả 3 giỏ hay cho mỗi giỏ"');

    // D2: dịp tặng / người nhận KHÔNG bắt buộc có trong giỏ; thành phần thì bắt buộc
    const hasWord = (p, w) => (p.name + ' ' + p.description + ' ' + p.contents.join(' ')).toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(w);
    const sBoss = await ai.runTool('search_products', { query: 'biếu sếp tầm 2tr' }, req, out);
    ok(sBoss.results.length && sBoss.results[0].price === under2[0] && sBoss.results.every((p) => p.price <= 2000000) && /không nói giỏ "chuyên dành cho"/.test(sBoss.note || ''),
      `"biếu sếp tầm 2tr" → vẫn có giỏ ≤ 2tr (${sBoss.results[0] && sBoss.results[0].price_text}), dặn không nói "chuyên dành cho sếp"`);
    const sBoss2 = await ai.runTool('search_products', { query: 'biếu sếp' }, req, out);
    ok(sBoss2.results.length >= 4 && sBoss2.results[0].occasion_match === true && sBoss2.results.some((p) => p.occasion_match === false), '"biếu sếp" → giỏ danh mục Biếu sếp lên đầu (occasion_match), vẫn kèm giỏ khác');
    for (const q of ['tặng người yêu', 'quà cho cô giáo tầm 1tr', 'tặng vợ']) {
      const r = await ai.runTool('search_products', { query: q }, req, out);
      ok(r.results.length && !/Không có giỏ nào có/.test(r.note || '') && (!/1tr/.test(q) || r.results.every((p) => p.price <= 1000000)), `"${q}" → dịp/người nhận không bắt buộc, vẫn gợi ý trong ngân sách`);
    }
    const sTeacher = await ai.runTool('search_products', { query: 'tặng thầy cô' }, req, out);
    ok(sTeacher.results[0].occasion_match === true && /thầy cô/.test(sTeacher.results[0].description), '"tặng thầy cô" → giỏ mô tả "tặng thầy cô" đứng đầu');
    const sVo = await ai.runTool('search_products', { query: 'tặng vợ' }, req, out);
    ok(sVo.results.every((p) => p.occasion_match === false), '"tặng vợ" không khớp nhầm chữ "vỏ" (hạt nứt vỏ)');
    const sWineBoss = await ai.runTool('search_products', { query: 'rượu vang biếu sếp tầm 2tr' }, req, out);
    ok(sWineBoss.results.length && sWineBoss.results.every((p) => p.price <= 2000000 && hasWord(p, 'vang')), '"rượu vang biếu sếp tầm 2tr" → chỉ giỏ có vang ≤ 2tr; "biếu sếp" không bắt buộc');
    const sCake = await ai.runTool('search_products', { query: 'giỏ có bánh và trà' }, req, out);
    ok(sCake.results.length && sCake.results.every((p) => hasWord(p, 'bánh') && hasWord(p, 'trà')) && sCake.results[0].has_requested.join() === 'bánh,trà', '"bánh và trà" → 2 thành phần, giỏ phải có cả hai');

    // Thành phần không có trong dữ liệu / khớp nửa chữ → rỗng, hỏi khách
    for (const q of ['giỏ có nhân sâm dưới 3 triệu', 'nấm linh chi', 'nấm linh chi đỏ', 'giỏ có thành phần xyz-987']) {
      const r = await ai.runTool('search_products', { query: q }, req, out);
      ok(r.results.length === 0 && /Không có giỏ nào có/.test(r.note || '') && /muốn xem các giỏ khác/.test(r.note), `"${q}" → rỗng (dữ liệu không xác nhận), hỏi khách có muốn xem giỏ khác`);
    }
    const sVang = await ai.runTool('search_products', { query: 'vang' }, req, out);
    ok(sVang.results.every((p) => hasWord(p, 'vang')), '"vang" (rượu) không khớp nhầm "vàng" (viền vàng)');
    const sTra = await ai.runTool('search_products', { query: 'tra' }, req, out);
    ok(sTra.results.length && sTra.results.every((p) => hasWord(p, 'trà')), 'Gõ không dấu "tra" → vẫn ra giỏ có trà');
    const sCafe = await ai.runTool('search_products', { query: 'cafe' }, req, out);
    ok(sCafe.results.length && sCafe.results.every((p) => hasWord(p, 'cà') && hasWord(p, 'phê')), '"cafe" → giỏ ghi "cà phê" (tên gọi tương đương)');

    // Phủ định: không khẳng định giỏ nào đáp ứng, nhờ nhân viên xác nhận
    for (const q of ['không cồn', 'giỏ không có rượu tầm 2tr', 'kiêng đường']) {
      const r = await ai.runTool('search_products', { query: q }, req, out);
      ok(r.results.length === 0 && /không xác nhận được/.test(r.note || '') && /transfer_to_human/.test(r.note) && /request_callback/.test(r.note), `"${q}" → rỗng, không giới thiệu giỏ (kể cả giỏ có rượu), nhờ nhân viên xác nhận`);
    }
    const sNotNeg = await ai.runTool('search_products', { query: 'không biết chọn gì tầm 1tr' }, req, out);
    ok(sNotNeg.results.length && sNotNeg.results.every((p) => p.price <= 1000000), '"không biết chọn gì tầm 1tr" không bị coi là yêu cầu phủ định / thành phần lạ');

    // max_price không hợp lệ: không biến thành tìm không giới hạn
    for (const mp of [0, -500000]) {
      const r = await ai.runTool('search_products', { query: 'ruou vang', max_price: mp }, req, out);
      ok(r.results.length === 0 && r.error && /max_price không hợp lệ/.test(r.note || ''), `max_price = ${mp} → từ chối, không tìm không giới hạn`);
    }
    const d1 = await ai.runTool('delivery_options', { province: 'TP. Hồ Chí Minh' }, req, out);
    ok(d1.earliest_delivery >= todayVN(3) && typeof d1.slots_available === 'string', 'delivery_options: tỉnh khác sớm nhất +3 ngày, không hẹn buổi');
    const bad = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 1 }], customer_name: 'A', phone: '123', province: 'Hà Nội', address: 'x', is_gift: false, delivery_date: todayVN(2), payment_method: 'bank' }, req, out);
    ok(bad.error && !req.session.cart, 'prepare_order: SĐT sai → báo lỗi, không đụng giỏ');
    const closed = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 1 }], customer_name: 'A', phone: '0912345678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: false, delivery_date: '2027-02-07', payment_method: 'bank' }, req, out);
    ok(/nghỉ Tết/.test(closed.error || ''), 'prepare_order: ngày nghỉ Tết → từ chối');
    const good = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 2 }], customer_name: 'Chị Mai', phone: '0912 345 678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: true,
      recipient_name: 'Bác Ba', recipient_phone: '0987654321', recipient_address: '5 Hàng Bông', delivery_date: todayVN(3), delivery_slot: 'sang', card_message: 'Chúc bác an khang', payment_method: 'cod' }, req, out);
    ok(good.ok && req.session.cart.lines[0].qty === 2 && req.session.aiPrefill.payment_method === 'bank' && req.session.aiPrefill.delivery_slot === 'sang',
      'prepare_order: bỏ 2 giỏ vào giỏ khách, điền sẵn; đơn tặng chọn COD → chuyển khoản');
    ok(out.action && out.action.url === '/thanh-toan?tu-van=1', 'Trả về nút "Kiểm tra & đặt hàng"');
    // Đơn nhiều giỏ (từ 5) cần 2 ngày chuẩn bị
    const d10 = await ai.runTool('delivery_options', { province: 'Hà Nội', qty: 10 }, req, out);
    ok(d10.earliest_delivery >= todayVN(2) && /2–3 ngày chuẩn bị/.test(d10.preparation_note || ''), 'delivery_options: 10 giỏ ở Hà Nội → sớm nhất sau 2 ngày');
    const rush = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 10 }], customer_name: 'Cty A', phone: '0912345678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: false, delivery_date: todayVN(1), payment_method: 'bank' }, { session: {} }, {});
    ok(/sớm nhất từ/.test(rush.error || ''), 'prepare_order: 10 giỏ giao ngày mai → từ chối, nói ngày sớm nhất');
    const cod5 = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 5 }], customer_name: 'Cty B', phone: '0912345678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: false, delivery_date: todayVN(4), payment_method: 'cod' }, { session: {} }, {});
    const need = Math.ceil((cod5.total * 0.5) / 1000) * 1000;
    ok(cod5.ok && (cod5.deposit_text || '').includes(require('../src/lib/format').money(need)), `COD 5 giỏ → AI báo cọc 50% (${cod5.deposit_text})`);
    const d30 = await ai.runTool('delivery_options', { province: 'Hà Nội', qty: 30 }, req, out);
    ok(d30.earliest_delivery >= todayVN(5) && /5–10 ngày chuẩn bị tùy tình hình thực tế/.test(d30.preparation_note || ''), 'delivery_options: 30 giỏ → sớm nhất sau 5 ngày, báo 5–10 ngày tùy thực tế');
    const d120 = await ai.runTool('delivery_options', { province: 'Hà Nội', qty: 120 }, req, out);
    ok(/xem xét và báo lại thời gian chuẩn bị/.test(d120.preparation_note || ''), 'delivery_options: 120 giỏ → không hứa thời gian, Lunar Lucky xem xét báo lại');
    const d12 = await ai.runTool('delivery_options', { province: 'Hà Nội', qty: 12 }, req, out);
    ok(d12.earliest_delivery < todayVN(5) && /2–3 ngày/.test(d12.preparation_note || ''), 'delivery_options: 12 giỏ → 2–3 ngày');
    // Giới hạn số giỏ/ngày: ngày kín → AI không nhận, gợi ý ngày khác
    const booked = await require('../src/lib/capacity').bookedByDate();
    const busy = Object.entries(booked).filter(([d]) => d >= todayVN(3)).sort((x, y) => y[1] - x[1])[0];
    if (busy) {
      const capBefore = (await settings.all()).daily_capacity;
      await settings.save({ daily_capacity: String(busy[1]) });
      const dFull = await ai.runTool('delivery_options', { province: 'Hà Nội', qty: 1 }, req, out);
      ok((dFull.full_dates || []).includes(busy[0]) && !dFull.next_options.includes(busy[0]), `Ngày ${busy[0]} đủ ${busy[1]} giỏ → AI biết ngày kín, không gợi ý`);
      const pFull = await ai.runTool('prepare_order', { items: [{ product_id: prod.id, qty: 1 }], customer_name: 'A', phone: '0912345678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: false, delivery_date: busy[0], payment_method: 'bank' }, { session: {} }, {});
      ok(/đã nhận đủ đơn/.test(pFull.error || ''), 'prepare_order: ngày kín → từ chối');
      await settings.save({ daily_capacity: capBefore || '0' });
    } else ok(true, '(bỏ qua kiểm tra ngày kín: chưa có đơn nào)');
    // Voucher riêng: chưa cài → không tặng; có mã → tặng, prepare_order tự trừ; mã lạ khách đưa → bỏ qua
    const vBefore = (await settings.all()).ai_voucher_code;
    await settings.save({ ai_voucher_code: '' });
    const v0 = await ai.runTool('give_voucher', { reason: 'thử' }, req, out);
    await db('coupons').where({ code: 'AITEST5' }).del();
    await db('coupons').insert({ code: 'AITEST5', type: 'percent', value: 5, min_order: 0, is_active: true });
    await settings.save({ ai_voucher_code: 'AITEST5' });
    const v1 = await ai.runTool('give_voucher', { reason: 'khách mặc cả lần 2' }, req, out);
    const base = { items: [{ product_id: prod.id, qty: 1 }], customer_name: 'A', phone: '0912345678', province: 'Hà Nội', address: '1 Phố Huế', is_gift: false, delivery_date: todayVN(3), payment_method: 'bank' };
    const withV = await ai.runTool('prepare_order', { ...base, coupon_code: 'aitest5' }, { session: {} }, {});
    const fake = await ai.runTool('prepare_order', { ...base, coupon_code: 'GIAMSAU50' }, { session: {} }, {});
    ok(v0.error && v1.code === 'AITEST5' && /giảm 5%/.test(v1.discount_text) && /Đã trừ voucher AITEST5/.test(withV.voucher || '') && withV.total < fake.total && !fake.voucher,
      'Voucher: chưa cài thì không tặng; có mã thì tặng và tự trừ vào đơn; mã lạ khách tự đưa bị bỏ qua');
    await db('coupons').where({ code: 'AITEST5' }).del();
    await settings.save({ ai_voucher_code: vBefore || '' });
    const sysNow = await ai.systemPrompt();
    ok(/CẨM NANG CHỐT KHÁCH/.test(sysNow) && /KHÔNG giảm giá/.test(sysNow) && /không bịa "sắp hết"/.test(sysNow), 'Lời dặn có cẩm nang chốt khách khó (không giảm giá, không bịa khan hiếm)');
    ok(/hóa đơn khống[\s\S]{0,300}chuyển chuyên viên NGAY/.test(sysNow), 'Khách đòi hóa đơn khống / VAT khác giá → chuyển chuyên viên ngay');
    ok(/xuất VAT[\s\S]{0,400}nhắn Zalo[\s\S]{0,200}mã số thuế/.test(sysNow) && /NGOẠI LỆ duy nhất: đơn xuất hóa đơn VAT/.test(require('fs').readFileSync(require.resolve('../src/lib/ai-sales.js'), 'utf8')), 'Khách hỏi xuất VAT → mời nhắn Zalo gửi thông tin xuất hóa đơn (cả Fanpage)');
    ok(/mô hình bán hàng online kết hợp giao hàng tận nơi/.test(sysNow) && /cung cấp hình ảnh, video thực tế/.test(sysNow) && /trải nghiệm chưa được như mong đợi/.test(sysNow), 'Lời dặn có câu mẫu của chủ shop: showroom, sợ chuyển khoản, khách gắt');
    ok(/XEM GIỎ THẬT[\s\S]{0,200}xin số Zalo[\s\S]{0,300}request_callback NGAY/.test(sysNow), 'Khách muốn xem giỏ thật → xin số Zalo, báo chuyên viên ngay');
    ok(/KHÔNG bắt buộc: buổi giao/.test(sysNow) && /gọi prepare_order NGAY/.test(sysNow) && /Sau khi gọi prepare_order: báo khách bấm nút/.test(sysNow), 'Đủ thông tin bắt buộc → lên đơn ngay, không kẹt ở buổi giao');
    ok(/từ 5 giỏ in logo lên thiệp; từ 100 giỏ in logo lên hộp và nơ/.test(sysNow) && /5–20 giỏ: cần 2–3 ngày chuẩn bị; 21–99 giỏ: cần 5–10 ngày chuẩn bị tùy tình hình thực tế; từ 100 giỏ: Lunar Lucky sẽ xem xét và báo lại/.test(sysNow) && /Trần Thị Lan → "chị Lan"/.test(sysNow) && /đơn từ 5 giỏ đặt cọc 50%/.test(sysNow), 'Lời dặn AI: in logo đúng mức, nhắc thời gian chuẩn bị đơn nhiều giỏ');

    // Vòng chat với Claude giả lập: gọi search_products rồi trả lời
    const calls = [];
    ai._setClient({ beta: { messages: { create: async (params) => {
      calls.push(params);
      if (calls.length === 1) return { stop_reason: 'tool_use', model: 'fake', usage: {}, content: [{ type: 'tool_use', id: 'tu1', name: 'search_products', input: { query: 'bo me', max_price: 2000000 } }] };
      return { stop_reason: 'end_turn', model: 'fake', usage: {}, content: [{ type: 'text', text: 'Em gợi ý **Giỏ An Khang** ạ.' }] };
    } } } });
    const chatReq = { session: {} };
    const r = await ai.chat(chatReq, 'Tôi muốn quà cho bố mẹ khoảng 2 triệu');
    ok(r.reply.includes('Giỏ An Khang') && calls.length === 2, 'Chat: AI gọi công cụ rồi trả lời');
    const p0 = calls[0];
    ok(p0.model === 'claude-opus-5-5' && p0.fallbacks === 'default' && p0.betas.includes('server-side-fallback-2026-07-01') && p0.system[0].cache_control, 'Gọi Claude Opus 5.5, có dự phòng khi từ chối, có cache lời dặn');
    ok(p0.thinking && p0.thinking.block_binding && p0.thinking.block_binding.prefix_mismatch_behavior === 'drop_block' && p0.betas.includes('thinking-binding-controls-2026-08-01'),
      'Đổi giá/sản phẩm giữa cuộc trò chuyện → Claude bỏ suy nghĩ cũ không khớp thay vì lỗi 400');
    const tr = calls[1].messages.find((m) => Array.isArray(m.content) && m.content[0].type === 'tool_result');
    ok(tr && JSON.parse(tr.content[0].content).results, 'Kết quả công cụ được gửi lại cho AI');
    ok(chatReq.session.aiChat.length === 4, 'Lịch sử trò chuyện lưu trong phiên (chỉ nối thêm)');

    // Chế độ auto: ít khách → Sonnet, đông khách → Opus; Sonnet lỗi 400 → tự thử lại bằng Opus
    ok(ai.pickModel({ ai_model: 'auto', ai_busy_from: '100000' }) === 'claude-sonnet-5-5' && ai.pickModel({ ai_model: 'auto', ai_busy_from: '0' }) === 'claude-opus-5-5' && ai.pickModel({}) === 'claude-opus-5-5', 'Chọn mô hình: auto theo số tin trong ngày, mặc định Opus');
    const mBefore = (await settings.all()).ai_model;
    await settings.save({ ai_model: 'claude-sonnet-5-5' });
    const used = [];
    ai._setClient({ beta: { messages: { create: async (p) => { used.push(p.model); if (p.model === 'claude-sonnet-5-5') { const e = new Error('bad'); e.status = 400; throw e; } return { stop_reason: 'end_turn', model: p.model, usage: {}, content: [{ type: 'text', text: 'Dạ em đây ạ' }] }; } } } });
    const rs = await ai.chat({ session: {} }, 'chào shop');
    ok(rs.reply === 'Dạ em đây ạ' && used.join(',') === 'claude-sonnet-5-5,claude-opus-5-5', 'Sonnet lỗi → tự thử lại bằng Opus, khách vẫn được trả lời');
    await settings.save({ ai_model: mBefore || '' });

    // "3 giỏ 2 triệu" ngay tin đầu → lời dặn bắt hỏi tổng hay mỗi giỏ đi kèm tin khách
    let sent = '';
    ai._setClient({ beta: { messages: { create: async (p) => { sent = JSON.stringify(p.messages.at(-1).content); return { stop_reason: 'end_turn', model: p.model, usage: {}, content: [{ type: 'text', text: 'Dạ' }] }; } } } });
    await ai.chat({ session: {} }, 'mình cần 3 giỏ 2 triệu');
    ok(/cho cả 3 giỏ hay 2\.000\.000₫ cho mỗi giỏ/.test(sent) && /để câu xin tên sang tin sau/.test(sent), 'Tin "3 giỏ 2 triệu" → AI được dặn hỏi lại tổng hay mỗi giỏ ngay, kể cả tin đầu');
    await ai.chat({ session: {} }, 'biếu sếp tầm 2tr');
    ok(!/tổng hay mỗi giỏ/.test(sent), 'Ngân sách rõ ràng → không gắn lời dặn hỏi lại');

    // Lỗi API → không làm hỏng lịch sử
    ai._setClient({ beta: { messages: { create: async () => { const e = new Error('overloaded'); e.status = 529; throw e; } } } });
    const r2 = await ai.chat(chatReq, 'còn mẫu nào khác không');
    ok(r2.error && chatReq.session.aiChat.length === 4, 'Claude lỗi → báo khách gửi lại, lịch sử giữ nguyên');

    // Tắt trong Cài đặt
    const before = (await settings.all()).ai_chat_enabled;
    await settings.save({ ai_chat_enabled: '0' });
    const r3 = await ai.chat({ session: {} }, 'hi');
    ok(r3.off, 'Tắt AI trong Cài đặt → không gọi Claude');
    await settings.save({ ai_chat_enabled: before || '1' });
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
