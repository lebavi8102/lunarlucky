/* Đo lường: Meta Pixel + Google Analytics 4. Cấu hình và sự kiện của trang nằm trong #track-cfg (máy chủ in ra). */
(() => {
  const el = document.getElementById('track-cfg');
  if (!el) return;
  let cfg = {};
  try { cfg = JSON.parse(el.textContent || '{}'); } catch { return; }
  const load = (src) => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); };

  // Meta Pixel (mã chuẩn của Meta, viết lại không dùng inline script)
  if (cfg.pixel) {
    const f = (window.fbq = function fbq() { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); });
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    load('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', cfg.pixel);
    window.fbq('track', 'PageView');
  }
  // Google Analytics 4
  if (cfg.ga4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga4)}`);
    window.gtag('js', new Date());
    window.gtag('config', cfg.ga4);
  }

  // Một sự kiện → gửi cả hai nơi với tên đúng chuẩn của từng nơi
  const META = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', generate_lead: 'Lead' };
  function send(ev) {
    const items = ev.items || [];
    if (cfg.pixel && window.fbq && META[ev.name]) {
      window.fbq('track', META[ev.name], {
        value: ev.value || 0, currency: 'VND', content_type: 'product',
        content_ids: items.map((i) => String(i.item_id)), contents: items.map((i) => ({ id: String(i.item_id), quantity: i.quantity || 1 })),
        num_items: items.reduce((x, i) => x + (i.quantity || 1), 0) || undefined,
      }, ev.id ? { eventID: ev.id } : undefined);
    }
    if (cfg.ga4 && window.gtag) {
      window.gtag('event', ev.name, { value: ev.value || 0, currency: 'VND', items, ...(ev.transaction_id ? { transaction_id: ev.transaction_id } : {}) });
    }
  }
  window.lunarTrack = send;
  (cfg.events || []).forEach(send);

  // Thêm vào giỏ (form thêm giỏ có data-track-*): gửi khi bấm
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches && f.matches('[data-add-to-cart][data-track-id]')) {
      const qty = Number((f.querySelector('[name=qty]') || {}).value) || 1;
      const price = Number(f.dataset.trackPrice) || 0;
      send({ name: 'add_to_cart', value: price * qty, items: [{ item_id: f.dataset.trackId, item_name: f.dataset.trackName, price, quantity: qty }] });
    }
    if (f.matches && f.matches('[data-callback-form]')) send({ name: 'generate_lead', value: 0 });
  }, true);
})();
