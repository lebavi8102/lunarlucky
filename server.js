const config = require('./src/config');
const db = require('./src/db');
const app = require('./src/app');

async function start() {
  const c = config.db.connection;
  console.log(
    config.db.client === 'mysql2'
      ? `[db] mysql ${c.host}:${c.port}/${c.database} ssl=${c.ssl ? 'on' : 'off'}${process.env.DATABASE_URL ? ' (DATABASE_URL)' : ''}`
      : `[db] sqlite ${c.filename}`,
  );
  // Tự chạy migration khi khởi động để deploy trên Hostinger không cần SSH
  const [, pending] = await db.migrate.latest();
  if (pending && pending.length) console.log('[db] đã chạy migration:', pending.join(', '));
  // Lần chạy đầu trên Hostinger: tạo admin từ ADMIN_EMAIL/ADMIN_PASSWORD,
  // và nạp dữ liệu mẫu nếu SEED_DEMO=true (chỉ khi chưa có sản phẩm nào)
  await require('./scripts/seed')({ demo: process.env.SEED_DEMO === 'true' });

  const server = app.listen(config.port, () => {
    console.log(`Lunar đang chạy tại ${config.siteUrl} (port ${config.port}, ${config.env})`);
  });

  const shutdown = () => {
    server.close(() => db.destroy().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Không khởi động được server:', err);
  process.exit(1);
});
