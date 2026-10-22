/**
 * Bot tự nhắc việc vận hành (không cần ai nhớ gõ lệnh):
 *  - Sáng (mặc định 7h): việc hôm nay — đơn giao theo buổi, đơn tỉnh phải gửi chuyển phát,
 *    đơn quá ngày giao chưa xong, đơn mới chưa ai xử lý, soạn trước cho ngày mai.
 *  - Trong ngày (8h–21h, 30 phút/lần): đơn đã sẵn sàng mà quá 2 giờ chưa ai bấm xác nhận → nhắc 1 lần.
 *  - Tối (mặc định 21h): đơn hôm nay chưa giao xong + đối soát tiền COD.
 * Mốc "đã gửi" lưu trong settings nên khởi động lại máy chủ không gửi trùng.
 */
const db = require('../db');
const settings = require('./settings');
const notify = require('./notify');
const payment = require('./payment');
const delivery = require('./delivery');
const { todayVN, money, slotLabel } = require('./format');

const e = notify.escapeTg;
const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const hourVN = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
const isHanoi = (o) => /hà nội/i.test(String(o.province || ''));
const ymd = (v) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(v) : String(v || '').slice(0, 10));
const readyNew = (w) => w.where({ status: 'new' }).andWhere((x) => x.whereIn('payment_status', ['paid', 'deposit']).orWhere((y) => y.where({ payment_method: 'cod', deposit_amount: 0 })));

async function morning(day = todayVN()) {
  const s = await settings.all();
  const plan = await delivery.forDate(day);
  const lines = [`☀️ <b>VIỆC HÔM NAY ${dm(day)}</b>`];

  if (plan.ready.length) {
    const bySlot = {};
    for (const o of plan.ready) bySlot[o.delivery_slot || ''] = (bySlot[o.delivery_slot || ''] || 0) + 1;
    const slots = ['sang', 'chieu', 'toi', ''].filter((k) => bySlot[k]).map((k) => `${k ? slotLabel(k).split(' ')[0] : 'Không hẹn buổi'} ${bySlot[k]}`).join(' · ');
    lines.push(`🚚 Giao <b>${plan.ready.length} đơn · ${plan.baskets} giỏ</b> (${slots})${plan.codTotal ? ` · thu COD ${money(plan.codTotal)}` : ''}`);
    lines.push('Gõ <code>/giao</code> để xem danh sách chi tiết.');
  } else {
    lines.push('🚚 Hôm nay không có đơn cần giao.');
  }
  if (plan.unpaid.length) lines.push(`⏳ ${plan.unpaid.length} đơn giao hôm nay vẫn chờ chuyển khoản/cọc — chưa soạn.`);

  // Đơn tỉnh: phải gửi chuyển phát trong hôm nay để kịp ngày giao
  const lead = Math.max(1, (Number(s.province_min_days) || 3) - 1);
  const until = todayVN(lead);
  const send = (await db('orders').whereIn('status', ['new', 'confirmed', 'packing']).where('delivery_date', '>', day).andWhere('delivery_date', '<=', until))
    .filter((o) => !isHanoi(o) && !payment.awaitingMoney(o));
  if (send.length) {
    lines.push('', `🚛 <b>Gửi chuyển phát hôm nay (${send.length} đơn tỉnh)</b>`);
    for (const o of send.slice(0, 15)) lines.push(`• ${e(o.code)} · ${e(o.province)} · giao ${dm(ymd(o.delivery_date))}`);
  }

  // Quá ngày giao mà chưa xong
  const overdue = (await db('orders').whereNotIn('status', ['completed', 'cancelled']).where('delivery_date', '<', day).orderBy('delivery_date'))
    .filter((o) => !payment.awaitingMoney(o));
  if (overdue.length) {
    lines.push('', `⚠️ <b>Quá ngày giao chưa hoàn tất (${overdue.length})</b> — giao bù hoặc <code>/doingay</code>`);
    for (const o of overdue.slice(0, 15)) lines.push(`• ${e(o.code)} · ${e(o.customer_name)} · hẹn ${dm(ymd(o.delivery_date))}`);
  }

  const [{ n: todo }] = await db('orders').where(readyNew).count({ n: '*' });
  if (Number(todo)) lines.push('', `🆕 ${todo} đơn mới chưa xác nhận — mở chủ đề Đơn hàng hoặc admin → "Cần xử lý".`);

  // AI tư vấn hôm qua: cuộc chat → nút đặt hàng → đơn
  const yStart = Date.parse(`${todayVN(-1)}T00:00:00+07:00`);
  const st = await require('./ai-learn').stats(yStart, yStart + 86400000).catch(() => null);
  if (st && st.all.chats) {
    lines.push('', `🤖 <b>AI tư vấn hôm qua:</b> ${st.all.chats} khách chat → ${st.all.buttons} lần gửi nút đặt hàng → <b>${st.all.orders} đơn</b> (tỉ lệ chốt ${st.all.rate}%)${st.all.humans ? ` · ${st.all.humans} ca chuyển người` : ''}`);
  }

  // Soạn trước cho ngày mai
  const tmr = await delivery.forDate(todayVN(1));
  if (tmr.ready.length) {
    lines.push('', `📦 <b>Ngày mai ${dm(todayVN(1))}: ${tmr.ready.length} đơn · ${tmr.baskets} giỏ</b> — soạn trước:`);
    lines.push(tmr.picking.slice(0, 12).map((p) => `${e(p.name)} ×${p.qty}`).join(' · '));
  }
  return lines.join('\n');
}

