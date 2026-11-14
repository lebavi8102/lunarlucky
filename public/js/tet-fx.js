/* =========================================================
   Hiệu ứng Tết 2027 (Đinh Mùi) — linh vật, chim, hoa, đèn lồng.
   Bật/tắt: Quản trị → Cài đặt → "Hiệu ứng Tết".
   Nhẹ: ảnh tải lười, dừng khi ẩn tab, tôn trọng "giảm chuyển động".
   ========================================================= */
(function () {
  'use strict';
  var root = document.body;
  if (!root || !root.hasAttribute('data-tet')) return;

  var path = location.pathname;
  // Trang thanh toán / giỏ / tài khoản: giữ sạch, không làm phân tâm khách đang trả tiền
  var quiet = /^\/(thanh-toan|gio-hang|tai-khoan|dang-nhap|dang-ky|don-hang|admin)/.test(path);
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = window.matchMedia && matchMedia('(min-width: 1180px)').matches;
  var mid = window.matchMedia && matchMedia('(min-width: 760px)').matches;
  // Đủ lề hai bên khung nội dung (1240px) để đặt chim công, lân mà không che chữ
  var roomy = window.matchMedia && matchMedia('(min-width: 1540px)').matches;
  var IMG = '/img/tet/';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }
  function deco(target, kind, src, w) {
    if (!target) return null;
    var d = el('div', 'tet-deco tet-' + kind);
    d.setAttribute('aria-hidden', 'true');
    var img = new Image();
    img.src = IMG + src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (w) img.width = w;
    d.appendChild(img);
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.classList.add('tet-host');
    target.appendChild(d);
    return d;
  }

  /* ---------- 1. Trang trí theo section ---------- */
  if (!quiet) {
    var hero = document.querySelector('.hero');
    if (hero) {
      if (mid) deco(hero, 'lanterns', 'lantern.webp', 220);
      if (wide) deco(hero, 'cloud-hero', 'clouds.webp', 520);
    }

    var sections = Array.prototype.slice.call(document.querySelectorAll('main .section'));
    var lacquer = document.querySelector('main .section.lacquer');
    var light = sections.filter(function (s) { return !s.classList.contains('lacquer'); });

    if (wide) {
      // Section sáng đầu tiên: mai trái + đào phải (như bìa thiệp Tết)
      if (light[0]) { deco(light[0], 'mai', 'mai.webp', 520); deco(light[0], 'dao', 'dao.webp', 520); }
      // Section sáng thứ 2: hạc bay vào khi cuộn tới
      if (light[1]) deco(light[1], 'crane', 'crane.webp', 300);
      // Lân múa ở section sáng thứ 3 (góc trái dưới)
      if (light[2] && roomy) deco(light[2], 'lan', 'lan.webp', 230);
      // Mây cát tường rải các section sau
      light.slice(3).forEach(function (s, i) {
        deco(s, i % 2 ? 'cloud-r' : 'cloud-l', i % 2 ? 'clouds.webp' : 'clouds-row.webp', 420);
      });
    }
    // Section sơn mài đỏ: nền lụa đỏ + chim công
    if (lacquer) {
      lacquer.classList.add('tet-silk');
      if (roomy) deco(lacquer, 'peacock', 'peacock.webp', 360);
    }
    // Chân trang: hoa văn góc + lì xì
    var foot = document.querySelector('.site-footer');
    if (foot && mid) { deco(foot, 'ornament', 'ornament.webp', 180); deco(foot, 'lixi', 'lixi.webp', 200); }
  }

  /* ---------- 2. Hiện dần khi cuộn tới (chim bay vào, cành hoa nở) ---------- */
  // Theo dõi cả section chứa (không theo dõi ảnh) — ảnh chưa tải có chiều cao 0 dễ bị bỏ sót
  var decos = document.querySelectorAll('.tet-deco');
  var reveal = function (host) { host.querySelectorAll(':scope > .tet-deco').forEach(function (d) { d.classList.add('is-in'); }); };
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -15% 0px' });
    document.querySelectorAll('.tet-host').forEach(function (h) { io.observe(h); });
  } else {
    decos.forEach(function (d) { d.classList.add('is-in'); });
  }

  /* ---------- 3. Linh vật Dê Mùi Lộc ---------- */
  var mascot = document.querySelector('[data-tet-mascot]');
  if (mascot) {
    var KEY = 'tet_mascot_off';
    var off = false;
    try { off = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
    if (quiet || off) {
      mascot.remove();
    } else {
      var bubble = mascot.querySelector('[data-tet-bubble]');
      var lines = (mascot.getAttribute('data-lines') || '').split('|').filter(Boolean);
      var li = 0;
      setTimeout(function () { mascot.classList.add('show'); }, 1200);
      if (bubble && lines.length) {
        var showLine = function () {
          bubble.textContent = lines[li % lines.length];
          bubble.classList.add('on');
          setTimeout(function () { bubble.classList.remove('on'); }, 5200);
          li++;
        };
        setTimeout(showLine, 2400);
        var timer = setInterval(function () { if (!document.hidden) showLine(); }, 14000);
        // Điện thoại: chào 2 lần rồi thôi, đỡ che màn hình
        if (!mid) setTimeout(function () { clearInterval(timer); }, 30000);
      }
      var close = mascot.querySelector('[data-tet-close]');
      if (close) close.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        mascot.classList.remove('show');
        try { sessionStorage.setItem(KEY, '1'); } catch (er) {}
        setTimeout(function () { mascot.remove(); }, 400);
      });
    }
  }

  /* ---------- 4. Hoa mai, hoa đào rơi + pháo hoa vàng ---------- */
  if (reduce || quiet) return;
  var cv = el('canvas', 'tet-canvas');
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  function size() { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size();
  addEventListener('resize', size, { passive: true });

  var COLORS = [['#f6c94c', '#e3a823'], ['#f9d66a', '#d99a1e'], ['#f7b6c2', '#e98aa0'], ['#fbc9d2', '#ef9bb0']];
  var N = wide ? 22 : (mid ? 14 : 8);
  var petals = [];
  function petal(init) {
    var c = COLORS[(Math.random() * COLORS.length) | 0];
    return {
      x: Math.random() * W, y: init ? Math.random() * H : -20 - Math.random() * 60,
      r: 5 + Math.random() * 6, vy: 0.35 + Math.random() * 0.6, vx: -0.2 + Math.random() * 0.4,
      a: Math.random() * 6.28, va: -0.02 + Math.random() * 0.04, sw: Math.random() * 6.28,
      c1: c[0], c2: c[1], five: Math.random() < 0.45,
    };
  }
  for (var i = 0; i < N; i++) petals.push(petal(true));

  function drawPetal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.globalAlpha = 0.85;
    if (p.five) {
      // bông hoa 5 cánh nhỏ
      for (var k = 0; k < 5; k++) {
        ctx.rotate(1.2566);
        ctx.beginPath();
        ctx.ellipse(0, -p.r * 0.55, p.r * 0.38, p.r * 0.6, 0, 0, 6.28);
        ctx.fillStyle = p.c1; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.22, 0, 6.28); ctx.fillStyle = '#b8862e'; ctx.fill();
    } else {
      // một cánh rơi
      var g = ctx.createLinearGradient(-p.r, 0, p.r, 0);
      g.addColorStop(0, p.c1); g.addColorStop(1, p.c2);
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.bezierCurveTo(p.r, -p.r * 0.4, p.r * 0.6, p.r * 0.8, 0, p.r);
      ctx.bezierCurveTo(-p.r * 0.6, p.r * 0.8, -p.r, -p.r * 0.4, 0, -p.r);
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.restore();
  }

  // Pháo hoa vàng: 3 chùm nổ một lần khi mở trang chủ
  var sparks = [];
  function burst(x, y) {
    for (var j = 0; j < 46; j++) {
      var ang = (j / 46) * 6.28, sp = 1.4 + Math.random() * 2.4;
      sparks.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, c: Math.random() < 0.7 ? '#e6c46f' : '#c8283a' });
    }
  }
  if (path === '/' && mid) {
    setTimeout(function () { burst(W * 0.62, H * 0.22); }, 700);
    setTimeout(function () { burst(W * 0.8, H * 0.16); }, 1300);
    setTimeout(function () { burst(W * 0.7, H * 0.32); }, 1900);
  }

  var running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) requestAnimationFrame(tick); });
  function tick() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.sw += 0.012; p.y += p.vy; p.x += p.vx + Math.sin(p.sw) * 0.5; p.a += p.va;
      if (p.y > H + 20 || p.x < -30 || p.x > W + 30) petals[i] = petal(false);
      drawPetal(p);
    }
    for (var s = sparks.length - 1; s >= 0; s--) {
      var k = sparks[s];
      k.x += k.vx; k.y += k.vy; k.vy += 0.035; k.vx *= 0.985; k.life -= 0.012;
      if (k.life <= 0) { sparks.splice(s, 1); continue; }
      ctx.globalAlpha = k.life;
      ctx.beginPath(); ctx.arc(k.x, k.y, 1.8, 0, 6.28); ctx.fillStyle = k.c; ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
