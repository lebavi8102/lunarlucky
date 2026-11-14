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

  /* ---------- Trang trí theo section (chủ yếu trang chủ) ---------- */
  var main = document.querySelector('main') || document;
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
