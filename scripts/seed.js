/**
 * Dữ liệu mẫu cho Lunar: danh mục, sản phẩm, món quà tự tạo, mã giảm giá, bài viết.
 * Chạy: npm run seed            (bỏ qua nếu đã có sản phẩm)
 *       npm run seed -- --reset (xóa dữ liệu mẫu cũ và tạo lại)
 */
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const config = require('../src/config');
const { saveBuffer } = require('../src/lib/media');
const art = require('./art');

const svg = (s, name) => saveBuffer(Buffer.from(s), 'image/svg+xml', name, null);

const CATEGORIES = [
  { name: 'Biếu sếp & đối tác', slug: 'bieu-sep-doi-tac', tagline: 'Sang trọng, chỉn chu cho người quan trọng', palette: 'lacquer', composition: 'box',
    description: 'Những giỏ quà sơn mài cao cấp với rượu vang nhập khẩu, trà cổ thụ và đặc sản tuyển chọn, dành cho cấp trên, đối tác và khách hàng thân thiết.' },
  { name: 'Quà gia đình', slug: 'qua-gia-dinh', tagline: 'Ấm áp, đủ đầy cho ngày sum vầy', palette: 'cream', composition: 'basket',
    description: 'Giỏ quà đủ đầy bánh mứt, trà, hạt và trái cây sấy để biếu ông bà, cha mẹ, họ hàng dịp Tết đoàn viên.' },
  { name: 'Quà doanh nghiệp', slug: 'qua-doanh-nghiep', tagline: 'Số lượng lớn, in logo thương hiệu', palette: 'jade', composition: 'stack',
    description: 'Mẫu giỏ quà tối ưu cho doanh nghiệp tặng nhân viên, đối tác với số lượng lớn, hỗ trợ in logo và xuất hóa đơn VAT.' },
  { name: 'Hộp quà nhỏ xinh', slug: 'hop-qua-nho-xinh', tagline: 'Gửi bạn bè, đồng nghiệp, dưới 1 triệu', palette: 'blush', composition: 'round',
    description: 'Hộp quà gọn gàng, tinh tế để gửi bạn bè, đồng nghiệp, thầy cô với ngân sách vừa phải.' },
];

