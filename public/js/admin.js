(() => {
  // Nút sao chép (link kênh, link gửi khách)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const old = b.textContent;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Đã chép ✓';
    } catch {
      b.textContent = 'Chép thủ công';
    }
    setTimeout(() => { b.textContent = old; }, 1500);
  });

  // Hỏi lại trước khi xóa
  document.querySelectorAll('form[data-confirm]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      if (!confirm(f.dataset.confirm)) e.preventDefault();
    }),
  );

  // Ảnh chụp điện thoại (5–12MB) → thu nhỏ còn cạnh dài 1600px, JPEG ~300KB trước khi tải lên:
  // không vướng giới hạn 5MB, web tải nhanh trên 4G.
  const MAX_SIDE = 1600;
  async function shrink(file) {
    if (!/^image\//.test(file.type)) return file;
    let img;
    try {
      img = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return file; // trình duyệt không đọc được (vd HEIC trên máy tính) → để máy chủ báo lỗi rõ ràng
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    if (scale === 1 && file.size <= 500 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG nền trong suốt → nền trắng khi chuyển JPEG
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  }
  document.querySelectorAll('input[type=file]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.files || !input.files.length || input.dataset.shrunk === '1') return;
      const form = input.form;
      const buttons = form ? [...form.querySelectorAll('button[type=submit], button:not([type])')] : [];
      buttons.forEach((b) => { b.disabled = true; b.dataset.html = b.innerHTML; b.textContent = 'Đang xử lý ảnh…'; });
      try {
        const dt = new DataTransfer();
        for (const f of input.files) dt.items.add(await shrink(f));
        input.dataset.shrunk = '1';
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {
        /* lỗi bất ngờ → giữ ảnh gốc */
      } finally {
        delete input.dataset.shrunk;
        buttons.forEach((b) => { b.disabled = false; b.innerHTML = b.dataset.html; });
      }
    });
  });

  // Xem trước ảnh trước khi tải lên
  document.querySelectorAll('input[type=file][data-preview]').forEach((input) =>
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let box = input.parentElement.querySelector('.img-preview');
      if (!box) {
        box = document.createElement('div');
        box.className = 'img-preview';
        box.append(document.createElement('img'));
        input.before(box);
      }
      box.querySelector('img').src = URL.createObjectURL(file);
    }),
  );

  // Định dạng số tiền khi rời ô nhập
  const fmt = new Intl.NumberFormat('vi-VN');
  document.querySelectorAll('input[data-money]').forEach((i) => {
    const clean = () => i.value.replace(/[^\d]/g, '');
    i.addEventListener('focus', () => (i.value = clean()));
    i.addEventListener('blur', () => {
      const v = clean();
      i.value = v ? fmt.format(Number(v)) : '';
    });
    if (i.value) i.value = fmt.format(Number(clean()));
  });
})();

// Tạo đơn trong admin: thêm/xóa dòng giỏ, điền giá lẻ / giá sỉ catalogue, tính tổng (25/11/2026)
(() => {
  const form = document.querySelector('form[data-new-order]');
  if (!form) return;
  const fmt = new Intl.NumberFormat('vi-VN');
  const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
  const box = form.querySelector('[data-lines]');
  const tpl = document.querySelector('template[data-line-tpl]');
  const lines = () => [...box.querySelectorAll('[data-line]')];
  const optOf = (line) => { const s = line.querySelector('[data-product]'); return s.options[s.selectedIndex]; };
  const totalQty = () => lines().reduce((t, l) => t + (optOf(l).value ? num(l.querySelector('[data-qty]').value) : 0), 0);
  const tierPrice = (o, q) => (q >= 100 && o.dataset.t100) || (q >= 50 && o.dataset.t50) || (q >= 10 && o.dataset.t10) || '';
  const setPrice = (line, v) => { const i = line.querySelector('[data-unit]'); i.value = v ? fmt.format(Number(v)) : ''; };
  function recalc() {
    let goods = 0;
    for (const l of lines()) {
      const t = num(l.querySelector('[data-qty]').value) * num(l.querySelector('[data-unit]').value);
      goods += t;
      l.querySelector('[data-line-total]').textContent = t ? fmt.format(t) + '₫' : '—';
    }
    const ship = num(form.querySelector('[data-ship]').value);
    form.querySelector('[data-sum-qty]').textContent = totalQty();
    form.querySelector('[data-sum-goods]').textContent = fmt.format(goods) + '₫';
    form.querySelector('[data-sum-total]').textContent = fmt.format(goods + ship) + '₫';
  }
  function wire(line) {
    line.querySelector('[data-product]').addEventListener('change', () => {
      const o = optOf(line);
      setPrice(line, o.value ? o.dataset.price : '');
      recalc();
    });
    line.querySelector('[data-del]').addEventListener('click', () => {
      if (lines().length > 1) line.remove(); else { line.querySelector('[data-product]').value = ''; setPrice(line, ''); }
      recalc();
    });
    const p = line.querySelector('[data-unit]');
    p.addEventListener('focus', () => (p.value = String(num(p.value) || '')));
    p.addEventListener('blur', () => { p.value = num(p.value) ? fmt.format(num(p.value)) : ''; });
  }
  lines().forEach(wire);
  form.addEventListener('input', recalc);
  form.querySelector('[data-add]').addEventListener('click', () => {
    box.appendChild(tpl.content.cloneNode(true));
    wire(lines()[lines().length - 1]);
    lines()[lines().length - 1].querySelector('[data-product]').focus();
  });
  const note = form.querySelector('[data-tier-note]');
  form.querySelector('[data-tier]').addEventListener('click', () => {
    const q = totalQty();
    if (q < 10) { note.textContent = `Đơn mới ${q} giỏ: giá sỉ catalogue áp dụng từ 10 giỏ. Anh sửa đơn giá tay nếu chốt giá riêng.`; return; }
    let miss = [];
    for (const l of lines()) { const o = optOf(l); if (!o.value) continue; const t = tierPrice(o, q); if (t) setPrice(l, t); else miss.push(o.text.split(' — ')[0]); }
    note.textContent = `Đã điền giá sỉ mức ${q >= 100 ? '100–499' : q >= 50 ? '50–99' : '10–49'} giỏ (tổng ${q} giỏ).` + (miss.length ? ` Không có trong catalogue, giữ nguyên giá: ${miss.join(', ')}.` : '');
    recalc();
  });
  form.querySelector('[data-retail]').addEventListener('click', () => { lines().forEach((l) => { const o = optOf(l); if (o.value) setPrice(l, o.dataset.price); }); recalc(); });
  const gift = form.querySelector('[data-gift]');
  gift.addEventListener('change', () => (form.querySelector('[data-gift-box]').hidden = !gift.checked));
  const ps = form.querySelector('[data-paystatus]');
  ps.addEventListener('change', () => (form.querySelector('[data-deposit-box]').hidden = ps.value !== 'deposit'));
  // Dòng đã chọn giỏ nhưng chưa có giá (vd quay lại sau lỗi) → điền giá lẻ
  lines().forEach((l) => { const o = optOf(l); if (o.value && !num(l.querySelector('[data-unit]').value)) setPrice(l, o.dataset.price); });
  recalc();
})();
