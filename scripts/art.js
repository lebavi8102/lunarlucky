/**
 * Sinh ảnh minh họa SVG (ảnh tạm) theo tông Sơn mài & Vàng.
 * Chủ shop thay bằng ảnh thật qua trang quản trị.
 */

const PALETTES = {
  lacquer: { bg1: '#6b1420', bg2: '#2a070c', box1: '#b02a3b', box2: '#5a1018', accent: '#d8b878', moon: '#ecd29a', line: '#d8b878' },
  cream: { bg1: '#f8f1e6', bg2: '#e9dcc6', box1: '#a3202f', box2: '#6b1420', accent: '#c9a15a', moon: '#f3dfae', line: '#a9823e' },
  jade: { bg1: '#2f5d50', bg2: '#15302a', box1: '#f5ead6', box2: '#d8c6a4', accent: '#d8b878', moon: '#e6cf9f', line: '#d8b878' },
  ink: { bg1: '#2b2a3a', bg2: '#121119', box1: '#8a1a28', box2: '#4a0c14', accent: '#e6cf9f', moon: '#f3dfae', line: '#c9a15a' },
  sand: { bg1: '#f1e2c4', bg2: '#d9c09a', box1: '#2f5d50', box2: '#1c3a32', accent: '#a9823e', moon: '#fff4dc', line: '#85642b' },
  blush: { bg1: '#f6e4e2', bg2: '#e7c3bf', box1: '#7a1622', box2: '#4a0c14', accent: '#c9a15a', moon: '#fff1ec', line: '#a9823e' },
};

const flowerDefs = (petal = '#f7c948', core = '#e08a1e') => `
  <g id="fl"><g fill="${petal}">${[0, 72, 144, 216, 288].map((r) => `<ellipse cy="-9" rx="6.5" ry="9" transform="rotate(${r})"/>`).join('')}</g><circle r="4.5" fill="${core}"/><circle r="2" fill="#7a1622"/></g>`;

function defs(p, id) {
  return `<defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>
    <linearGradient id="bx${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.box1}"/><stop offset="1" stop-color="${p.box2}"/></linearGradient>
    <linearGradient id="gd${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3dfae"/><stop offset=".5" stop-color="#d8b878"/><stop offset="1" stop-color="#9c7535"/></linearGradient>
    <radialGradient id="mn${id}" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="${p.moon}"/></radialGradient>
    <pattern id="lt${id}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M12 2 22 12 12 22 2 12Z" fill="none" stroke="${p.accent}" stroke-width="1" opacity=".55"/></pattern>
    <pattern id="wv${id}" width="20" height="14" patternUnits="userSpaceOnUse"><path d="M0 7q5-7 10 0t10 0" fill="none" stroke="#7a5428" stroke-width="3"/><path d="M0 14q5-7 10 0t10 0" fill="none" stroke="#a37541" stroke-width="3"/></pattern>
    ${flowerDefs()}
    <g id="pk">${flowerDefs('#f2a7b5', '#c2185b').replace('id="fl"', '')}</g>
  </defs>`;
}

function branch(p, side = 'left', peach = false) {
  const f = peach ? 'pk' : 'fl';
  const t = side === 'left' ? '' : 'transform="translate(800 0) scale(-1 1)"';
  return `<g ${t}><g stroke="#3a2412" stroke-linecap="round" fill="none"><path d="M-10 120C80 150 140 210 210 240s110 30 160 10" stroke-width="8"/><path d="M130 190c20-40 50-60 90-70" stroke-width="5"/><path d="M270 248c20 24 26 56 20 86" stroke-width="4"/></g>
    ${[[220, 120], [190, 150], [270, 250], [290, 330], [360, 250], [120, 180], [60, 130], [330, 230]].map(([x, y]) => `<use href="#${f}" x="${x}" y="${y}"/>`).join('')}</g>`;
}

function bottle(x, y, s = 1, glass = '#24382f') {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M30 0h22v56c0 14 26 30 26 60v190c0 6-4 10-10 10H14c-6 0-10-4-10-10V116c0-30 26-46 26-60Z" fill="${glass}"/><rect x="28" y="-6" width="26" height="16" rx="3" fill="#d8b878"/><rect x="12" y="160" width="58" height="80" rx="3" fill="#f5ead6"/><rect x="17" y="165" width="48" height="70" fill="none" stroke="#a9823e"/><path d="M22 128c-4 30-4 120 0 170" stroke="#fff" stroke-opacity=".14" stroke-width="5" fill="none"/></g>`;
}