const PRODUCTS = [
  ['bieu-sep-doi-tac', 'Giỏ Phú Quý', 4890000, 5400000, 'Cao cấp', 'lacquer', 'box', true,
    'Hộp sơn mài đỏ son khảm vàng, rượu vang Pháp và trà Shan tuyết cổ thụ cho lời chúc thịnh vượng.',
    ['Hộp sơn mài Phú Quý thủ công', 'Rượu vang đỏ Bordeaux 750ml', 'Trà Shan tuyết cổ thụ Hà Giang 100g', 'Hạt macca Đắk Lắk sấy nứt vỏ 500g', 'Yến sào Khánh Hòa hộp 50g', 'Mật ong hoa nhãn Hưng Yên 350ml', 'Thiệp chúc viết tay']],
  ['bieu-sep-doi-tac', 'Giỏ Thịnh Vượng', 3290000, null, 'Bán chạy', 'ink', 'box', true,
    'Giỏ quà trang trọng với vang Chile, trà ô long và hạt dinh dưỡng, đóng trong hộp sơn mài đen viền vàng.',
    ['Hộp sơn mài đen viền vàng', 'Rượu vang đỏ Chile 750ml', 'Trà Ô long Bảo Lộc 200g', 'Hạt điều rang muối Bình Phước 300g', 'Mứt hạt sen trần 250g', 'Thiệp chúc viết tay']],
  ['bieu-sep-doi-tac', 'Giỏ Kim Ngân', 6900000, null, 'Giới hạn', 'lacquer', 'round', true,
    'Phiên bản giới hạn 100 hộp, hộp tròn sơn mài thếp vàng, tuyển chọn những đặc sản quý nhất ba miền.',
    ['Hộp tròn sơn mài thếp vàng (phiên bản giới hạn)', 'Rượu vang Ý Amarone 750ml', 'Trà Shan tuyết cổ thụ 200g', 'Yến sào tinh chế 100g', 'Hạt macca, óc chó, hạnh nhân 600g', 'Socola Marou 2 thanh', 'Thiệp thư pháp viết tay']],
  ['qua-gia-dinh', 'Giỏ An Khang', 1890000, 2100000, 'Bán chạy', 'cream', 'basket', true,
    'Giỏ mây đan tay đầy ắp bánh mứt, trà và hạt cho ngày Tết sum vầy bên ông bà, cha mẹ.',
    ['Giỏ mây đan tay', 'Rượu vang đỏ Đà Lạt 750ml', 'Trà sen Tây Hồ 100g', 'Hạt điều rang muối 300g', 'Mứt gừng dẻo 200g', 'Bánh pía Sóc Trăng 4 cái', 'Thiệp chúc viết tay']],
  ['qua-gia-dinh', 'Giỏ Đoàn Viên', 2490000, null, 'Mới', 'sand', 'basket', true,
    'Giỏ quà gia đình với trái cây sấy, trà và bánh truyền thống, gửi trọn ấm áp mùa đoàn viên.',
    ['Giỏ mây quai xách', 'Rượu vang trắng Đà Lạt 750ml', 'Trà Thái Nguyên 200g', 'Trái cây sấy dẻo 400g', 'Bánh in Huế', 'Hạt dưa đỏ 200g', 'Mật ong hoa cà phê 350ml']],
  ['qua-gia-dinh', 'Giỏ Phúc Lộc', 1490000, null, null, 'cream', 'stack', false,
    'Ba hộp quà xếp tầng: trà, hạt và mứt truyền thống, gọn gàng, dễ mang đi biếu.',
    ['Bộ ba hộp xếp tầng', 'Trà Ô long 100g', 'Hạt điều, hạt bí 400g', 'Mứt dừa non 200g', 'Thiệp chúc viết tay']],
  ['qua-doanh-nghiep', 'Giỏ Cát Tường', 990000, null, 'Bán chạy', 'jade', 'stack', true,
    'Mẫu giỏ được doanh nghiệp chọn nhiều nhất cho nhân viên: đủ đầy, chỉn chu, ngân sách tối ưu.',
    ['Hộp giấy mỹ thuật in logo (đơn từ 20 giỏ)', 'Trà xanh Thái Nguyên 100g', 'Hạt điều rang muối 200g', 'Mứt gừng 150g', 'Bánh quy bơ 300g', 'Thiệp chúc in logo']],
  ['qua-doanh-nghiep', 'Giỏ Như Ý', 1690000, null, null, 'jade', 'box', true,
    'Giỏ quà tri ân đối tác với vang đỏ và đặc sản, hỗ trợ in logo lên nơ và thiệp.',
    ['Hộp cứng phủ vải in logo', 'Rượu vang đỏ Chile 750ml', 'Trà Ô long 100g', 'Hạt macca 300g', 'Mứt hạt sen 200g', 'Thiệp chúc in logo']],
  ['qua-doanh-nghiep', 'Giỏ Hỷ Lạc', 1290000, null, null, 'sand', 'round', false,
    'Hộp tròn trang nhã với trà, cà phê đặc sản và bánh, phù hợp tặng khách hàng số lượng lớn.',
    ['Hộp tròn giấy mỹ thuật', 'Cà phê Arabica Cầu Đất 250g', 'Trà sen 100g', 'Bánh quy bơ 250g', 'Hạt điều 200g']],
  ['hop-qua-nho-xinh', 'Hộp Xuân Thì', 690000, 790000, 'Mới', 'blush', 'round', true,
    'Hộp quà nhỏ xinh với trà hoa và bánh mứt, món quà dễ thương gửi bạn bè, đồng nghiệp.',
    ['Hộp tròn hoa đào', 'Trà hoa cúc 50g', 'Mứt dâu Đà Lạt 150g', 'Bánh quy bơ 150g', 'Thiệp chúc viết tay']],
  ['hop-qua-nho-xinh', 'Hộp Tân Xuân', 590000, null, null, 'cream', 'round', false,
    'Hộp quà gọn gàng với cà phê đặc sản và hạt, phù hợp tặng thầy cô, đồng nghiệp.',
    ['Hộp tròn đỏ son', 'Cà phê Arabica Cầu Đất 200g', 'Hạt điều 150g', 'Thiệp chúc viết tay']],
  ['hop-qua-nho-xinh', 'Hộp Trăng Rằm', 890000, null, null, 'ink', 'stack', false,
    'Hai hộp xếp tầng với trà ô long và socola đặc sản, thanh lịch cho người trẻ.',
    ['Hộp đôi xếp tầng', 'Trà Ô long 100g', 'Socola Marou 2 thanh', 'Hạt macca 150g', 'Thiệp chúc viết tay']],
];

