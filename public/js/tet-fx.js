/* =========================================================
   Trang trí Tết 2027 — gắn cành mai/đào, hạc, chim công vào đúng section
   và chạy đồng hồ đếm ngược. Bật/tắt: Cài đặt → "Hiệu ứng Tết".
   ========================================================= */
(function () {
  'use strict';
  if (!document.body || !document.body.hasAttribute('data-tet')) return;

  var mq = function (q) { return window.matchMedia && matchMedia(q).matches; };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var wide = mq('(min-width: 1180px)');   // đủ chỗ cho cành hoa, hạc
  var roomy = mq('(min-width: 1540px)');  // đủ lề hai bên cho chim công

  function deco(host, kind, file) {
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'tet-deco tet-' + kind;
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<img src="/img/tet/' + file + '" alt="" loading="lazy" decoding="async">';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('tet-host');
    host.appendChild(d);
  }

  var path = location.pathname;
  // Giỏ hàng / thanh toán / tài khoản: giữ sạch để khách tập trung trả tiền
  var quiet = /^\/(thanh-toan|gio-hang|tai-khoan|dang-nhap|dang-ky|don-hang|tra-cuu)/.test(path);
  if (quiet) return;
  var isHome = path === '/';
  var isCollection = /^\/(bo-suu-tap|gio-qua-tet)/.test(path);

  /* ---------- Đèn lồng đầu trang (trang chủ, bộ sưu tập, quà doanh nghiệp) ---------- */
  // Trang chủ: ảnh banner Tết đã có đèn lồng nên không treo thêm
  var top = (!isHome && document.querySelector('.hero')) || (isCollection && document.querySelector('.page-head'));
  if (top) {
    var lan = document.createElement('div');
    lan.className = 'tet-lanterns';
    lan.setAttribute('aria-hidden', 'true');
    lan.innerHTML = '<img src="/img/tet/lantern.svg" alt=""><img src="/img/tet/lantern.svg" alt="">';
    if (getComputedStyle(top).position === 'static') top.style.position = 'relative';
    top.appendChild(lan);
  }

  /* ---------- Trang trí theo section ---------- */
  var main = document.querySelector('main') || document;
  if (isCollection && wide) {
    var head = document.querySelector('.page-head');
    if (head) { head.style.overflow = 'hidden'; deco(head, 'mai', 'mai.webp'); }
  }
  if (wide) {
    var featured = main.querySelector('.section.featured-first');
    if (featured) { deco(featured, 'mai', 'mai.webp'); deco(featured, 'dao', 'dao.webp'); }
    // Khối "Bộ sưu tập": section đầu tiên có tiêu đề căn giữa
    var center = main.querySelector('.section .section-head.center');
    if (center) deco(center.closest('.section'), 'crane', 'crane.webp');
  }
  // Khối sơn mài "Trao tận tay" → nền xanh ngọc (xen kẽ đỏ / xanh / kem như tranh Tết)
  var lacquer = main.querySelector('.section.lacquer');
  if (lacquer) {
    lacquer.classList.add('tet-jade');
    if (mq('(min-width: 760px)')) deco(lacquer, 'drum', 'drum.webp');
    if (roomy) deco(lacquer, 'peacock', 'peacock.webp');
    else if (wide) { deco(lacquer, 'peacock', 'peacock.webp'); lacquer.lastChild.classList.add('tet-left'); }
  }
  if (wide) {
    var b2b = main.querySelector('.b2b-card');
    if (b2b) deco(b2b.closest('.section'), 'cloud-r', 'clouds.webp');
    var social = main.querySelector('.social-cta');
    if (social) deco(social.closest('.section'), 'cloud-l', 'clouds.webp');
  }

  /* ---------- Hiện dần khi cuộn tới ---------- */
  var hosts = document.querySelectorAll('.tet-host');
  var reveal = function (h) { h.querySelectorAll(':scope > .tet-deco').forEach(function (d) { d.classList.add('is-in'); }); };
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -15% 0px' });
    hosts.forEach(function (h) { io.observe(h); });
  } else {
    hosts.forEach(reveal);
  }

  /* ---------- Hoa mai, đào rơi nhẹ + pháo hoa vàng khi mở trang chủ ---------- */
  if (!reduce && (isHome || isCollection || /^\/qua-tang-doanh-nghiep/.test(path))) petals();

  function petals() {
    var cv = document.createElement('canvas');
    cv.className = 'tet-canvas'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), W, H, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = function () { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size, { passive: true });
    var COL = [['#f3c548', '#d99a1e'], ['#f6d36b', '#c98d1b'], ['#f5b3c1', '#e3879e'], ['#f9c8d2', '#ea98ad']];
    var N = mq('(min-width: 1180px)') ? 18 : (mq('(min-width: 760px)') ? 12 : 7);
    var make = function (init) {
      var c = COL[(Math.random() * COL.length) | 0];
      return { x: Math.random() * W, y: init ? Math.random() * H : -20, r: 5 + Math.random() * 5, vy: .3 + Math.random() * .45,
        vx: -.15 + Math.random() * .3, a: Math.random() * 6.3, va: -.015 + Math.random() * .03, sw: Math.random() * 6.3, c1: c[0], c2: c[1], flower: Math.random() < .4 };
    };
    var ps = []; for (var i = 0; i < N; i++) ps.push(make(true));
    var sparks = [];
    var burst = function (x, y) { for (var j = 0; j < 42; j++) { var g = j / 42 * 6.28, v = 1.3 + Math.random() * 2.2; sparks.push({ x: x, y: y, vx: Math.cos(g) * v, vy: Math.sin(g) * v, l: 1, c: Math.random() < .75 ? '#e6c46f' : '#d9333b' }); } };
    if (isHome && mq('(min-width: 760px)')) {
      setTimeout(function () { burst(W * .6, H * .2); }, 600);
      setTimeout(function () { burst(W * .78, H * .14); }, 1150);
      setTimeout(function () { burst(W * .68, H * .3); }, 1700);
    }
    var draw = function (p) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = .85;
      if (p.flower) {
        for (var k = 0; k < 5; k++) { ctx.rotate(1.2566); ctx.beginPath(); ctx.ellipse(0, -p.r * .55, p.r * .36, p.r * .58, 0, 0, 6.28); ctx.fillStyle = p.c1; ctx.fill(); }
        ctx.beginPath(); ctx.arc(0, 0, p.r * .22, 0, 6.28); ctx.fillStyle = '#a8761f'; ctx.fill();
      } else {
        var gr = ctx.createLinearGradient(-p.r, 0, p.r, 0); gr.addColorStop(0, p.c1); gr.addColorStop(1, p.c2);
        ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.bezierCurveTo(p.r, -p.r * .4, p.r * .6, p.r * .8, 0, p.r); ctx.bezierCurveTo(-p.r * .6, p.r * .8, -p.r, -p.r * .4, 0, -p.r);
        ctx.fillStyle = gr; ctx.fill();
      }
      ctx.restore();
    };
    var run = true;
    document.addEventListener('visibilitychange', function () { run = !document.hidden; if (run) requestAnimationFrame(tick); });
    function tick() {
      if (!run) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < ps.length; i++) { var p = ps[i]; p.sw += .012; p.y += p.vy; p.x += p.vx + Math.sin(p.sw) * .45; p.a += p.va; if (p.y > H + 20 || p.x < -30 || p.x > W + 30) ps[i] = make(false); draw(p); }
      for (var s = sparks.length - 1; s >= 0; s--) { var k = sparks[s]; k.x += k.vx; k.y += k.vy; k.vy += .03; k.vx *= .985; k.l -= .012; if (k.l <= 0) { sparks.splice(s, 1); continue; } ctx.globalAlpha = k.l; ctx.beginPath(); ctx.arc(k.x, k.y, 1.8, 0, 6.28); ctx.fillStyle = k.c; ctx.fill(); }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- Đếm ngược tới ngày chốt giao trước Tết ---------- */
  var box = document.querySelector('[data-tet-deadline]');
  if (box) {
    var end = Date.parse(box.getAttribute('data-tet-deadline'));
    var q = function (s) { return box.querySelector(s); };
    var D = q('[data-d]'), H = q('[data-h]'), M = q('[data-m]'), S = q('[data-s]');
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var tick = function () {
      var t = Math.max(0, end - Date.now()) / 1000;
      D.textContent = Math.floor(t / 86400);
      H.textContent = pad(Math.floor(t % 86400 / 3600));
      M.textContent = pad(Math.floor(t % 3600 / 60));
      S.textContent = pad(Math.floor(t % 60));
    };
    if (!isNaN(end)) { tick(); setInterval(tick, 1000); }
  }
})();