function tin(x, y, w, h, c1, c2, accent) {
  return `<g transform="translate(${x} ${y})"><ellipse cx="${w / 2}" cy="${h}" rx="${w / 2}" ry="${w / 8}" fill="${c2}"/><rect x="0" y="0" width="${w}" height="${h}" fill="${c1}"/><ellipse cx="${w / 2}" cy="0" rx="${w / 2}" ry="${w / 8}" fill="${accent}"/><path d="M0 ${h * 0.3}h${w}M0 ${h * 0.7}h${w}" stroke="${accent}" stroke-width="3"/></g>`;
}

function bow(x, y, id, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0C-36-54-108-62-98-18-90 16-36 8 0 0Z" fill="url(#gd${id})"/><path d="M0 0C36-54 108-62 98-18 90 16 36 8 0 0Z" fill="url(#gd${id})"/><path d="M-5 5-34 62l15-3 7 15 17-58ZM5 5l29 57-15-3-7 15-17-58Z" fill="#b8924c"/><ellipse rx="16" ry="14" fill="#d8b878"/></g>`;
}

const compositions = {
  // Hộp sơn mài lớn có nơ + chai rượu
  box(p, id) {
    return `${bottle(520, 420, 1.15)}
      <g transform="translate(130 560)"><path d="M0 40h400v270c0 10-8 18-18 18H18c-10 0-18-8-18-18Z" fill="url(#bx${id})"/><rect y="110" width="400" height="80" fill="url(#lt${id})"/><rect y="106" width="400" height="4" fill="url(#gd${id})"/><rect y="190" width="400" height="4" fill="url(#gd${id})"/><path d="M-12 0h424c6 0 10 4 10 10v38H-22V10C-22 4-18 0-12 0Z" fill="${p.box1}"/><rect x="176" y="0" width="48" height="328" fill="url(#gd${id})"/></g>
      ${bow(330, 560, id)}
      ${tin(60, 760, 110, 120, '#2f5d50', '#1c3a32', '#d8b878')}`;
  },
  // Giỏ mây
  basket(p, id) {
    return `${bottle(300, 360, 1.05)}${bottle(400, 380, 1, '#4a0c14')}
      ${tin(480, 560, 120, 130, p.box1, p.box2, '#d8b878')}
      <g transform="translate(160 600)"><circle cx="40" cy="20" r="40" fill="#e0742a"/><circle cx="110" cy="10" r="44" fill="#ec8a35"/><path d="M110-34c6-14 16-20 26-20" stroke="#3a2412" stroke-width="4" fill="none"/><ellipse cx="130" cy="-40" rx="14" ry="7" fill="#4c7a3a"/></g>
      <g transform="translate(110 640)"><path d="M0 0h580l-50 270c-2 10-10 16-20 16H70c-10 0-18-6-20-16Z" fill="url(#wv${id})"/><path d="M0 0h580l-50 270c-2 10-10 16-20 16H70c-10 0-18-6-20-16Z" fill="none" stroke="#5c3d1c" stroke-width="4"/><rect x="-14" y="-16" width="608" height="32" rx="16" fill="#8a5f2e"/><rect x="250" y="-16" width="80" height="300" fill="${p.box1}" opacity=".92"/></g>
      ${bow(400, 630, id, 0.9)}`;
  },
  // Ba hộp chồng
  stack(p, id) {
    return `<g transform="translate(170 700)"><rect width="460" height="200" rx="6" fill="url(#bx${id})"/><rect y="70" width="460" height="60" fill="url(#lt${id})"/><rect x="206" width="48" height="200" fill="url(#gd${id})"/></g>
      <g transform="translate(230 520)"><rect width="340" height="180" rx="6" fill="#f5ead6"/><rect x="146" width="48" height="180" fill="${p.box1}"/><rect y="80" width="340" height="20" fill="${p.box1}" opacity=".85"/></g>
      <g transform="translate(290 380)"><rect width="220" height="140" rx="6" fill="#2f5d50"/><circle cx="110" cy="70" r="36" fill="none" stroke="#d8b878" stroke-width="3"/><circle cx="110" cy="70" r="26" fill="none" stroke="#d8b878" stroke-width="1"/></g>
      ${bow(400, 380, id, 0.8)}`;
  },
  // Hộp tròn bánh/trà
  round(p, id) {
    return `<g transform="translate(400 760)"><ellipse rx="250" ry="70" fill="${p.box2}"/><path d="M-250 0v-200c0-38 500-38 500 0V0" fill="url(#bx${id})"/><ellipse cy="-200" rx="250" ry="64" fill="${p.box1}"/><ellipse cy="-200" rx="210" ry="50" fill="none" stroke="#d8b878" stroke-width="3"/><path d="M-250-110h500" stroke="#d8b878" stroke-width="5"/><path d="M-250-90h500" stroke="#d8b878" stroke-width="1.5"/></g>
      <g transform="translate(400 560)"><use href="#fl" x="-40" y="0" transform="scale(1.6)"/><use href="#fl" x="10" y="-10" transform="scale(1.6)"/><use href="#fl" x="-12" y="18" transform="scale(1.6)"/></g>
      ${tin(600, 600, 90, 110, '#f5ead6', '#d8c6a4', p.box1)}`;
  },
};

/** Ảnh sản phẩm 800×1000 */
function productArt({ palette = 'cream', composition = 'box', peach = false, id = 'p' }) {
  const p = PALETTES[palette];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">${defs(p, id)}
    <rect width="800" height="1000" fill="url(#bg${id})"/>
    <path d="M140 960V420a260 260 0 0 1 520 0v540" fill="none" stroke="${p.line}" stroke-opacity=".35" stroke-width="2"/>
    <circle cx="560" cy="250" r="120" fill="url(#mn${id})" opacity=".9"/>
    ${branch(p, composition === 'basket' ? 'right' : 'left', peach)}
    <ellipse cx="400" cy="925" rx="320" ry="30" fill="#000" opacity=".18"/>
    ${compositions[composition](p, id)}
  </svg>`;
}

/** Ảnh danh mục 600×800 (cắt vòm ở CSS) */
function categoryArt(opts) {
  return productArt(opts).replace('viewBox="0 0 800 1000"', 'viewBox="40 60 720 960"');
}

/** Ảnh hộp quà cho trình tạo giỏ, 600×600 */
function boxArt({ kind, palette = 'cream', id = 'b' }) {
  const p = PALETTES[palette];
  let body = '';
  if (kind === 'lacquer') {
    body = `<g transform="translate(110 200)"><rect y="40" width="380" height="250" rx="8" fill="url(#bx${id})"/><rect y="110" width="380" height="70" fill="url(#lt${id})"/><rect x="-14" width="408" height="56" rx="8" fill="${p.box1}"/><rect x="166" width="48" height="290" fill="url(#gd${id})"/></g>${bow(300, 200, id, 0.8)}`;
  } else if (kind === 'rattan') {
    body = `<g transform="translate(90 230)"><path d="M0 0h420l-40 250c-2 8-8 14-16 14H56c-8 0-14-6-16-14Z" fill="url(#wv${id})" stroke="#5c3d1c" stroke-width="4"/><rect x="-12" y="-16" width="444" height="30" rx="15" fill="#8a5f2e"/><path d="M40-10C40-150 380-150 380-10" fill="none" stroke="#8a5f2e" stroke-width="16"/></g>`;
  } else {
    body = `<g transform="translate(120 190)"><rect y="40" width="360" height="270" rx="4" fill="#8a5f2e"/><rect y="40" width="360" height="270" rx="4" fill="none" stroke="#5c3d1c" stroke-width="4"/><path d="M0 120h360M0 200h360" stroke="#6e4a22" stroke-width="2"/><rect x="-10" width="380" height="56" rx="4" fill="#a3713a"/><circle cx="180" cy="160" r="46" fill="none" stroke="#f3dfae" stroke-width="3"/><use href="#fl" x="180" y="160" transform="scale(1)"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">${defs(p, id)}<rect width="600" height="600" fill="url(#bg${id})"/><circle cx="460" cy="130" r="80" fill="url(#mn${id})" opacity=".8"/><ellipse cx="300" cy="520" rx="230" ry="22" fill="#000" opacity=".15"/>${body}</svg>`;
}

/** Ảnh món quà nhỏ 400×400 */
function itemArt({ kind, color = '#7a1622', id = 'i' }) {
  const p = PALETTES.cream;
  const shapes = {
    tea: `<g transform="translate(130 90)"><rect y="30" width="140" height="210" rx="6" fill="#2f5d50"/><rect x="-6" width="152" height="40" rx="6" fill="${color}"/><circle cx="70" cy="140" r="34" fill="none" stroke="#d8b878" stroke-width="3"/><path d="M50 140c10-20 30-20 40 0-10 20-30 20-40 0Z" fill="#d8b878"/></g>`,
    wine: bottle(150, 40, 1.05, color),
    tin: `<g transform="translate(200 230)"><ellipse rx="130" ry="36" fill="#4a0c14"/><path d="M-130 0v-90c0-20 260-20 260 0V0" fill="${color}"/><ellipse cy="-90" rx="130" ry="32" fill="#d8b878"/><ellipse cy="-90" rx="100" ry="22" fill="none" stroke="#9c7535" stroke-width="2"/><path d="M-130-45h260" stroke="#d8b878" stroke-width="4"/></g>`,
    jar: `<g transform="translate(200 110)"><rect x="-50" width="100" height="34" rx="6" fill="${color}"/><path d="M-80 40h160c10 0 20 10 20 30v170c0 20-10 30-30 30H-90c-20 0-30-10-30-30V70c0-20 10-30 40-30Z" fill="#f5ead6" opacity=".9" stroke="#c9a15a" stroke-width="2"/><g fill="#c48a4a">${[[-60, 120], [-20, 110], [20, 125], [60, 115], [-40, 160], [0, 150], [40, 165], [-60, 200], [-10, 195], [40, 205], [70, 180]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="18" ry="12"/>`).join('')}</g><rect x="-70" y="90" width="140" height="44" fill="${color}" opacity=".9"/><text y="118" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="#f3dfae">LUNAR</text></g>`,
    bag: `<g transform="translate(200 80)"><path d="M-90 30h180l20 240c0 14-10 20-20 20H-110c-10 0-20-6-20-20Z" fill="${color}"/><path d="M-90 30c0-30 30-30 30 0M60 30c0-30 30-30 30 0" stroke="#d8b878" stroke-width="5" fill="none"/><rect x="-60" y="120" width="120" height="80" rx="4" fill="#f5ead6"/><use href="#fl" x="0" y="160"/></g>`,
    tray: `<g transform="translate(200 200)">${[0, 60, 120, 180, 240, 300].map((r, k) => `<path d="M0 0L${Math.cos((r * Math.PI) / 180) * 140} ${Math.sin((r * Math.PI) / 180) * 140}A140 140 0 0 1 ${Math.cos(((r + 60) * Math.PI) / 180) * 140} ${Math.sin(((r + 60) * Math.PI) / 180) * 140}Z" fill="${['#e0742a', '#f2c14e', '#b8d47a', '#e85a71', '#f5ead6', '#9c5a2e'][k]}" stroke="${color}" stroke-width="6"/>`).join('')}<circle r="40" fill="${color}"/><circle r="140" fill="none" stroke="${color}" stroke-width="10"/></g>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${defs(p, id)}<rect width="400" height="400" fill="#f8f1e6"/><circle cx="200" cy="200" r="170" fill="#efe4d2"/><ellipse cx="200" cy="350" rx="140" ry="14" fill="#000" opacity=".1"/>${shapes[kind]}</svg>`;
}

/** Ảnh bìa blog 1200×800 */
function coverArt({ palette = 'lacquer', composition = 'box', id = 'c' }) {
  const inner = productArt({ palette, composition, id })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  const p = PALETTES[palette];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${p.bg2}"/><g transform="translate(200 -100) scale(1)">${inner}</g></svg>`;
}

module.exports = { productArt, categoryArt, boxArt, itemArt, coverArt, PALETTES };
