const session = require('express-session');

/** Session store tối giản dùng Knex — chạy trên MySQL lẫn SQLite. */
class KnexStore extends session.Store {
  constructor(db, { table = 'sessions', ttlMs = 14 * 86400000 } = {}) {
    super();
    this.db = db;
    this.table = table;
    this.ttlMs = ttlMs;
    this.timer = setInterval(() => this.prune().catch(() => {}), 15 * 60000);
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
        cb(null, JSON.parse(row.sess));
      })
      .catch(cb);
  }

  async set(sid, sess, cb) {
    try {
      const data = { sess: JSON.stringify(sess), expired: this.expiry(sess) };
      const n = await this.db(this.table).where({ sid }).update(data);
      if (!n) await this.db(this.table).insert({ sid, ...data });
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    this.db(this.table)
      .where({ sid })
      .update({ expired: this.expiry(sess) })
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }

  destroy(sid, cb) {
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
