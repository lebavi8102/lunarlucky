/**
 * Kiểm thử 3 bot: trả lời bình luận Facebook, xin đánh giá sau giao, báo cáo quảng cáo.
 * Facebook / email / Telegram đều giả lập. Chạy: node test/fb-bots.js   (database local)
 * Phần trang đánh giá cần server local: BASE_URL=http://localhost:3000 node test/fb-bots.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
Object.assign(process.env, { FB_PAGE_TOKEN: 'page-tok', FB_APP_SECRET: 'app-secret', FB_ADS_TOKEN: 'ads-tok', FB_AD_ACCOUNT_ID: 'act_123' });
const m = require('../src/lib/messenger');
const comments = require('../src/lib/fb-comments');
const reviews = require('../src/lib/reviews');
const ads = require('../src/lib/ads-report');
const notify = require('../src/lib/notify');
const { todayVN } = require('../src/lib/format');

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };
const T = Date.now();
const tg = [];
notify.telegram = async (html, chat, extra = {}) => { tg.push({ html, extra }); return false; };
notify.sendMail = async (opts) => { mails.push(opts); return true; };
const mails = [];
const graphCalls = [];
comments._setGraph(async (path, body) => { graphCalls.push({ path, body }); return { id: 'x' }; });
const sent = [];
m._setSend(async (b) => { sent.push(b); return b.recipient.comment_id ? { recipient_id: `ps${T}`, message_id: 'm1' } : { message_id: 'm2' }; });
const codes = [];

(async () => {
  try {
    await db.migrate.latest();
    const feed = (value) => ({ object: 'page', entry: [{ id: '112418327083235', changes: [{ field: 'feed', value }] }] });
    const base = { item: 'comment', verb: 'add', post_id: `post${T}`, created_time: 1 };

    // 1. Bình luận hỏi giá → trả lời công khai + nhắn riêng, AI biết khách đến từ bình luận
    await m.handleWebhook(feed({ ...base, comment_id: `c1${T}`, message: 'Giá bao nhiêu vậy shop', from: { id: `u1${T}`, name: 'Nguyễn Văn Tuấn' } }));
    const pub = graphCalls.find((g) => g.path === `c1${T}/comments`);
    const priv = sent.find((b) => b.recipient.comment_id === `c1${T}`);
    ok(pub && /đã nhắn tin riêng cho anh\/chị Tuấn/.test(pub.body.message), 'Bình luận "giá" → trả lời công khai, gọi tên khách');
    ok(priv && /Giỏ quà Tết bên em có giá từ/.test(priv.message.text) && priv.message.metadata === m.AI_TAG, 'Nhắn riêng cho khách (private reply) kèm khoảng giá, hỏi tặng ai / ngân sách');
    const th = await db('messenger_threads').where({ psid: `ps${T}` }).first();
    ok(th && th.name === 'Nguyễn Văn Tuấn' && JSON.parse(th.notes || '[]').some((x) => x === 'Khách bình luận Facebook: "Giá bao nhiêu vậy shop"'), 'Ghi tên khách + nội dung bình luận cho AI nói tiếp đúng mạch');
    // lặp / trùng / khen / trang tự bình luận
    graphCalls.length = 0; sent.length = 0;
    await m.handleWebhook(feed({ ...base, comment_id: `c1${T}`, message: 'Giá bao nhiêu vậy shop', from: { id: `u1${T}`, name: 'Nguyễn Văn Tuấn' } }));
    await m.handleWebhook(feed({ ...base, comment_id: `c2${T}`, message: 'ib mình với', from: { id: `u1${T}`, name: 'Nguyễn Văn Tuấn' } }));
    await m.handleWebhook(feed({ ...base, comment_id: `c3${T}`, message: 'Đẹp quá', from: { id: `u3${T}`, name: 'Lan' } }));
    await m.handleWebhook(feed({ ...base, comment_id: `c4${T}`, message: 'Giá?', from: { id: '112418327083235', name: 'Lunar Lucky' } }));
    ok(!graphCalls.length && !sent.length, 'Không trả lời: bình luận trùng, cùng người cùng bài trong 24h, lời khen, trang tự bình luận');
    // Bình luận có SĐT → ẩn + gọi lại
    tg.length = 0;
    await m.handleWebhook(feed({ ...base, comment_id: `c5${T}`, message: 'Tư vấn em 0912 345 678', from: { id: `u5${T}`, name: 'Trần Thị Hoa' } }));
    ok(graphCalls.some((g) => g.path === `c5${T}` && g.body.is_hidden === true), 'Bình luận có SĐT → ẩn bình luận (bảo mật số)');
    ok(tg.some((x) => /GỌI LẠI/.test(x.html) && /0912345678/.test(x.html)), 'Bình luận có SĐT → báo nhóm gọi lại');

    // 2. Xin đánh giá sau giao
    const prod = await db('products').where({ is_active: true }).first();
    const mk = async (code, extra) => {
      const [id] = await db('orders').insert({ code, customer_name: 'Lê Thị Mai', phone: '0912000222', province: 'Hà Nội', address: 'x', delivery_date: todayVN(), payment_method: 'bank', payment_status: 'paid', status: 'completed', subtotal: 1, discount: 0, shipping_fee: 0, total: 1, created_at: new Date(), ...extra });
      const oid = typeof id === 'object' ? id.id : id;
      await db('order_items').insert({ order_id: oid, product_id: prod.id, name: prod.name, price: prod.price, qty: 1, line_total: prod.price });
      codes.push(code);
      return oid;
    };
    await mk(`LN26RV${String(T).slice(-6)}`, { email: 'mai@example.com', completed_at: new Date(Date.now() - 4 * 3600000) });
    await mk(`LN26RW${String(T).slice(-6)}`, { email: 'mai@example.com', completed_at: new Date(Date.now() - 1 * 3600000) });
    mails.length = 0;
    const n = await reviews.requestReviews({ force: true });
    ok(n >= 1 && mails.some((x) => x.template === 'review-request' && /\/danh-gia\/LN26RV/.test(x.data.url)) && !mails.some((x) => /LN26RW/.test(x.data.url)), 'Đơn hoàn tất 4 giờ trước → gửi email xin đánh giá; đơn vừa giao 1 giờ → chưa gửi');
    ok(await reviews.requestReviews({ force: true }) === 0, 'Mỗi đơn chỉ xin 1 lần');

    if (process.env.BASE_URL) {
      const B = process.env.BASE_URL;
      const code = codes[0];
      const url = reviews.link(code).replace(/^https?:\/\/[^/]+/, '');
      let cookie = '';
      const go = async (u, o = {}) => { const r = await fetch(B + u, { redirect: 'manual', ...o, headers: { cookie, ...(o.headers || {}) } }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; '); return { r, text: await r.text() }; };
      const page = await go(url);
      ok(page.r.status === 200 && /Bạn chấm mấy sao/.test(page.text), 'Link đánh giá mở được trang chấm sao');
      ok((await go(`/danh-gia/${code}?k=sai`)).r.status === 404, 'Link sai khóa → không mở được');
      const action = (/<form class="card" action="([^"]+)"/.exec(page.text) || [])[1].replace(/&amp;/g, '&');
      const fd = new FormData();
      fd.append('rating', '5'); fd.append('content', 'Bố mẹ rất thích, giỏ đẹp'); fd.append('consent', '1');
      const post = await go(action, { method: 'POST', body: fd });
      const t = await db('testimonials').where({ order_code: code }).first();
      ok(post.r.status === 302 && t && t.rating === 5 && !t.is_active && t.source === 'customer', 'Gửi đánh giá 5★ → lưu chờ duyệt (khách đồng ý đăng)');
      const again = await go(url);
      ok(/cảm ơn/i.test(again.text) && !/Bạn chấm mấy sao/.test(again.text), 'Đã đánh giá → mở lại chỉ thấy lời cảm ơn');
      await db('testimonials').where({ order_code: code }).del();
    } else console.log('… bỏ qua phần trang đánh giá (chưa đặt BASE_URL)');
    const oRv = await db('orders').where({ code: codes[0] }).first();
    tg.length = 0;
    await reviews.saveReview(oRv, { rating: 2, content: 'Giao muộn', imageId: null, consent: false });
    ok(tg.some((x) => /⭐⭐ <b>Khách đánh giá/.test(x.html) && /Đánh giá thấp/.test(x.html) && /không<\/b> đồng ý/.test(x.html)), 'Đánh giá thấp → báo nhóm gọi hỏi thăm; khách không đồng ý đăng → không đăng');
    await db('testimonials').where({ order_code: codes[0] }).del();

    // 3. Báo cáo quảng cáo: quảng cáo nào ra đơn
    const yday = todayVN(-1);
    await mk(`LN26AD${String(T).slice(-6)}`, { status: 'confirmed', source: 'ai_fb', ad_id: '9988776655', total: 1890000, created_at: new Date(`${yday}T10:00:00+07:00`) });
    ads._setInsights(async () => [
      { ad_id: '9988776655', ad_name: 'Video giỏ Cát Tường', campaign_name: 'Tết 2027 - Tin nhắn', spend: '350000', clicks: '120', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '14' }] },
      { ad_id: '111', ad_name: 'Ảnh bộ sưu tập', campaign_name: 'Tết 2027 - Tin nhắn', spend: '250000', clicks: '80', actions: [] },
    ]);
    const rep = await ads.report(yday);
    ok(/Chi <b>600\.000/.test(rep) && /14 người nhắn/.test(rep) && /Video giỏ Cát Tường[\s\S]*<b>1 đơn<\/b> \(1\.890\.000/.test(rep) && /Ảnh bộ sưu tập[\s\S]*chưa ra đơn/.test(rep), 'Báo cáo: tổng chi, tin nhắn, đơn theo từng quảng cáo, cảnh báo quảng cáo chưa ra đơn');
    // Khách bấm quảng cáo → nhớ mã quảng cáo
    await m.handleWebhook({ object: 'page', entry: [{ id: '112418327083235', messaging: [{ sender: { id: `pa${T}` }, recipient: { id: 'PAGE' }, referral: { source: 'ADS', ad_id: '9988776655' } }] }] });
    ok((await db('messenger_threads').where({ psid: `pa${T}` }).first() || {}).ad_id === '9988776655', 'Khách bấm quảng cáo "Gửi tin nhắn" → nhớ mã quảng cáo để tính đơn');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    const ids = (await db('orders').whereIn('code', codes)).map((o) => o.id);
    await db('order_items').whereIn('order_id', ids).del();
    await db('orders').whereIn('id', ids).del();
    await db('fb_comments').where('comment_id', 'like', `%${T}`).del();
    await db('messenger_threads').where('psid', 'like', `%${T}`).del();
    await db('callback_requests').where({ phone: '0912345678', note: 'Bình luận Facebook (đã ẩn số)' }).del().catch(() => {});
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
