const express = require('express');
const db = require('../db');
const cart = require('../lib/cart');
const { flash } = require('../middleware/locals');

const router = express.Router();

async function loadBuilder() {
  const [boxes, items] = await Promise.all([
    db('builder_boxes').where({ is_active: true }).orderBy([{ column: 'sort' }, { column: 'price' }]),
    db('builder_items').where({ is_active: true }).orderBy([{ column: 'group_name' }, { column: 'sort' }, { column: 'id' }]),
  ]);
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => x.name === it.group_name);
    if (!g) groups.push((g = { name: it.group_name, items: [] }));
    g.items.push(it);
  }
  return { boxes, groups };
}

router.get('/tu-tao-gio-qua', async (req, res) => {
  const data = await loadBuilder();
  res.locals.seo.title = 'Tự tạo giỏ quà Tết theo ý bạn · Lunar';
  res.locals.seo.description =
    'Chọn hộp quà, tự tay phối trà, rượu vang, bánh mứt, hạt dinh dưỡng và đặc sản ba miền thành giỏ quà Tết mang dấu ấn riêng.';
  res.render('shop/builder', { ...data, error: null, minItems: cart.MIN_CUSTOM_ITEMS, selected: null });
});

router.post('/tu-tao-gio-qua', async (req, res) => {
  const items = Object.entries(req.body)
    .filter(([k, v]) => /^item_\d+$/.test(k) && Number(v) > 0)
    .map(([k, v]) => ({ id: Number(k.slice(5)), qty: Number(v) }));
  const input = { boxId: req.body.box_id, items };
  const r = await cart.resolveCustom(input);
  if (r.error) {
    const data = await loadBuilder();
    res.status(422);
    res.locals.seo.title = 'Tự tạo giỏ quà · Lunar';
    return res.render('shop/builder', {
      ...data, error: r.error, minItems: cart.MIN_CUSTOM_ITEMS,
      selected: { boxId: Number(req.body.box_id), items: Object.fromEntries(items.map((i) => [i.id, i.qty])) },
    });
  }
  cart.addCustom(cart.getCart(req), { ...input, qty: req.body.qty || 1 });
  flash(req, 'success', `Đã thêm giỏ quà tự tạo (${r.count} món) vào giỏ hàng.`);
  res.redirect('/gio-hang');
});

module.exports = router;
