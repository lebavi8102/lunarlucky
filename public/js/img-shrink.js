/**
 * Thu nhỏ ảnh ngay trên trình duyệt trước khi tải lên: cạnh dài tối đa 1600px, JPEG chất lượng 82%.
 * Ảnh 3–5 MB chụp từ điện thoại còn khoảng 200–400 KB → database nhẹ, trang tải nhanh trên 4G.
 * Trình duyệt không hỗ trợ hoặc thu nhỏ lỗi → gửi ảnh gốc như trước (máy chủ vẫn giới hạn 5 MB).
 */
(() => {
  const MAX_SIDE = 1600;
  const QUALITY = 0.82;
  const KEEP_BELOW = 350 * 1024; // ảnh đã nhỏ và không quá khổ → giữ nguyên
  const KEEP_PNG_BELOW = 1024 * 1024; // PNG (có thể có nền trong suốt, logo) dưới 1 MB → giữ nguyên
  if (typeof DataTransfer === 'undefined' || typeof createImageBitmap === 'undefined') return;

  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file;
    if (/png/i.test(file.type) && file.size <= KEEP_PNG_BELOW) return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= KEEP_BELOW && /jpe?g|webp/i.test(file.type)) {
      bmp.close?.();
      return file;
    }
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG không có nền trong suốt
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || (blob.size >= file.size && !/hei[cf]/i.test(file.type))) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'anh'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }

  const pending = new Map(); // input → Promise đang thu nhỏ

  document.querySelectorAll('input[type=file][accept*="image"]').forEach((input) => {
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      const token = {};
      input._shrinkToken = token;
      const job = Promise.all(files.map((f) => shrink(f).catch(() => f)))
        .then((out) => {
          if (input._shrinkToken !== token || out.every((f, i) => f === files[i])) return;
          const dt = new DataTransfer();
          out.forEach((f) => dt.items.add(f));
          input.files = dt.files;
        })
        .catch(() => {})
        .finally(() => { if (pending.get(input) === job) pending.delete(input); });
      pending.set(input, job);
    });
  });

  // Bấm Lưu khi ảnh đang thu nhỏ → chờ xong (thường < 1 giây) rồi gửi
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const jobs = [...pending].filter(([input]) => input.form === form).map(([, job]) => job);
    if (!jobs.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const submitter = e.submitter;
    Promise.all(jobs).finally(() => (form.requestSubmit ? form.requestSubmit(submitter || undefined) : form.submit()));
  }, true);
})();
