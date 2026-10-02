// AI assistant panel: chats through the site's /api/chat function, which holds
// the API key and the assistant's instructions on the server, so every visitor
// can use it without a key of their own. Every request is sent with fresh context: the sketch, wiring, compiler output, serial log
// and sensor readings, so questions like "why is the buzzer silent?" can be
// answered about the actual state of the lab.

const store = {
  get(k, d) { try { const v = localStorage.getItem(`nafas2:ai:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`nafas2:ai:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const QUICK = [
  'Explain this sketch line by line',
  'Why does it not compile?',
  'Why is the buzzer silent?',
  'How does the NAFAS device work?',
];

// Small, safe markdown: code fences, inline code, bold, lists, paragraphs.
function md(src) {
  const parts = String(src).split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  let html = '';
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose) {
      const blocks = prose.trim().split(/\n{2,}/);
      for (const b of blocks) {
        if (!b.trim()) continue;
        const lines = b.split('\n');
        const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          html += `<${ordered ? 'ol' : 'ul'}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
        } else if (/^#{1,4}\s/.test(lines[0])) {
          html += `<h4>${inline(lines[0].replace(/^#+\s/, ''))}</h4>${lines.length > 1 ? `<p>${lines.slice(1).map(inline).join('<br>')}</p>` : ''}`;
        } else html += `<p>${lines.map(inline).join('<br>')}</p>`;
      }
    }
    if (i + 2 < parts.length) {
      const code = parts[i + 2];
      html += `<div class="ai-code"><div class="ai-code-bar"><span>${esc(parts[i + 1] || 'code')}</span><button class="ai-copy">Copy</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`;
    }
  }
  return html;
}

export function createAssistant(root, { getContext }) {
  root.innerHTML = `
    <div class="ai-head">
      <div class="ai-title">
        <span class="ai-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6.8 12.6c1.7-2.6 3.5-2.6 5.2 0s3.5 2.6 5.2 0"/></svg></span>
        <div><b>Assistant</b><span class="ai-model"></span></div>
      </div>
      <div class="ai-actions">
        <button class="ai-btn" data-act="clear" title="New chat">New chat</button>
      </div>
    </div>
    <div class="ai-body">
      <div class="ai-chat">
        <div class="ai-msgs" aria-live="polite"></div>
        <form class="ai-composer">
          <textarea rows="1" placeholder="Ask about your code or the device…" id="aiInput"></textarea>
          <button type="submit" class="ai-send" title="Send (Enter)"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
        </form>
      </div>
      <aside class="ai-side">
        <div class="ai-context">
          <div class="ai-side-title">Sent with every question</div>
          <label class="ai-ctx"><input type="checkbox" id="aiCtx" checked /> <span>Lab context</span></label>
          <ul class="ai-ctx-list"></ul>
        </div>
      </aside>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const msgsEl = $('.ai-msgs');
  const input = $('#aiInput');
  let history = store.get('history', []);
  // Personal keys are no longer used; forget any saved by older versions.
  try { for (const k of ['key', 'model', 'base']) localStorage.removeItem(`nafas2:ai:${k}`); } catch { /* private mode */ }
  let controller = null;

  function showModel() {
    fetch('/api/chat').then((r) => (r.ok ? r.json() : null)).then((info) => {
      $('.ai-model').textContent = info?.ready ? `${info.provider} · ${info.model}` : 'AI is not configured on the server yet';
      root.classList.toggle('no-key', !info?.ready);
    }).catch(() => {
      $('.ai-model').textContent = 'Server not reachable';
      root.classList.add('no-key');
    });
  }

  function renderContextList() {
    const c = getContext();
    $('.ai-ctx-list').innerHTML = [
      `${c.fileName} · ${c.code.split('\n').length} lines`,
      `${c.board} wiring`,
      c.output.trim() ? 'Compiler output' : null,
      c.serial.trim() ? `Serial Monitor · last ${Math.min(30, c.serial.trim().split('\n').length)} lines` : null,
      'Sensor readings and room state',
    ].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('');
  }

  function render() {
    if (!history.length) {
      msgsEl.innerHTML = `<div class="ai-empty"><b>Ask anything about the lab.</b><span>The assistant sees your sketch, the wiring, compiler errors and the Serial Monitor.</span><div class="ai-quick">${QUICK.map((q) => `<button type="button">${esc(q)}</button>`).join('')}</div></div>`;
      for (const b of msgsEl.querySelectorAll('.ai-quick button')) b.onclick = () => ask(b.textContent);
      return;
    }
    msgsEl.innerHTML = history.map((m) => `<div class="ai-msg is-${m.role}${m.error ? ' error' : ''}">${m.role === 'user' ? `<p>${esc(m.content)}</p>` : md(m.content) || '<span class="ai-typing"><i></i><i></i><i></i></span>'}</div>`).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  msgsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.ai-copy');
    if (!b) return;
    const code = b.closest('.ai-code').querySelector('code').textContent;
    navigator.clipboard?.writeText(code).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); }).catch(() => {});
  });

  function contextMessage() {
    const c = getContext();
    const numbered = c.code.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
    return [
      `Board: ${c.board}. Sketch file: ${c.fileName}. Simulation ${c.running ? 'running' : 'stopped'}.`,
      `Wiring:\n${c.wiring}`,
      `Sketch (with line numbers):\n${numbered}`,
      c.output.trim() ? `Last compiler / upload output:\n${c.output.trim().slice(-2500)}` : 'No compiler output yet.',
      c.serial.trim() ? `Serial Monitor (last lines):\n${c.serial.trim().split('\n').slice(-30).join('\n')}` : 'Serial Monitor is empty.',
      `Room and sensors: ${c.state}`,
    ].join('\n\n');
  }

  async function ask(question) {
    question = question.trim();
    if (!question || controller) return;
    history.push({ role: 'user', content: question });
    const reply = { role: 'assistant', content: '' };
    history.push(reply);
    render();
    root.classList.add('busy');
    controller = new AbortController();
    const messages = history.slice(0, -1).filter((m) => !m.error).slice(-16).map((m) => ({ role: m.role, content: m.content }));
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, context: $('#aiCtx').checked ? contextMessage() : '' }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error?.message || ''; } catch { /* not json */ }
        throw new Error(res.status === 429 ? 'Too many questions at once — wait a minute and try again.' : `API error ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) { reply.content += delta; render(); }
          } catch { /* partial line */ }
        }
      }
      if (!reply.content) reply.content = '(empty answer)';
    } catch (err) {
      if (err.name === 'AbortError') reply.content += reply.content ? '\n\n_(stopped)_' : '(stopped)';
      else {
        reply.error = true;
        reply.content = err instanceof TypeError
          ? 'Could not reach the server. Check your internet connection.'
          : err.message;
      }
    } finally {
      controller = null;
      root.classList.remove('busy');
      history = history.slice(-40);
      store.set('history', history);
      render();
    }
  }

  $('.ai-composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) { controller.abort(); return; }
    const q = input.value;
    input.value = '';
    input.style.height = '';
    ask(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.ai-composer').requestSubmit(); }
  });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });
  root.querySelector('[data-act="clear"]').onclick = () => { controller?.abort(); history = []; store.set('history', history); render(); };

  showModel();
  render();
  renderContextList();
  setInterval(renderContextList, 3000);

  return {
    ask(q) { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); ask(q); },
  };
}
