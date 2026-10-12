# Lunar Lucky — Website giỏ quà Tết cao cấp

Website thương mại điện tử cho cửa hàng giỏ quà Tết **Lunar Lucky**: bán online, nhận khách lẻ và khách doanh nghiệp.

**Công nghệ:** Node.js (≥ 18.18) · Express 5 · EJS (render phía server, tốt cho SEO) · Knex · MySQL (production) / SQLite (máy local).

---

## Tính năng

**Khách hàng**
- Trang chủ, bộ sưu tập theo danh mục, lọc giá, sắp xếp, tìm kiếm
- Trang sản phẩm: thư viện ảnh, thành phần giỏ quà, giá gốc/giá giảm
- Giỏ hàng, mã giảm giá, thanh tiến độ miễn phí giao hàng
- Thanh toán: **COD** hoặc **chuyển khoản VietQR** (mã QR tự điền số tiền và nội dung là mã đơn)
- Gửi tặng người khác, chọn ngày giao, lời chúc viết tay trên thiệp, thông tin xuất hóa đơn VAT
- Tra cứu đơn bằng mã đơn và số điện thoại
- Tài khoản khách: đăng ký, đăng nhập, lịch sử đơn, quên mật khẩu qua email
- Trang **Quà tặng doanh nghiệp** có form yêu cầu báo giá
- Blog cẩm nang, FAQ, các trang chính sách
- Nút liên hệ nhanh Zalo / Messenger / hotline

**Quản trị (`/admin`)**
- Tổng quan: doanh thu hôm nay và tháng này, biểu đồ 14 ngày, đơn mới, đơn chờ chuyển khoản, sắp hết hàng
- Đơn hàng: lọc, tìm, đổi trạng thái (tự gửi email cho khách), **in phiếu đóng gói và thiệp**; hủy đơn tự hoàn tồn kho
- Báo giá B2B, khách hàng
- Quản lý sản phẩm, danh mục, mã giảm giá, bài viết (Markdown)
- Cài đặt: hotline, link Zalo/fanpage, **tài khoản ngân hàng VietQR**, phí giao hàng, nội dung trang chủ

**Thông báo:** báo đơn mới và yêu cầu báo giá qua **Telegram**; gửi email xác nhận đơn cho khách.

**SEO:** title/description riêng từng trang, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD (Store, Product, BreadcrumbList, BlogPosting, FAQPage).

**Bảo mật:** CSRF token, Helmet + CSP, mật khẩu bcrypt, chống session fixation, giới hạn tần suất (đăng nhập, đặt hàng, báo giá), kiểm tra file ảnh bằng magic bytes, tính giá lại hoàn toàn ở server.

> Ảnh được lưu **trong database** nên không bị mất khi deploy lại trên Hostinger.

---

## Chạy trên máy local

```bash
npm install
npm run setup     # tạo database SQLite + dữ liệu mẫu + tài khoản admin
npm run dev
```

