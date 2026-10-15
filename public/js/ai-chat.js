/* AI tư vấn chọn quà — khung chat (gọi /tu-van/chat). Lịch sử trò chuyện nằm ở máy chủ (session). */
(() => {
  const box = document.querySelector('[data-ai-chat]');
  if (!box) return;
  const fab = document.querySelector('[data-ai-open]');
  const log = box.querySelector('[data-ai-log]');
  const form = box.querySelector('[data-ai-form]');
  const input = box.querySelector('[data-ai-input]');
  const chips = box.querySelector('[data-ai-chips]');
  const csrf = box.dataset.csrf || '';
  const KEY = 'll_ai_log';
  let busy = false;

  const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Chữ AI → HTML an toàn: **đậm**, xuống dòng, link nội bộ /san-pham/...
  const fmt = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)(\/(?:san-pham|bo-suu-tap|qua-tang-doanh-nghiep)[\w\-/?=&.]*)/g, '$1<a href="$2">$2</a>')
    .replace(/\n/g, '<br>');

  function add(role, text, action) {
    const d = document.createElement('div');
    d.className = `ai-msg ${role}`;
    d.innerHTML = role === 'bot' ? fmt(text) : esc(text);
    if (action && /^\/[\w\-/?=&]*$/.test(action.url)) {
      const a = document.createElement('a');
      a.className = 'btn btn-sm ai-action';
      a.href = action.url;
      a.textContent = action.label;
      d.append(document.createElement('br'), a);
    }
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  // Giữ lại phần hiển thị khi khách chuyển trang (nội dung thật ở máy chủ)
  const save = () => { try { sessionStorage.setItem(KEY, log.innerHTML); } catch { /* bỏ qua */ } };
  try { const h = sessionStorage.getItem(KEY); if (h) { log.innerHTML = h; chips.hidden = true; } } catch { /* bỏ qua */ }

  const open = () => {
    box.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('ai-open');
    setTimeout(() => input.focus(), 50);
    log.scrollTop = log.scrollHeight;
  };
  const close = () => {
    box.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('ai-open');
    fab.focus();
  };
  fab.addEventListener('click', () => (box.hidden ? open() : close()));
  box.querySelector('[data-ai-close]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) close(); });

  box.querySelector('[data-ai-reset]').addEventListener('click', async () => {
    await fetch('/tu-van/moi', { method: 'POST', headers: { 'x-csrf-token': csrf } }).catch(() => {});
    log.innerHTML = '';
    add('bot', 'Mình bắt đầu lại nhé! Anh/chị định tặng quà cho ai, ngân sách khoảng bao nhiêu ạ?');
    chips.hidden = false;
    save();
  });

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    chips.hidden = true;
    add('me', text);
    input.value = '';
    input.style.height = '';
    const typing = add('bot typing', 'Đang trả lời…');
    try {
      const r = await fetch('/tu-van/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, accept: 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await r.json().catch(() => ({}));
      typing.remove();
      add('bot', data.reply || 'Em chưa nhận được câu hỏi, anh/chị gửi lại giúp em nhé.', data.action);
    } catch {
      typing.remove();
      add('bot', 'Mạng đang chập chờn, anh/chị gửi lại giúp em nhé.');
    } finally {
      busy = false;
      save();
      input.focus();
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-ai-suggest]'); if (b) send(b.textContent); });
  // Link "?tu-van=1" trên trang khác (vd nút trong trang) mở khung chat
  if (/[?&]tu-van-mo=1/.test(location.search)) open();
})();