const BOXES = [
  ['Giỏ mây Đồng Quê', 'Giỏ mây đan tay, quai xách, mộc mạc và ấm áp.', 180000, 6, 'rattan', 'sand'],
  ['Hộp sơn mài Nguyệt', 'Hộp sơn mài đỏ son, nơ lụa vàng, sang trọng.', 350000, 8, 'lacquer', 'cream'],
  ['Hộp gỗ Khắc Mai', 'Hộp gỗ thông khắc hoa mai, giữ lại làm hộp trang trí.', 520000, 10, 'wood', 'jade'],
];

const ITEMS = [
  ['Trà & Cà phê', 'Trà Shan tuyết cổ thụ 100g', 320000, 'tea', '#2f5d50'],
  ['Trà & Cà phê', 'Trà sen Tây Hồ 100g', 280000, 'tea', '#7a1622'],
  ['Trà & Cà phê', 'Trà Ô long Bảo Lộc 100g', 160000, 'tea', '#85642b'],
  ['Trà & Cà phê', 'Cà phê Arabica Cầu Đất 250g', 190000, 'bag', '#3b2412'],
  ['Rượu vang', 'Vang đỏ Đà Lạt 750ml', 260000, 'wine', '#4a0c14'],
  ['Rượu vang', 'Vang đỏ Chile 750ml', 420000, 'wine', '#24382f'],
  ['Rượu vang', 'Vang Bordeaux Pháp 750ml', 890000, 'wine', '#2a070c'],
  ['Bánh mứt', 'Mứt gừng dẻo 200g', 85000, 'tray', '#7a1622'],
  ['Bánh mứt', 'Khay mứt Tết 6 ngăn', 220000, 'tray', '#a9823e'],
  ['Bánh mứt', 'Bánh quy bơ hộp thiếc 300g', 150000, 'tin', '#2f5d50'],
  ['Hạt dinh dưỡng', 'Hạt điều rang muối 300g', 175000, 'jar', '#7a1622'],
  ['Hạt dinh dưỡng', 'Hạt macca nứt vỏ 300g', 210000, 'jar', '#2f5d50'],
  ['Đặc sản', 'Mật ong hoa nhãn 350ml', 165000, 'jar', '#a9823e'],
  ['Đặc sản', 'Yến sào Khánh Hòa 50g', 1200000, 'tin', '#7a1622'],
];

