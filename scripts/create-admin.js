/**
 * Tạo hoặc đặt lại mật khẩu tài khoản quản trị.
 * Cách dùng: npm run create-admin -- email@domain.com "MatKhauManh123"
 */
const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.log('Cách dùng: npm run create-admin -- email@domain.com "mat-khau-it-nhat-10-ky-tu"');
    process.exitCode = 1;
    return;
  }
  await db.migrate.latest();
  const e = email.toLowerCase();
  const hash = await bcrypt.hash(password, 11);
  const u = await db('users').where({ email: e }).first();
  if (u) {
    await db('users').where({ id: u.id }).update({ password_hash: hash, role: 'admin', updated_at: new Date() });
    console.log(`Đã cập nhật ${e} thành quản trị viên.`);
  } else {
    await db('users').insert({ name: 'Quản trị Lunar Lucky', email: e, password_hash: hash, role: 'admin' });
    console.log(`Đã tạo quản trị viên ${e}.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
