/**
 * Kiểm thử báo cáo lợi nhuận với số liệu tự tạo (database local, tự dọn sau khi chạy).
 * Chạy: node test/profit.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
const profit = require('../src/lib/profit');

if (db.isMysql && !process.env.ALLOW_REMOTE) {
  console.error('Test này tạo/xóa dữ liệu thử — chỉ chạy với database local.');
  process.exit(1);
}

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) fails++;
};

(async () => {
  await db.migrate.latest();
  // Kỳ báo cáo riêng (năm 2031) để không lẫn đơn khác
  const day = '2031-01-15';
  const at = new Date(`${day}T10:00:00+07:00`);
  const p = await db('products').first();
  const oldCost = p.cost_price;
  await db('products').where({ id: p.id }).update({ cost_price: 300000 });

  const made = [];
  async function order(over, items) {
    const [id] = await db('orders').insert({
      code: `LN310115T${made.length}Q`, customer_name: 'Thử', phone: '0912345678', address: 'x', province: 'Hà Nội',
      delivery_date: day, payment_method: 'bank', payment_status: 'paid', status: 'new',
      subtotal: 0, discount: 0, shipping_fee: 0, vat_fee: 0, total: 0, created_at: at, ...over,
    });
    const oid = typeof id === 'object' ? id.id : id;
    made.push(oid);
    for (const it of items) await db('order_items').insert({ order_id: oid, product_id: p.id, name: p.name, line_total: it.price * it.qty, ...it });
    return oid;
  }
  // A: CK đã trả: 2 giỏ × 500k, giảm 100k, ship 50k, VAT thu hộ 99k, giá vốn lưu lúc đặt 300k
  await order({ subtotal: 1000000, discount: 100000, shipping_fee: 50000, vat_fee: 99000, total: 1049000 }, [{ price: 500000, qty: 2, unit_cost: 300000 }]);
  // B: COD đã hoàn tất, giá vốn lúc đặt chưa lưu → lấy giá vốn hiện tại (300k)
  await order({ payment_method: 'cod', payment_status: 'pending', status: 'completed', subtotal: 500000, total: 500000 }, [{ price: 500000, qty: 1, unit_cost: null }]);
  // C: COD chưa giao (chưa thu tiền) → không tính
  await order({ payment_method: 'cod', payment_status: 'pending', subtotal: 800000, total: 800000 }, [{ price: 400000, qty: 2, unit_cost: 300000 }]);
  // D: đơn hủy → không tính
  await order({ status: 'cancelled', subtotal: 900000, total: 900000 }, [{ price: 900000, qty: 1, unit_cost: 300000 }]);
  const [e1] = await db('expenses').insert({ spent_on: day, category: 'Bao bì, hộp, thiệp', amount: 60000 });
  const [e2] = await db('expenses').insert({ spent_on: day, category: 'Phí vận chuyển thực trả', amount: 40000 });
  const [e3] = await db('expenses').insert({ spent_on: '2031-02-01', category: 'Khác', amount: 999999 }); // ngoài kỳ

  const r = await profit.report({ from: '2031-01-01', to: '2031-01-31' });
  ok(r.orders === 2, `Chỉ tính đơn đã thu tiền: ${r.orders} đơn (bỏ đơn chưa thu và đơn hủy)`);
  ok(r.revenue === 900000 + 50000 + 500000, `Doanh thu = tiền hàng sau giảm + phí giao = ${r.revenue}`);
  ok(r.vatCollected === 99000, 'Phí VAT thu hộ tách riêng, không tính vào doanh thu');
  ok(r.cogs === 900000, `Giá vốn = 3 giỏ × 300k = ${r.cogs}`);
  ok(r.gross === 1450000 - 900000, `Lợi nhuận gộp = ${r.gross}`);
  ok(r.expenses === 100000 && r.expenseByCat['Bao bì, hộp, thiệp'] === 60000, `Chi phí trong kỳ = ${r.expenses} (bỏ khoản ngoài kỳ)`);
  ok(r.net === 550000 - 100000, `Lợi nhuận cuối = ${r.net}`);
  ok(r.pendingOrders === 1 && r.pendingValue === 800000, 'Đơn chưa thu tiền hiện riêng');
  ok(r.missingCost === 0, 'Không cảnh báo thiếu giá vốn khi sản phẩm đã có giá vốn');
  ok(r.products.length === 1 && r.products[0].qty === 3, 'Bảng theo sản phẩm gộp đúng số lượng');

  await db('products').where({ id: p.id }).update({ cost_price: null });
  const r2 = await profit.report({ from: '2031-01-01', to: '2031-01-31' });
  ok(r2.missingCost === 1, 'Sản phẩm chưa nhập giá vốn → cảnh báo số giỏ thiếu giá vốn');

  const pr = profit.presetRange('thang-truoc', '2031-01-15');
  ok(pr.from === '2030-12-01' && pr.to === '2030-12-31', 'Kỳ "Tháng trước" tính đúng qua năm');
  ok(profit.isPaid({ status: 'completed', payment_status: 'paid' }) && !profit.isPaid({ status: 'completed', payment_status: 'refunded' }),
    'Đơn đã giao nhưng khách trả hàng, đã hoàn tiền → không tính doanh thu');

  await db('order_items').whereIn('order_id', made).del();
  await db('orders').whereIn('id', made).del();
  await db('expenses').whereIn('id', [e1, e2, e3].map((x) => (typeof x === 'object' ? x.id : x))).del();
  await db('products').where({ id: p.id }).update({ cost_price: oldCost ?? null });
  console.log(fails ? `\n${fails} kiểm thử thất bại` : '\nTất cả kiểm thử đều đạt');
  process.exitCode = fails ? 1 : 0;
  await db.destroy();
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await db.destroy();
});