const POSTS = [
  {
    title: 'Ý nghĩa của giỏ quà Tết trong văn hóa Việt',
    excerpt: 'Từ cặp bánh chưng ngày xưa đến giỏ quà sơn mài hôm nay, quà Tết luôn là cách người Việt gửi lời tri ân và chúc phúc.',
    palette: 'lacquer', composition: 'box',
    content: `Ngày Tết, người Việt có câu "Tết thầy, Tết cha, Tết mẹ". Món quà mang theo lòng biết ơn, sự kính trọng và mong ước một năm mới đủ đầy cho người nhận.

## Từ cặp bánh chưng đến giỏ quà

Xưa kia, quà Tết thường là cặp bánh chưng, cân đường, gói chè hay chai rượu. Giá trị của món quà nằm ở tấm lòng người trao. Ngày nay, giỏ quà Tết gom nhiều món nhỏ vào một hình thức trang trọng hơn, nhưng tinh thần ấy vẫn giữ nguyên.

## Mỗi món một lời chúc

- **Trà** tượng trưng cho sự thanh tao, an nhiên.
- **Rượu vang đỏ** mang sắc đỏ may mắn, chúc sung túc.
- **Mứt và bánh** là vị ngọt cho một năm êm ấm.
- **Hạt điều, hạt dưa** gợi ý nghĩa sinh sôi, nảy lộc.

> Một giỏ quà đẹp là khi người nhận cảm thấy mình được nhớ đến.

## Trao quà đúng lúc

Theo phong tục, quà Tết thường được trao trong khoảng từ 23 tháng Chạp (ngày ông Công ông Táo) đến trước giao thừa. Đây là lúc để tri ân những người đã đồng hành cùng ta trong năm cũ.`,
  },
  {
    title: 'Cách chọn quà Tết biếu sếp tinh tế, không phô trương',
    excerpt: 'Món quà biếu cấp trên cần chỉn chu nhưng không nên quá phô trương. Đây là vài gợi ý để bạn chọn đúng.',
    palette: 'ink', composition: 'round',
    content: `Biếu quà Tết cho cấp trên là dịp bày tỏ lòng cảm ơn sau một năm làm việc. Điều quan trọng là món quà phải **tinh tế, phù hợp** và thể hiện sự chân thành.

## 1. Chọn theo sở thích người nhận

Nếu sếp thích trà, một hộp trà Shan tuyết cổ thụ sẽ ghi điểm hơn một chai rượu đắt tiền. Hãy quan sát những gì người nhận thường dùng.

## 2. Ưu tiên chất lượng hơn số lượng

Một giỏ quà ít món nhưng tuyển chọn kỹ luôn sang trọng hơn giỏ quà nhiều món đại trà.

## 3. Chú ý hình thức

Hộp sơn mài, giỏ mây hay hộp gỗ có thể giữ lại dùng sau Tết, giúp món quà được nhớ lâu hơn.

## 4. Đừng quên tấm thiệp

Một lời chúc viết tay ngắn gọn, chân thành sẽ làm món quà trở nên riêng tư và ý nghĩa.

## Gợi ý từ Lunar

Các giỏ trong bộ sưu tập **Biếu sếp & đối tác** được thiết kế đúng tinh thần này: sang trọng vừa đủ, mỗi món đều có câu chuyện riêng.`,
  },
  {
    title: 'Quà Tết doanh nghiệp: 5 lưu ý để món quà nói thay lời cảm ơn',
    excerpt: 'Quà Tết doanh nghiệp là cơ hội gắn kết nhân viên và đối tác. Lên kế hoạch sớm để món quà chỉn chu và đúng hẹn.',
    palette: 'jade', composition: 'stack',
    content: `Với doanh nghiệp, quà Tết không chỉ là món quà mà còn là một điểm chạm thương hiệu. Dưới đây là 5 lưu ý giúp chương trình quà Tết của bạn trọn vẹn.

## 1. Lên kế hoạch sớm

Đặt hàng trước Tết ít nhất 3–4 tuần giúp bạn có đủ thời gian duyệt mẫu, in logo và chủ động lịch giao.

## 2. Phân nhóm người nhận

Nhân viên, đối tác chiến lược và khách hàng thân thiết có thể nhận những mẫu giỏ khác nhau, phù hợp ngân sách từng nhóm.

## 3. In logo tinh tế

Logo nhỏ trên nơ lụa hoặc thiệp chúc thường thanh lịch hơn in lớn trên hộp.

## 4. Chuẩn bị chứng từ

Hãy chọn nhà cung cấp xuất được hóa đơn VAT và biên bản giao nhận để thuận tiện cho kế toán.

## 5. Giao tận tay, đúng hẹn

Giao hàng theo danh sách đến từng địa chỉ giúp đối tác cảm nhận được sự chu đáo.

Lunar hỗ trợ trọn gói từ tư vấn, in logo đến giao hàng loạt. [Gửi yêu cầu báo giá](/qua-tang-doanh-nghiep#bao-gia) để nhận phương án trong 24 giờ.`,
  },
];

