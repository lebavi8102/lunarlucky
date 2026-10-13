/* Lunar Lucky — tương tác phía client. Mọi form vẫn hoạt động khi tắt JS. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Header đổ bóng khi cuộn */
  const header = $('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Ô tìm kiếm */
  const searchBtn = $('[data-search-toggle]');
  const searchPanel = $('#search-panel');
  if (searchBtn && searchPanel) {
    searchBtn.addEventListener('click', () => {
      const open = searchPanel.hidden;
      searchPanel.hidden = !open;
      searchBtn.setAttribute('aria-expanded', String(open));
      if (open) $('input', searchPanel).focus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !searchPanel.hidden) {
        searchPanel.hidden = true;
        searchBtn.setAttribute('aria-expanded', 'false');
        searchBtn.focus();
      }
    });
  }

  /* Drawer menu di động: khóa focus, đóng bằng Esc */
  const drawer = $('[data-drawer]');
  const opener = $('[data-drawer-open]');
  if (drawer && opener) {
    const panel = $('.drawer-panel', drawer);
    const focusables = () => $$('a, button', panel);
    const open = () => {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      opener.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      setTimeout(() => focusables()[0]?.focus(), 50);
    };
    const close = () => {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      opener.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      opener.focus();
    };
    opener.addEventListener('click', open);
    $$('[data-drawer-close]', drawer).forEach((b) => b.addEventListener('click', close));
    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const f = focusables();
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* Hiện dần khi cuộn tới */
  const reveals = $$('.reveal');
  if (reveals.length && 'IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('in'));

  /* Nút tăng/giảm số lượng */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qty] [data-step]');
    if (!btn) return;
    const input = $('input', btn.closest('[data-qty]'));
    const min = Number(input.min || 0);
    const max = Number(input.max || 999);
    const next = Math.min(max, Math.max(min, (Number(input.value) || 0) + Number(btn.dataset.step)));
    if (next === Number(input.value)) return;
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* Giỏ hàng: tự gửi khi đổi số lượng */
  $$('[data-qty-form]').forEach((form) => {
    let t;
    form.addEventListener('change', () => {
      clearTimeout(t);
      t = setTimeout(() => form.submit(), 450);
    });
  });

  /* Tự gửi form sắp xếp */
  $$('[data-autosubmit]').forEach((form) => form.addEventListener('change', () => form.submit()));

  /* Toast */
  const toast = $('[data-toast]');
  let toastTimer;
  function showToast(text) {
    if (!toast) return;
    $('[data-toast-text]', toast).textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  function setCartCount(n) {
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.dataset.count = n;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      el.closest('a')?.setAttribute('aria-label', `Giỏ hàng, ${n} sản phẩm`);
    });
  }

  /* Thêm vào giỏ không tải lại trang */
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-add-to-cart]');
    if (!form || (e.submitter && e.submitter.hasAttribute('data-no-ajax'))) return;
    e.preventDefault();
    const btn = e.submitter || $('button[type=submit]', form);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Không thêm được sản phẩm.');
      setCartCount(data.count);
      showToast(`Đã thêm “${data.name}” vào giỏ`);
    } catch (err) {
      showToast(err.message || 'Có lỗi, vui lòng thử lại.');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });

  /* Gallery sản phẩm */
  const gallery = $('[data-gallery]');
  if (gallery) {
    const main = $('[data-gallery-main]', gallery);
    $$('[data-src]', gallery).forEach((b) =>
      b.addEventListener('click', () => {
        main.src = b.dataset.src;
        $$('[data-src]', gallery).forEach((x) => x.setAttribute('aria-current', String(x === b)));
      }),
    );
  }

  /* Checkout: bật/tắt người nhận */
  const giftToggle = $('[data-gift-toggle]');
  if (giftToggle) {
    const giftFields = $('[data-gift-fields]');
    const buyerAddr = $('[data-buyer-address]');
    const sync = () => {
      giftFields.hidden = !giftToggle.checked;
      buyerAddr.hidden = giftToggle.checked;
      $$('input', giftFields).forEach((i) => (i.required = giftToggle.checked));
      $$('input', buyerAddr).forEach((i) => (i.required = !giftToggle.checked));
    };
    giftToggle.addEventListener('change', sync);
    sync();
  }
  /* Checkout: xuất VAT → hiện form công ty, chỉ cho chuyển khoản */
  const vatToggle = $('[data-vat-toggle]');
  if (vatToggle) {
    const fields = $('[data-vat-fields]');
    const cod = $('[data-cod-option]');
    const syncVat = () => {
      const on = vatToggle.checked;
      fields.hidden = !on;
      $$('input', fields).forEach((i) => (i.required = on));
      cod.hidden = on;
      const notice = $('[data-vat-notice]');
      const row = $('[data-vat-row]');
      const total = $('[data-total]');
      if (notice) notice.hidden = !on;
      if (row) row.hidden = !on;
      if (total) {
        const v = Number(on ? total.dataset.withVat : total.dataset.base);
        total.textContent = new Intl.NumberFormat('vi-VN').format(v) + '₫';
      }
      if (on) {
        const codInput = $('input', cod);
        if (codInput.checked) $('input[name=payment_method][value=bank]').checked = true;
      }
    };
    vatToggle.addEventListener('change', syncVat);
    syncVat();
  }

  const checkout = $('[data-checkout]');
  if (checkout) {
    checkout.addEventListener('submit', () => {
      const b = $('[data-submit]', checkout);
      setTimeout(() => { b.disabled = true; b.textContent = 'Đang gửi đơn…'; }, 0);
    });
  }
  $('[data-focus-on-load]')?.focus();

  /* Trang đơn: tự kiểm tra đã nhận chuyển khoản chưa (SePay báo về) → tải lại để hiện "Đã thanh toán" */
  const poll = $('[data-pay-poll]');
  if (poll) {
    const started = Date.now();
    const tick = async () => {
      if (Date.now() - started > 30 * 60000) return; // dừng sau 30 phút
      if (!document.hidden) {
        try {
          const r = await fetch(poll.dataset.payPoll, { headers: { accept: 'application/json' }, cache: 'no-store' });
          const d = await r.json();
          if (d.paid || d.cancelled) return location.reload();
        } catch { /* mạng chập chờn: thử lại lần sau */ }
      }
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
  }

  /* Sao chép */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      showToast(`Đã sao chép: ${b.dataset.copy}`);
    } catch {
      showToast('Không sao chép được, vui lòng chép thủ công.');
    }
  });
})();
