const db = require('../src/db');

db.migrate
  .latest()
  .then(([batch, log]) => console.log(log.length ? `Batch ${batch}: ${log.join(', ')}` : 'Cơ sở dữ liệu đã ở phiên bản mới nhất.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
