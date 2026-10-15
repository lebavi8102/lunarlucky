(() => {
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