async function seed({ reset = false, demo = true } = {}) {
  await db.migrate.latest();
  const has = await db('products').first();
  if (!demo) {
    // chỉ đảm bảo có tài khoản quản trị
  } else if (has && !reset) {
    console.log('Đã có dữ liệu sản phẩm, bỏ qua dữ liệu mẫu.');
  } else {
    if (reset) {
      for (const t of ['order_items', 'orders', 'products', 'categories', 'builder_items', 'builder_boxes', 'coupons', 'posts', 'media']) {
        await db(t).del();
      }
    }

    const catIds = {};
    for (const [i, c] of CATEGORIES.entries()) {
      const image_id = await svg(art.categoryArt({ palette: c.palette, composition: c.composition, peach: i === 3, id: `c${i}` }), `${c.slug}.svg`);
      const [id] = await db('categories').insert({ name: c.name, slug: c.slug, tagline: c.tagline, description: c.description, image_id, sort: i });
      catIds[c.slug] = typeof id === 'object' ? id.id : id;
    }

    const slugify = require('../src/lib/format').slugify;
    for (const [i, [cat, name, price, compare, badge, palette, composition, featured, short, contents]] of PRODUCTS.entries()) {
      const image_id = await svg(art.productArt({ palette, composition, peach: cat === 'hop-qua-nho-xinh', id: `p${i}` }), `${slugify(name)}.svg`);
      const alt = await svg(art.productArt({ palette: palette === 'cream' ? 'lacquer' : 'cream', composition: composition === 'box' ? 'stack' : 'box', id: `pa${i}` }), `${slugify(name)}-2.svg`);
      await db('products').insert({
        category_id: catIds[cat], name, slug: slugify(name), short_desc: short, price, compare_price: compare,
        stock: i === 2 ? 4 : 40 + i * 7, badge, image_id, gallery: JSON.stringify([alt]), is_featured: featured,
        contents: contents.join('\n'), sold: [86, 142, 12, 210, 64, 38, 175, 51, 33, 97, 44, 29][i], sort: i,
        description: `**${name}** là lời chúc được Lunar chuẩn bị tỉ mỉ cho mùa Tết.\n\n${short}\n\nMỗi giỏ quà được xếp tay, lót giấy lụa, thắt nơ và kèm thiệp chúc viết tay theo lời nhắn của bạn. Các sản phẩm đều có nguồn gốc rõ ràng, hạn sử dụng tối thiểu 3 tháng kể từ ngày giao.\n\n*Lưu ý: một số món có thể được thay bằng sản phẩm tương đương về giá trị tùy thời điểm.*`,
      });
    }

    for (const [i, [name, description, price, capacity, kind, palette]] of BOXES.entries()) {
      const image_id = await svg(art.boxArt({ kind, palette, id: `b${i}` }), `box-${i}.svg`);
      await db('builder_boxes').insert({ name, description, price, capacity, image_id, sort: i });
    }
    for (const [i, [group_name, name, price, kind, color]] of ITEMS.entries()) {
      const image_id = await svg(art.itemArt({ kind, color, id: `i${i}` }), `item-${i}.svg`);
      await db('builder_items').insert({ group_name, name, price, image_id, sort: i });
    }

    await db('coupons').insert([
      { code: 'TET2027', description: 'Giảm 10% mùa Tết, tối đa 300.000₫', type: 'percent', value: 10, min_order: 1000000, max_discount: 300000 },
      { code: 'LUNARVIP', description: 'Giảm 100.000₫ cho đơn từ 1.500.000₫', type: 'fixed', value: 100000, min_order: 1500000 },
    ]);

    for (const [i, p] of POSTS.entries()) {
      const cover_id = await svg(art.coverArt({ palette: p.palette, composition: p.composition, id: `cv${i}` }), `cover-${i}.svg`);
      await db('posts').insert({
        title: p.title, slug: slugify(p.title), excerpt: p.excerpt, content: p.content, cover_id,
        is_published: true, published_at: new Date(Date.now() - (i + 1) * 3 * 86400000),
      });
    }
    console.log(`Đã tạo ${CATEGORIES.length} danh mục, ${PRODUCTS.length} sản phẩm, ${BOXES.length} hộp, ${ITEMS.length} món, ${POSTS.length} bài viết.`);
  }

  if (config.admin.email && config.admin.password) {
    const email = config.admin.email.toLowerCase();
    const exists = await db('users').where({ email }).first();
    if (!exists) {
      await db('users').insert({ name: 'Quản trị Lunar', email, password_hash: await bcrypt.hash(config.admin.password, 11), role: 'admin' });
      console.log(`Đã tạo tài khoản quản trị: ${email}`);
    }
  } else {
    console.log('Chưa đặt ADMIN_EMAIL/ADMIN_PASSWORD trong .env — dùng "npm run create-admin" để tạo tài khoản quản trị.');
  }
}

module.exports = seed;

if (require.main === module) {
  seed({ reset: process.argv.includes('--reset') })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
