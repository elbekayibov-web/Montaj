// "AI assistant instructions" viewer: shows the exact system prompt the server
// sends to the model (api/_prompt.js) so anyone can read and copy it.
import { SYSTEM_PROMPT } from '../../api/_prompt.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = esc;

function toHtml(text) {
  let html = '';
  let list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const bullet = line.match(/^-\s+(.*)/);
    const num = line.match(/^\d+\.\s+(.*)/);
    if (bullet || num) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { close(); html += `<${kind}>`; list = kind; }
      html += `<li>${inline((bullet || num)[1])}</li>`;
      continue;
    }
    close();
    if (line === line.toUpperCase() && /[A-Z]/.test(line)) html += `<h4>${esc(line)}</h4>`;
    else html += `<p>${inline(line)}</p>`;
  }
  close();
  return html;
}

let dlg = null;
export function openPromptDoc() {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'doc-dlg';
    dlg.innerHTML = `
      <div class="doc-head">
        <span class="ai-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6.8 12.6c1.7-2.6 3.5-2.6 5.2 0s3.5 2.6 5.2 0"/></svg></span>
        <div class="doc-title"><b>AI assistant instructions</b><span>The system prompt sent to the model with every question</span></div>
        <button class="doc-copy" type="button"><svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg><span>Copy</span></button>
        <button class="doc-close" type="button" title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="doc-body">${toHtml(SYSTEM_PROMPT)}</div>`;
    document.body.append(dlg);
    const copy = dlg.querySelector('.doc-copy');
    copy.onclick = () => {
      navigator.clipboard?.writeText(SYSTEM_PROMPT).then(() => {
        copy.classList.add('done');
        copy.querySelector('span').textContent = 'Copied';
        setTimeout(() => { copy.classList.remove('done'); copy.querySelector('span').textContent = 'Copy'; }, 1500);
      }).catch(() => {});
    };
    dlg.querySelector('.doc-close').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  dlg.showModal();
  dlg.querySelector('.doc-body').scrollTop = 0;
}
