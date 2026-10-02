// "AI assistant instructions" viewer: shows the exact system prompt the server
// sends to the model (api/_prompt.js) so anyone can read and copy it.
import { SYSTEM_PROMPT } from '../../api/_prompt.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isHeading = (line) => line === line.toUpperCase() && /[A-Z]/.test(line);
const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Split the prompt into { title, text } sections at its UPPERCASE headings.
function sections(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (isHeading(line)) out.push({ title: line, lines: [] });
    else if (out.length) out.at(-1).lines.push(raw);
  }
  return out.map((s) => ({ title: s.title, text: s.lines.join('\n').trim() }));
}

function bodyHtml(text) {
  let html = '';
  let list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const m = line.match(/^(-|\d+\.)\s+(.*)/);
    if (m) {
      const kind = m[1] === '-' ? 'ul' : 'ol';
      if (list !== kind) { close(); html += `<${kind}>`; list = kind; }
      html += `<li>${esc(m[2])}</li>`;
      continue;
    }
    close();
    html += `<p>${esc(line)}</p>`;
  }
  close();
  return html;
}

const title = (t) => (t.charAt(0) + t.slice(1).toLowerCase()).replace(/\bnafas\b/gi, 'NAFAS');

function flash(btn, label) {
  const ico = btn.querySelector('.ico');
  const txt = btn.querySelector('.txt');
  btn.classList.add('done');
  ico.innerHTML = DONE_ICON;
  if (txt) txt.textContent = 'Copied';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('done');
    ico.innerHTML = COPY_ICON;
    if (txt) txt.textContent = label;
  }, 1600);
}

let dlg = null;
export function openPromptDoc(onClose) {
  if (!dlg) {
    const secs = sections(SYSTEM_PROMPT);
    const words = SYSTEM_PROMPT.split(/\s+/).length;
    dlg = document.createElement('dialog');
    dlg.className = 'doc-dlg';
    dlg.innerHTML = `
      <div class="doc-head">
        <span class="doc-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 3.5h7.5l4.5 4.5v10.5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M9 12.5h6M9 16h4"/></svg></span>
        <div class="doc-title"><b>AI assistant instructions</b><span>System prompt sent to the model with every question · ${secs.length} sections · ${words} words</span></div>
        <button class="doc-copy" type="button" data-copy="all"><span class="ico">${COPY_ICON}</span><span class="txt">Copy all</span></button>
        <button class="doc-close" type="button" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="doc-main">
        <nav class="doc-toc">${secs.map((s, i) => `<button type="button" data-go="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(title(s.title))}</span></button>`).join('')}</nav>
        <div class="doc-body">${secs.map((s, i) => `
          <section class="doc-sec" data-sec="${i}">
            <header><span class="n">${String(i + 1).padStart(2, '0')}</span><h4>${esc(title(s.title))}</h4>
              <button class="doc-sec-copy" type="button" data-copy="${i}" title="Copy this section"><span class="ico">${COPY_ICON}</span></button></header>
            ${bodyHtml(s.text)}
          </section>`).join('')}</div>
      </div>`;
    document.body.append(dlg);

    const body = dlg.querySelector('.doc-body');
    const toc = [...dlg.querySelectorAll('[data-go]')];
    const secEls = [...dlg.querySelectorAll('.doc-sec')];
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { dlg.close(); return; }
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const all = copy.dataset.copy === 'all';
        const s = secs[+copy.dataset.copy];
        const text = all ? SYSTEM_PROMPT : `${s.title}\n${s.text}`;
        navigator.clipboard?.writeText(text).then(() => flash(copy, 'Copy all')).catch(() => {});
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) body.scrollTo({ top: secEls[+go.dataset.go].offsetTop - 18, behavior: 'smooth' });
    });
    const mark = () => {
      let cur = 0;
      for (const [i, el] of secEls.entries()) if (el.offsetTop - 60 <= body.scrollTop) cur = i;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = secEls.length - 1;
      toc.forEach((b, i) => b.classList.toggle('on', i === cur));
    };
    body.addEventListener('scroll', mark, { passive: true });
    dlg.querySelector('.doc-close').onclick = () => dlg.close();
    dlg._mark = mark;
  }
  dlg.onclose = () => onClose?.();
  dlg.showModal();
  dlg.querySelector('.doc-body').scrollTop = 0;
  dlg._mark();
}
