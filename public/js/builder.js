/* Tự tạo giỏ quà — cập nhật tổng tiền và sức chứa theo thời gian thực. */
(() => {
  const form = document.querySelector('[data-builder]');
  if (!form) return;
  const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + '₫';
  const min = Number(form.dataset.min) || 2;
  const $ = (s) => form.querySelector(s);
  const toastLink = document.querySelector('[data-toast] a');

  function state() {
    const box = form.querySelector('input[name=box_id]:checked');
    const items = [...form.querySelectorAll('[data-item]')].map((row) => ({
      row,
      name: row.dataset.name,
      price: Number(row.dataset.price),
      qty: Math.max(0, Number(row.querySelector('input').value) || 0),
    }));
    return { box, items: items.filter((i) => i.qty > 0), all: items };
  }

  function render() {
    const { box, items, all } = state();
    const cap = box ? Number(box.dataset.capacity) : 0;
    const count = items.reduce((a, i) => a + i.qty, 0);
    const itemsPrice = items.reduce((a, i) => a + i.qty * i.price, 0);
    const boxPrice = box ? Number(box.dataset.price) : 0;

    all.forEach((i) => i.row.classList.toggle('is-picked', i.qty > 0));
    $('[data-box-name]').textContent = box ? box.dataset.name : 'Chọn hộp quà';
    $('[data-count]').textContent = count;
    $('[data-cap]').textContent = cap;
    const pct = cap ? Math.min(100, Math.round((count / cap) * 100)) : 0;
    const bar = $('[data-capacity] .bar');
    bar.querySelector('span').style.width = pct + '%';
    bar.setAttribute('aria-valuenow', pct);
    $('[data-capacity]').classList.toggle('over', count > cap);
    $('[data-box-price]').textContent = vnd(boxPrice);
    $('[data-items-price]').textContent = vnd(itemsPrice);
    $('[data-total]').textContent = vnd(boxPrice + itemsPrice);

    const list = $('[data-picked]');
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Chưa chọn món nào';
      list.append(li);
    } else {
      for (const i of items) {
        const li = document.createElement('li');
        const a = document.createElement('span');
        a.textContent = `${i.name} × ${i.qty}`;
        const b = document.createElement('span');
        b.textContent = vnd(i.price * i.qty);
        li.append(a, b);
        list.append(li);
      }
    }

    const msg = $('[data-builder-msg]');
    let text = '';
    if (!box) text = 'Vui lòng chọn hộp quà.';
    else if (count > cap) text = `${box.dataset.name} chứa tối đa ${cap} món. Hãy bớt ${count - cap} món hoặc chọn hộp lớn hơn.`;
    else if (count < min) text = `Chọn thêm ${min - count} món để hoàn thiện giỏ quà.`;
    msg.hidden = !text || (count === 0 && !!box);
    msg.textContent = text;
    $('[data-builder-submit]').setAttribute('aria-disabled', String(!!text));
  }

  form.addEventListener('change', render);
  form.addEventListener('input', render);
  form.addEventListener('submit', (e) => {
    render();
    if ($('[data-builder-submit]').getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      const msg = $('[data-builder-msg]');
      msg.hidden = false;
      msg.setAttribute('role', 'alert');
    }
  });
  if (toastLink) toastLink.href = '/gio-hang';
  render();
})();
