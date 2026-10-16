/**
 * Báo cáo quảng cáo Facebook mỗi sáng vào Telegram: hôm qua chi bao nhiêu, bao nhiêu người nhắn tin,
 * bao nhiêu đơn — theo TỪNG quảng cáo (khách bấm quảng cáo "Gửi tin nhắn" → Facebook báo mã quảng cáo
 * trong tin đầu tiên → nhớ vào cuộc trò chuyện → đơn đặt từ cuộc trò chuyện đó được tính cho quảng cáo).
 * Cần trên Render: FB_ADS_TOKEN (mã có quyền ads_read) và FB_AD_ACCOUNT_ID (số tài khoản quảng cáo).
 */
const db = require('../db');
const { money, todayVN } = require('./format');

const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v23.0'}`;
const env = () => ({ token: process.env.FB_ADS_TOKEN || '', account: String(process.env.FB_AD_ACCOUNT_ID || '').replace(/^act_/, '') });
const configured = () => !!(env().token && env().account);

const MSG_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply'];

let fetchInsights = async (day) => {
  const { token, account } = env();
  const params = new URLSearchParams({
    level: 'ad', time_range: JSON.stringify({ since: day, until: day }), limit: '100',
    fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks,actions',
  });
  const r = await fetch(`${GRAPH}/act_${account}/insights?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Facebook báo lỗi ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 300));
  return j.data || [];
};

/** Đơn tạo trong ngày (giờ VN), không tính đơn hủy. */
async function ordersOn(day) {
  const start = new Date(`${day}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86400000);
  return db('orders').whereNot('status', 'cancelled').andWhere('created_at', '>=', start).andWhere('created_at', '<', end)
    .select('id', 'code', 'total', 'source', 'ad_id');
}

async function report(day = todayVN(-1)) {
  const e = require('./notify').escapeTg;
  const orders = await ordersOn(day);
  const byAd = {};
  for (const o of orders.filter((x) => x.ad_id)) (byAd[o.ad_id] ||= []).push(o);
  const fbOrders = orders.filter((o) => ['ai_fb', 'facebook'].includes(o.source));
  const dm = `${day.slice(8)}/${day.slice(5, 7)}`;
  const lines = [`📊 <b>QUẢNG CÁO FACEBOOK ${dm}</b>`];
  let rows = [];
  try {
    rows = await fetchInsights(day);
  } catch (err) {
    lines.push(`⚠️ Chưa lấy được số liệu quảng cáo: ${e(err.message)}`);
  }
  let spend = 0; let msgs = 0;
  const items = rows.map((r) => {
    const sp = Math.round(Number(r.spend) || 0);
    const m = (r.actions || []).filter((a) => MSG_ACTIONS.includes(a.action_type)).reduce((x, a) => Math.max(x, Number(a.value) || 0), 0);
    const od = byAd[r.ad_id] || [];
    spend += sp; msgs += m;
    return { name: r.ad_name || r.ad_id, campaign: r.campaign_name, sp, m, clicks: Number(r.clicks) || 0, n: od.length, rev: od.reduce((x, o) => x + Number(o.total), 0) };
  }).filter((x) => x.sp > 0 || x.n > 0).sort((a, b) => b.sp - a.sp);
  if (rows.length || !lines[1]) {
    lines.push(`💸 Chi <b>${money(spend)}</b> · 💬 ${msgs} người nhắn · 🛒 ${fbOrders.length} đơn từ Facebook (${money(fbOrders.reduce((x, o) => x + Number(o.total), 0))})`);
    if (spend && fbOrders.length) lines.push(`➗ Chi phí / đơn: <b>${money(Math.round(spend / fbOrders.length))}</b>${msgs ? ` · / tin nhắn: ${money(Math.round(spend / msgs))}` : ''}`);
    for (const x of items.slice(0, 10)) {
      lines.push(`\n▸ <b>${e(x.name)}</b>${x.campaign ? ` <i>(${e(x.campaign)})</i>` : ''}\n   chi ${money(x.sp)} · ${x.m} tin nhắn · ${x.clicks} lượt bấm · <b>${x.n} đơn</b>${x.n ? ` (${money(x.rev)})` : ''}${x.sp && !x.n && x.sp >= 200000 ? ' · ⚠️ chưa ra đơn' : ''}`);
    }
    if (!items.length && rows.length === 0) lines.push('Hôm qua không có quảng cáo nào chạy.');
  }
  const unknown = fbOrders.filter((o) => !o.ad_id).length;
  if (unknown) lines.push(`\n<i>${unknown} đơn Facebook không rõ từ quảng cáo nào (khách tự nhắn Fanpage / bình luận / đặt hộ).</i>`);
  return lines.join('\n');
}

module.exports = { report, configured, _setInsights: (fn) => { fetchInsights = fn; } };