async function evening(day = todayVN()) {
  const plan = await delivery.forDate(day);
  const left = plan.ready.filter((o) => o.status !== 'completed');
  const lines = [`🌙 <b>CHỐT NGÀY ${dm(day)}</b> · đã giao ${plan.ready.length - left.length}/${plan.ready.length} đơn`];
  if (left.length) {
    lines.push(`⚠️ <b>Chưa giao xong (${left.length})</b> — bấm "Đã giao xong" hoặc <code>/doingay</code> nếu khách hẹn lại:`);
    for (const o of left.slice(0, 20)) lines.push(`• ${e(o.code)} · ${e(o.customer_name)}${o.shipper ? ` · 🛵 ${e(o.shipper)}` : ' · chưa ai nhận giao'}`);
  }
  lines.push('', await require('./telegram-orders').codReport(day.slice(8) + '/' + day.slice(5, 7)));
  return lines.join('\n');
}

/** Đơn sẵn sàng mà quá 2 giờ chưa ai xác nhận → nhắc 1 lần (gom chung 1 tin). */
async function remindStale() {
  const rows = await db('orders').where(readyNew).whereNull('ops_reminded_at')
    .andWhere('created_at', '<', new Date(Date.now() - 2 * 3600000)).orderBy('id').limit(20);
  if (!rows.length) return 0;
  await db('orders').whereIn('id', rows.map((o) => o.id)).update({ ops_reminded_at: new Date() });
  const lines = [`⏰ <b>${rows.length} đơn mới quá 2 giờ chưa ai xác nhận</b>`];
  for (const o of rows) lines.push(`• ${e(o.code)} · ${e(o.customer_name)} · ${e(o.phone)} · giao ${dm(ymd(o.delivery_date))}`);
  lines.push('Gọi xác nhận với khách rồi bấm "✅ Xác nhận" trên tin đơn.');
  await notify.telegram(lines.join('\n'), null, { topic: 'ops' });
  return rows.length;
}

async function tick() {
  const s = await settings.all();
  if (String(s.ops_digest) === '0') return;
  const h = hourVN();
  const day = todayVN();
  const mH = Number(s.ops_morning_hour) || 7;
  const eH = Number(s.ops_evening_hour) || 21;
  if (h >= mH && h < eH && s.ops_morning_last !== day) {
    await settings.save({ ops_morning_last: day });
    await notify.telegram(await morning(day), null, { topic: 'ops' });
  }
  if (h >= eH && s.ops_evening_last !== day) {
    await settings.save({ ops_evening_last: day });
    await notify.telegram(await evening(day), null, { topic: 'ops' });
  }
  // Mã trang Facebook sắp hết hạn → báo trước (1 lần mỗi ngày, cùng giờ tin sáng)
  if (h >= mH && h < eH && s.fb_token_check_last !== day) {
    await settings.save({ fb_token_check_last: day });
    await require('./messenger').checkToken().catch(() => {});
  }
  // Báo cáo quảng cáo Facebook của hôm qua (chỉ khi đã cài FB_ADS_TOKEN + FB_AD_ACCOUNT_ID)
  const ads = require('./ads-report');
  if (h >= mH && h < eH && ads.configured() && String(s.ads_report) !== '0' && s.ads_report_last !== day) {
    await settings.save({ ads_report_last: day });
    await notify.telegram(await ads.report(todayVN(-1)), null, { topic: 'ops' });
  }
  if (h >= 8 && h < 21) await remindStale();
  // 22h: AI rút bài học từ các cuộc trò chuyện có nhân viên trả lời → chờ chủ shop duyệt
  if (h >= 22 && String(s.ai_learn) !== '0' && s.ai_learn_last !== day) {
    await settings.save({ ai_learn_last: day });
    await require('./ai-learn').learn().catch((err) => console.error('[AI học] lỗi:', err.message));
  }
  // 23h: gửi file sao lưu Excel (đơn, khách, sản phẩm, chi phí) vào email cửa hàng — phòng khi database gặp sự cố
  if (h >= 23 && String(s.backup_email) !== '0' && s.backup_last !== day && s.shop_email) {
    await settings.save({ backup_last: day });
    await sendBackup(s, day);
  }
}

async function sendBackup(s, day = todayVN()) {
  const buf = await require('./backup').exportXlsx('tat-ca');
  const [{ n }] = await db('orders').count({ n: '*' });
  await notify.sendMail({
    to: s.shop_email,
    subject: `[Sao lưu] Lunar Lucky ${dm(day)}/${day.slice(0, 4)} · ${n} đơn`,
    template: 'backup',
    data: { s, day, orders: Number(n) },
    attachments: [{ filename: `LunarLucky_SaoLuu_${day}.xlsx`, content: buf }],
  });
}

function start() {
  const run = () => tick().catch((err) => console.error('[nhắc việc] lỗi:', err.message));
  setTimeout(run, 60000).unref();
  setInterval(run, 30 * 60000).unref();
}

module.exports = { morning, evening, remindStale, tick, start, sendBackup };
