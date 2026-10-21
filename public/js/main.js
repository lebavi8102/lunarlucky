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
      // Gửi tặng: ẩn COD (không để tài xế thu tiền người được tặng), chọn sẵn chuyển khoản
      const codOpt = $('[data-cod-option]');
      if (codOpt) {
        codOpt.hidden = giftToggle.checked;
        if (codOpt.hidden && $('input', codOpt).checked) $('input[name=payment_method][value=bank]').checked = true;
      }
      $$('input', giftFields).forEach((i) => (i.required = giftToggle.checked));
      $$('input', buyerAddr).forEach((i) => (i.required = !giftToggle.checked));
    };
    giftToggle.addEventListener('change', sync);
    sync();
  }
  /* Trang thanh toán: + / − / xóa món trong khung Đơn hàng (cập nhật tại chỗ, giữ nguyên thông tin đã điền) */
  const summary = $('.summary[aria-label]');
  if (summary && $('[data-checkout]')) {
    const token = $('[data-checkout] input[name=_csrf]').value;
    let busy = false;
    let timer;
    // url = null: chỉ tải lại khung Đơn hàng (VD sau khi áp mã giảm giá)
    const send = async (url, body) => {
      if (busy) return;
      busy = true;
      summary.classList.add('is-updating');
      try {
        if (url) {
          const r = await fetch(url, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token },
            body: new URLSearchParams(body),
          });
          const d = await r.json();
          if (d.count === 0) return void (location.href = '/gio-hang');
          if (d.count) $$('[data-cart-count]').forEach((el) => { el.textContent = d.count; el.dataset.count = d.count; });
        }
        const html = await (await fetch('/thanh-toan', { headers: { accept: 'text/html' }, cache: 'no-store' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fresh = doc.querySelector('.summary[aria-label]');
        if (fresh) summary.innerHTML = fresh.innerHTML;
        window.__syncDeposit?.();
      } catch {
        showToast('Không cập nhật được số lượng, vui lòng thử lại.');
      } finally {
        busy = false;
        summary.classList.remove('is-updating');
      }
    };
    summary.addEventListener('change', (e) => {
      const input = e.target.closest('[data-checkout-qty]');
      if (!input) return;
      clearTimeout(timer);
      timer = setTimeout(() => send('/gio-hang/cap-nhat', { key: input.dataset.checkoutQty, qty: input.value }), 350);
    });
    summary.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-checkout-remove]');
      if (b) return send('/gio-hang/xoa', { key: b.dataset.checkoutRemove });
      if (e.target.closest('[data-coupon-remove]')) return send('/gio-hang/ma-giam-gia', { remove: '1', from: 'checkout' });
      if (e.target.closest('[data-coupon-apply]')) {
        const code = ($('[data-coupon-input]', summary).value || '').trim();
        const msg = $('[data-coupon-msg]', summary);
        if (!code) return msg && (msg.textContent = 'Vui lòng nhập mã giảm giá.');
        const r = await fetch('/gio-hang/ma-giam-gia', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token },
          body: new URLSearchParams({ code, from: 'checkout' }),
        }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Mất kết nối, vui lòng thử lại.' }));
        if (!r.ok) return msg && (msg.textContent = r.error || 'Mã không hợp lệ.');
        showToast(`Đã áp dụng mã ${r.code}`);
        await send(null); // làm mới khung Đơn hàng với giá đã giảm
      }
    });
    summary.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-coupon-input]')) {
        e.preventDefault(); // không gửi nhầm cả đơn
        $('[data-coupon-apply]', summary)?.click();
      }
    });
  }

  /* Thanh toán: chọn nhanh ngày giao */
  const dateInputWrap = $('[data-date-input]');
  if (dateInputWrap) {
    const input = $('input[name=delivery_date]', dateInputWrap);
    const picks = $$('[data-date-pick], [data-date-other]');
    const press = (btn) => picks.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    picks.forEach((b) =>
      b.addEventListener('click', () => {
        press(b);
        if (b.dataset.datePick) {
          input.value = b.dataset.datePick;
          dateInputWrap.hidden = true;
        } else {
          dateInputWrap.hidden = false;
          input.focus();
          input.showPicker?.();
        }
      }),
    );

    // Đổi tỉnh: Hà Nội giao sớm, tỉnh khác chuyển phát 2–4 ngày → đẩy ngày sớm nhất + nút chọn nhanh
    const box = $('[data-date-rules]');
    let rules = {};
    try { rules = JSON.parse(box?.dataset.dateRules || '{}'); } catch { /* bỏ qua */ }
    const province = $('select[name=province]');
    const hint = $('[data-date-hint]');
    const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const applyProvince = () => {
      if (!province || !rules.hn) return;
      const hn = /hà nội/i.test(province.value.normalize('NFC'));
      const min = hn ? rules.hn : rules.tinh;
      if (input.min === min) return;
      input.min = min;
      const quick = $$('[data-date-pick]');
      const full = new Set(rules.full || []);
      const open1 = (d) => (rules.closedFrom && d >= rules.closedFrom && d <= rules.closedTo ? addDays(rules.closedTo, 1) : d);
      const open = (d) => { let x = open1(d); for (let i = 0; i < 60 && full.has(x); i++) x = open1(addDays(x, 1)); return x; };
      let cur = open(min);
      quick.forEach((b, i) => {
        const d = i === 0 ? cur : (cur = open(addDays(cur, 1)));
        b.dataset.datePick = d;
        b.innerHTML = `<b>${i === 0 ? 'Sớm nhất' : WD[new Date(d + 'T00:00:00Z').getUTCDay()]}</b><span>${d.slice(8)}/${d.slice(5, 7)}</span>`;
      });
      if (hint) {
        hint.hidden = hn;
        const day = $('[data-date-hint-day]', hint);
        if (day) day.textContent = min.split('-').reverse().join('/');
      }
      // Ngày đang chọn sớm hơn mức cho phép → chuyển về ngày sớm nhất
      if (!input.value || input.value < min) {
        input.value = min;
        if (quick[0]) { press(quick[0]); dateInputWrap.hidden = true; }
      } else {
        const match = quick.find((b) => b.dataset.datePick === input.value);
        if (match) press(match);
      }
    };
    province?.addEventListener('change', applyProvince);
    // Buổi giao: chỉ Hà Nội; bấm chọn → đánh dấu ô
    const slotBox = $('[data-slot-box]');
    const slotHelp = $('[data-slot-help]');
    const syncSlot = () => {
      $$('[data-slot-box] label').forEach((l) => l.setAttribute('aria-pressed', String(!!$('input', l)?.checked)));
    };
    slotBox?.addEventListener('change', syncSlot);
    province?.addEventListener('change', () => {
      const hn = /hà nội/i.test(province.value.normalize('NFC'));
      if (slotBox) slotBox.hidden = !hn;
      if (slotHelp) slotHelp.textContent = hn ? 'Shipper gọi trước khi giao.' : 'Giao tỉnh qua đơn vị vận chuyển, giao trong giờ hành chính.';
    });
    applyProvince();
  }

  /* Báo giá doanh nghiệp: giao nhiều địa chỉ → hỏi số điểm giao */
  const modeBox = $('[data-delivery-mode]');
  const pointsBox = $('[data-delivery-points]');
  if (modeBox && pointsBox) {
    modeBox.addEventListener('change', () => {
      pointsBox.hidden = $('input[name=delivery_mode]:checked', modeBox)?.value !== 'many';
    });
  }

  /* Thanh toán: bấm chọn lời chúc có sẵn */
  $$('[data-wish]').forEach((b) =>
    b.addEventListener('click', () => {
      const ta = $('textarea[name=card_message]');
      if (!ta) return;
      ta.value = b.dataset.wish;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      $$('[data-wish]').forEach((x) => x.setAttribute('aria-current', String(x === b)));
    }),
  );

  /* Thanh toán: ghi nhớ thông tin người đặt trên máy này (lần sau khỏi gõ lại) */
  // Đặt hộ: xem trước tổng sau điều chỉnh giá (đổi món)
  const adj = $('[data-adjust]');
  if (adj) {
    const prev = $('[data-adjust-preview]');
    const totalEl = $('[data-total]');
    const show = () => {
      const n = Number(String(adj.value).replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''));
      const base = Number(totalEl?.dataset.base || 0);
      prev.textContent = adj.value.trim() && Number.isFinite(n) && n ? `Tổng sau điều chỉnh: ${(base + n).toLocaleString('vi-VN')}₫ (chưa gồm phí VAT nếu có)` : '';
    };
    adj.addEventListener('input', show);
    show();
  }

  const ckForm = $('[data-checkout]');
  if (ckForm && !('staff' in ckForm.dataset)) {
    const KEY = 'll_buyer';
    const FIELDS = ['customer_name', 'phone', 'email', 'province', 'address'];
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    if (saved) {
      let filled = false;
      const hasErrors = !!$('[data-focus-on-load]'); // trang báo lỗi: giữ nguyên những gì khách vừa nhập
      FIELDS.forEach((n) => {
        const el = ckForm.elements[n];
        if (!el || !saved[n]) return;
        if (n === 'province') {
          if (!hasErrors && [...el.options].some((o) => o.value === saved[n])) { el.value = saved[n]; filled = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
        } else if (!el.value) { el.value = saved[n]; filled = true; }
      });
      if (filled) $('[data-remember-note]')?.removeAttribute('hidden');
    }
    $('[data-remember-clear]')?.addEventListener('click', () => {
      try { localStorage.removeItem(KEY); } catch { /* bỏ qua */ }
      FIELDS.forEach((n) => { const el = ckForm.elements[n]; if (el && n !== 'province') el.value = ''; });
      $('[data-remember-note]').hidden = true;
      ckForm.elements.customer_name?.focus();
    });
    ckForm.addEventListener('submit', () => {
      const data = {};
      FIELDS.forEach((n) => { const el = ckForm.elements[n]; if (el) data[n] = el.value; });
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* bỏ qua */ }
    });
  }

  /* Trang sản phẩm (điện thoại): hiện thanh "Mua ngay" khi nút mua đã cuộn khỏi màn hình */
  const buyBar = $('[data-buy-bar]');
  const buyRow = $('#buy-form .buy-row');
  if (buyBar && buyRow && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      const show = !en.isIntersecting; // nút mua đang khuất (ở dưới hoặc đã cuộn qua) → hiện thanh Mua ngay
      buyBar.classList.toggle('show', show);
      buyBar.setAttribute('aria-hidden', String(!show));
      $('button', buyBar).tabIndex = show ? 0 : -1;
      document.body.classList.toggle('has-buy-bar', show);
    }).observe(buyRow);
  }

  /* Thanh toán: chọn COD ở đơn cần cọc → hiện "Đặt cọc trước / Trả khi nhận" */
  const syncDeposit = () => {
    const cod = $('input[name=payment_method][value=cod]');
    const on = !!(cod && cod.checked && !cod.closest('[hidden]'));
    $$('[data-deposit-row]').forEach((r) => (r.hidden = !on));
  };
  if ($('[data-checkout]')) {
    document.addEventListener('change', (e) => { if (e.target.matches('input[name=payment_method], [data-gift-toggle]')) syncDeposit(); });
    syncDeposit();
    window.__syncDeposit = syncDeposit;
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

  /* Ô "Để lại SĐT – gọi lại" */
  $$('[data-callback-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('[data-callback-msg]', form);
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      msg.textContent = '';
      try {
        const r = await fetch(form.action, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) {
          msg.style.color = 'var(--lacquer-700)';
          msg.textContent = d.error || (r.status === 429 ? 'Bạn gửi quá nhiều lần, vui lòng thử lại sau ít phút.' : 'Chưa gửi được, vui lòng thử lại.');
          return;
        }
        $('.callback-fields', form).hidden = true;
        msg.style.color = 'var(--jade-700)';
        msg.textContent = '✓ ' + d.message;
      } catch {
        msg.textContent = 'Mất kết nối, vui lòng thử lại.';
      } finally {
        btn.disabled = false;
      }
    });
  });

  /* "Hỏi nhanh qua Zalo": Zalo không cho điền sẵn tin nhắn → chép câu hỏi để khách chỉ việc dán */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-ask]');
    if (!a) return;
    navigator.clipboard?.writeText(a.dataset.ask).then(
      () => showToast('Đã chép câu hỏi — mở Zalo và dán vào ô chat để gửi.'),
      () => {},
    );
  });

  /* Sao chép */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      showToast(b.dataset.copy.length > 60 ? 'Đã sao chép' : `Đã sao chép: ${b.dataset.copy}`);
    } catch {
      showToast('Không sao chép được, vui lòng chép thủ công.');
    }
  });
})();
