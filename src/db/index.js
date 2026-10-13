const fs = require('fs');
const path = require('path');
const knex = require('knex');
const config = require('../config');

if (config.db.client !== 'mysql2') {
  fs.mkdirSync(path.dirname(path.resolve(config.db.connection.filename)), { recursive: true });
}

const db = knex({
  client: config.db.client,
  connection: config.db.connection,
  acquireConnectionTimeout: 15000,
  useNullAsDefault: config.db.client !== 'mysql2',
  pool:
    config.db.client === 'mysql2'
      ? // Trả kết nối rảnh sau 30s, trước khi MySQL tự đóng → không gặp lỗi "connection lost" khi ít khách
        { min: 0, max: 8, idleTimeoutMillis: 30000, acquireTimeoutMillis: 15000 }
      : { afterCreate: (conn, done) => { conn.pragma('foreign_keys = ON'); conn.pragma('journal_mode = WAL'); done(); } },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
});

db.isMysql = config.db.client === 'mysql2';

module.exports = db;
