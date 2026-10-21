/**
 * Kiểm thử phí giao theo vùng: Hà Nội / tỉnh khác.
 * Chạy: node test/shipping.js   (database local, đã có sản phẩm mẫu)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');
if (db.isMysql && !process.env.ALLOW_REMOTE) { console.error('Chỉ chạy với database local.'); process.exit(1); }
const settings = require('../src/lib/settings');
const cart = require('../src/lib/cart');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };

(async () => {
  const keys = ['shipping_fee', 'free_ship_threshold', 'province_shipping_fee', 'province_free_ship_threshold'];
  const before = await settings.all();
  try {
    const p = await db('products').where({ is_active: true }).where('stock', '>', 3).where('price', '<', 1500000).orderBy('price').first();
    const c = { lines: [], coupon: null };
    cart.addProduct(c, p.id, 1);

    await settings.save({ shipping_fee: '50000', free_ship_threshold: '1500000', province_shipping_fee: '', province_free_ship_threshold: '' });
    let hn = await cart.priceCart(c, { province: 'Hà Nội' });
    let tinh = await cart.priceCart(c, { province: 'Đà Nẵng' });
    ok(hn.shippingFee === 50000 && tinh.shippingFee === 50000 && !hn.shipDiffers, 'Để trống phí tỉnh → giống Hà Nội (như cũ)');

    await settings.save({ province_shipping_fee: '90000', province_free_ship_threshold: '3000000' });
    hn = await cart.priceCart(c, { province: 'Hà Nội' });
    tinh = await cart.priceCart(c, { province: 'Đà Nẵng' });
    const none = await cart.priceCart(c);
    ok(hn.shippingFee === 50000 && tinh.shippingFee === 90000 && none.shippingFee === 50000, 'Phí tỉnh riêng: Hà Nội 50k, tỉnh 90k, chưa chọn tỉnh = Hà Nội');
    ok(tinh.total === tinh.subtotal + 90000 && tinh.areas.hn.shippingFee === 50000 && tinh.areas.tinh.total === tinh.total, 'Tổng tiền + số liệu hai vùng cho trang thanh toán');
    ok(/Hà Nội: 50\.000₫\/đơn, miễn phí cho đơn từ 1\.500\.000₫\. Tỉnh khác: 90\.000₫\/đơn, miễn phí cho đơn từ 3\.000\.000₫/.test(hn.shipText), 'Câu phí giao tách Hà Nội / tỉnh khác');

    const c2 = { lines: [], coupon: null };
    cart.addProduct(c2, p.id, Math.ceil(1500000 / p.price));
    const hn2 = await cart.priceCart(c2, { province: 'Hà Nội' });
    const tinh2 = await cart.priceCart(c2, { province: 'Cần Thơ' });
    ok(hn2.shippingFee === 0 && (tinh2.subtotal >= 3000000 ? tinh2.shippingFee === 0 : tinh2.shippingFee === 90000), 'Ngưỡng miễn phí riêng từng vùng');

    await settings.save({ province_free_ship_threshold: '0' });
    const big = await cart.priceCart(c2, { province: 'Huế' });
    ok(big.shippingFee === 90000, 'Ngưỡng tỉnh = 0 → không miễn phí');
  } catch (err) {
    console.error(err);
    fails++;
  } finally {
    await settings.save(Object.fromEntries(keys.map((k) => [k, before[k]])));
    await db.destroy();
  }
  console.log(fails ? `\n${fails} kiểm thử lỗi` : '\nTất cả kiểm thử đều đạt');
  process.exit(fails ? 1 : 0);
})();
