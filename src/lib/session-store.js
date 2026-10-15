const session = require('express-session');

/** Session store tối giản dùng Knex — chạy trên MySQL lẫn SQLite. */
class KnexStore extends session.Store {
  constructor(db, { table = 'sessions', ttlMs = 14 * 86400000 } = {}) {
    super();
    this.db = db;
    this.table = table;
    this.ttlMs = ttlMs;
    this.timer = setInterval(() => this.prune().catch(() => {}), 15 * 60000);
    // Hạn phiên đã lưu (sid → ms): phiên 14 ngày nên gia hạn ≤ 1 lần/ngày là đủ, khỏi ghi database mỗi lượt xem trang
    this.lastExp = new Map();
    this.timer.unref();
  }

  expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    this.db(this.table)
      .where({ sid })
      .first()
      .then((row) => {
        if (!row || Number(row.expired) < Date.now()) return cb(null, null);
        this.remember(sid, Number(row.expired));
        cb(null, JSON.parse(row.sess));
      })
      .catch(cb);
  }

  async set(sid, sess, cb) {
    try {
      const data = { sess: JSON.stringify(sess), expired: this.expiry(sess) };
      const n = await this.db(this.table).where({ sid }).update(data);
      if (!n) await this.db(this.table).insert({ sid, ...data });
      this.remember(sid, data.expired);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  remember(sid, exp) {
    this.lastExp.set(sid, exp);
    if (this.lastExp.size > 20000) this.lastExp.delete(this.lastExp.keys().next().value); // giới hạn bộ nhớ
  }

  touch(sid, sess, cb) {
    const exp = this.expiry(sess);
    const last = this.lastExp.get(sid);
    if (last && exp - last < 86400000) return cb && cb(null); // mới gia hạn trong 24 giờ qua → bỏ qua
    this.db(this.table)
      .where({ sid })
      .update({ expired: exp })
      .then(() => { this.remember(sid, exp); cb && cb(null); })
      .catch((e) => cb && cb(e));
  }

  destroy(sid, cb) {
    this.lastExp.delete(sid);
    this.db(this.table)
      .where({ sid })
      .del()
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }

  prune() {
    return this.db(this.table).where('expired', '<', Date.now()).del();
  }
}

module.exports = KnexStore;
