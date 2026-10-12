(() => {
  // Hỏi lại trước khi xóa
  document.querySelectorAll('form[data-confirm]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      if (!confirm(f.dataset.confirm)) e.preventDefault();
    }),
  );

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
