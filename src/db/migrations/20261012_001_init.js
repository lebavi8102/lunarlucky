/**
 * Lược đồ ban đầu cho Lunar.
 * Chạy được trên cả MySQL (Hostinger) lẫn SQLite (máy local).
 */
exports.up = async function up(knex) {
  const isMysql = knex.client.config.client === 'mysql2';
  const ts = (t) => {
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  };
  const engine = (t) => {
    if (isMysql) {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_unicode_ci');
    }
  };

  await knex.schema.createTable('media', (t) => {
    engine(t);
    t.increments('id');
    t.string('filename', 255);
    t.string('mime', 64).notNullable();
    t.integer('size').unsigned().notNullable().defaultTo(0);
    t.string('alt', 255);
    if (isMysql) t.specificType('data', 'LONGBLOB').notNullable();
    else t.binary('data').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users', (t) => {
    engine(t);
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable().unique();
    t.string('phone', 30);
    t.string('address', 255);
    t.string('password_hash', 120).notNullable();
    t.string('role', 20).notNullable().defaultTo('customer');
    t.string('reset_token', 120).index();
    t.bigInteger('reset_expires');
    ts(t);
  });

  await knex.schema.createTable('categories', (t) => {
    engine(t);
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('slug', 140).notNullable().unique();
    t.string('tagline', 255);
    t.text('description');
    t.integer('image_id').unsigned().references('media.id').onDelete('SET NULL');
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t);
  });

  await knex.schema.createTable('products', (t) => {
    engine(t);
    t.increments('id');
    t.integer('category_id').unsigned().references('categories.id').onDelete('SET NULL');
    t.string('name', 160).notNullable();
    t.string('slug', 180).notNullable().unique();
    t.string('short_desc', 300);
    t.text('description');
    t.text('contents'); // mỗi dòng một thành phần trong giỏ
    t.integer('price').unsigned().notNullable();
    t.integer('compare_price').unsigned();
    t.integer('stock').notNullable().defaultTo(0);
    t.string('badge', 40);
    t.integer('image_id').unsigned().references('media.id').onDelete('SET NULL');
    t.text('gallery'); // JSON: [media_id, ...]
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.integer('sold').notNullable().defaultTo(0);
    t.string('seo_title', 180);
    t.string('seo_desc', 300);
    ts(t);
    t.index(['is_active', 'category_id']);
  });

  await knex.schema.createTable('coupons', (t) => {
    engine(t);
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('description', 200);
    t.string('type', 10).notNullable().defaultTo('percent'); // percent | fixed
    t.integer('value').unsigned().notNullable();
    t.integer('min_order').unsigned().notNullable().defaultTo(0);
    t.integer('max_discount').unsigned();
    t.integer('max_uses').unsigned();
    t.integer('used_count').unsigned().notNullable().defaultTo(0);
    t.string('starts_at', 10); // YYYY-MM-DD
    t.string('ends_at', 10);
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t);
  });

  await knex.schema.createTable('orders', (t) => {
    engine(t);
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('customer_name', 120).notNullable();
    t.string('phone', 30).notNullable();
    t.string('email', 190);
    t.string('address', 255).notNullable();
    t.string('province', 80);
    t.boolean('is_gift').notNullable().defaultTo(false);
    t.string('recipient_name', 120);
    t.string('recipient_phone', 30);
    t.string('recipient_address', 255);
    t.string('delivery_date', 10);
    t.string('card_message', 500);
    t.string('note', 500);
    t.string('invoice_info', 500);
    t.string('payment_method', 10).notNullable(); // cod | bank
    t.string('payment_status', 20).notNullable().defaultTo('pending');
    t.string('status', 20).notNullable().defaultTo('new');
    t.integer('subtotal').unsigned().notNullable();
    t.integer('discount').unsigned().notNullable().defaultTo(0);
    t.integer('shipping_fee').unsigned().notNullable().defaultTo(0);
    t.integer('total').unsigned().notNullable();
    t.string('coupon_code', 40);
    t.string('admin_note', 500);
    ts(t);
    t.index(['status']);
    t.index(['phone']);
  });

  await knex.schema.createTable('order_items', (t) => {
    engine(t);
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.string('name', 200).notNullable();
    t.integer('price').unsigned().notNullable();
    t.integer('qty').unsigned().notNullable();
    t.integer('line_total').unsigned().notNullable();
  });

  await knex.schema.createTable('quotes', (t) => {
    engine(t);
    t.increments('id');
    t.string('company', 200).notNullable();
    t.string('contact_name', 120).notNullable();
    t.string('phone', 30).notNullable();
    t.string('email', 190);
    t.integer('quantity').unsigned();
    t.string('budget', 60);
    t.string('delivery_date', 10);
    t.boolean('logo_print').notNullable().defaultTo(false);
    t.text('message');
    t.string('status', 20).notNullable().defaultTo('new');
    t.string('admin_note', 500);
    ts(t);
  });

  await knex.schema.createTable('posts', (t) => {
    engine(t);
    t.increments('id');
    t.string('title', 200).notNullable();
    t.string('slug', 220).notNullable().unique();
    t.string('excerpt', 400);
    t.text('content');
    t.integer('cover_id').unsigned().references('media.id').onDelete('SET NULL');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.timestamp('published_at');
    t.string('seo_title', 180);
    t.string('seo_desc', 300);
    ts(t);
  });

  await knex.schema.createTable('settings', (t) => {
    engine(t);
    t.string('key', 60).primary();
    t.text('value');
  });

  await knex.schema.createTable('sessions', (t) => {
    engine(t);
    t.string('sid', 128).primary();
    t.text('sess').notNullable();
    t.bigInteger('expired').notNullable().index();
  });
};

exports.down = async function down(knex) {
  for (const t of [
    'sessions', 'settings', 'posts', 'quotes', 'order_items', 'orders', 'coupons',
    'products', 'categories', 'users', 'media',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
};