Mở http://localhost:3000, trang quản trị ở http://localhost:3000/admin.
Tài khoản admin local nằm trong file `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy và tự khởi động lại khi sửa code |
| `npm start` | Chạy production |
| `npm run seed -- --reset` | Xóa và tạo lại dữ liệu mẫu |
| `npm run create-admin -- email "matkhau"` | Tạo hoặc đặt lại mật khẩu admin |

---

## Đưa code lên GitHub

1. Tạo repository mới trên GitHub (nên để **Private**), không chọn thêm README.
2. Trong thư mục `lunar`:

```bash
git remote add origin https://github.com/<ten-ban>/lunar.git
git push -u origin main
```

File `.env` và database local đã nằm trong `.gitignore`, sẽ **không** bị đẩy lên.

---

## Deploy lên Hostinger (gói Business / Cloud có Node.js)

> Tên menu trong hPanel có thể khác đôi chút theo thời điểm.

### Bước 1: Tạo database MySQL
hPanel → **Websites → Databases → MySQL Databases** → tạo database và user. Ghi lại *tên database, user, mật khẩu*. Host thường là `localhost`.

### Bước 2: Tạo ứng dụng Node.js
hPanel → **Websites → Add Website → Node.js Apps** (hoặc *Node.js* trong trang quản lý website):
- **Nguồn:** *Import Git repository* → kết nối GitHub → chọn repo `lunar`, nhánh `main`
- **Node.js version:** 20 hoặc 22
- **Entry file / Start command:** `server.js` / `npm start`
- **Build command:** `npm install` (dự án không cần build)

### Bước 3: Biến môi trường
Trong phần **Environment variables** của app, nhập các biến theo `.env.example`:

| Biến | Giá trị |
|---|---|
| `NODE_ENV` | `production` |
| `SITE_URL` | `https://ten-mien-cua-ban.vn` |
| `SESSION_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự |
| `DB_CLIENT` | `mysql2` |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | từ Bước 1 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản quản trị đầu tiên |
| `SEED_DEMO` | `true` nếu muốn có sản phẩm mẫu ở lần chạy đầu, sau đó xóa biến này |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | xem bên dưới |
| `SMTP_*`, `MAIL_FROM` | email Hostinger (`smtp.hostinger.com`, cổng 465) |

Tạo `SESSION_SECRET` bằng lệnh:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Khi khởi động, server **tự tạo bảng** (migration) và **tự tạo tài khoản admin**, không cần SSH.

### Bước 4: Tên miền và HTTPS
Gắn tên miền cho app, bật SSL miễn phí trong hPanel → **Security → SSL**.

### Bước 5: Cập nhật về sau
Mỗi lần `git push` lên nhánh `main`, vào app trên Hostinger bấm **Redeploy** (hoặc bật auto-deploy nếu có).

---

## Thiết lập sau khi deploy

1. Đăng nhập `/admin` → **Cài đặt**: nhập hotline, link fanpage, Zalo, Messenger, **ngân hàng và số tài khoản** (mã QR thử hiện ngay bên dưới để kiểm tra).
2. **Sản phẩm / Danh mục**: thay ảnh minh họa bằng ảnh thật tải từ fanpage (JPG/PNG/WebP, ≤ 5MB, nên dùng ảnh dọc 4:5 rộng khoảng 1200px).
3. **Logo**: chép logo vào `public/img/logo.png` và làm theo hướng dẫn trong `views/partials/logo.ejs`.
4. Đổi mật khẩu admin: `/quen-mat-khau` (cần SMTP), hoặc chạy `npm run create-admin`.

### Bot Telegram báo đơn
1. Trên Telegram, nhắn [@BotFather](https://t.me/BotFather) → `/newbot` → nhận **token**.
2. Nhắn một tin bất kỳ cho bot vừa tạo (hoặc thêm bot vào nhóm của shop).
3. Lấy **chat id** qua [@userinfobot](https://t.me/userinfobot) (với nhóm, chat id bắt đầu bằng `-`).
4. Điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`, rồi Redeploy.

---

## Cấu trúc thư mục

```
server.js              Điểm khởi động (migration + seed admin + listen)
src/app.js             Cấu hình Express, bảo mật, session
src/routes/            shop, cart, checkout, account, b2b, blog, pages, seo, admin/
src/lib/               cart (tính giá), notify (email/Telegram), vietqr, validate, settings...
src/db/migrations/     Lược đồ database
views/                 Giao diện EJS (partials, shop, account, admin, emails...)
public/css, js, img    Giao diện tĩnh
scripts/               migrate, seed, create-admin, art (ảnh minh họa mẫu)
```

## Hệ thiết kế

- **Màu:** đỏ sơn mài `#7a1622`, vàng `#c9a15a`, nền giấy kem `#fdfaf5`; độ tương phản chữ ≥ 4.5:1
- **Chữ:** Cormorant Garamond (tiêu đề) và Be Vietnam Pro (nội dung), cả hai hỗ trợ tiếng Việt đầy đủ
- Khung ảnh vòm nguyệt môn, đường chỉ vàng, chuyển động nhẹ khi cuộn (tôn trọng *giảm chuyển động* của hệ điều hành)
- Responsive từ 360px, chạm tối thiểu 44px, điều hướng bằng bàn phím, có skip link
