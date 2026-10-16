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
const { todayVN } = require('../src/lib/format');

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
    const sysNow = await ai.systemPrompt();
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
