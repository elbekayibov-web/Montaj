import { createHero } from './three/hero.js';
import { createRoom } from './three/room.js';
import { World } from './sim/world.js';
import { BOARDS, WIRING_INFO, pinLabel } from './sim/boards.js';
import { compile } from './sim/compiler.js';
import { Runtime, mqVoltage } from './sim/runtime.js';
import { EXAMPLES, exampleCode } from './sim/examples.js';
import { createEditor } from './ui/editor.js';
import { Buzzer } from './ui/audio.js';
import { createSparkline } from './ui/sparkline.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(`nafas:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`nafas:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------------------------------------------------------------- hero
const heroSection = $('.hero');
const hero = createHero($('#heroCanvas'), $('#heroLabels'));
function onScroll() {
  const r = heroSection.getBoundingClientRect();
  const total = heroSection.offsetHeight - window.innerHeight;
  const p = Math.max(0, Math.min(1, -r.top / Math.max(1, total)));
  // assembled → exploded during the first 60% of the hero, then hold
  hero.setProgress(Math.min(1, Math.max(0, (p - 0.08) / 0.5)));
  $('.scroll-cue').style.opacity = p > 0.05 ? '0' : '1';
  $('.drag-hint').style.opacity = p > 0.05 ? '0' : '1';
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------------------------------------------------------------- world + room
const world = new World();
const room = createRoom($('#roomCanvas'), $('#roomOverlay'));
$('#focusDevice').onclick = () => room.focusDevice();
$('#resetView').onclick = () => room.resetView();

const buzzer = new Buzzer();
let muted = store.get('muted', false);
buzzer.setMuted(muted);
$('#soundToggle').classList.toggle('muted', muted);
$('#soundToggle').onclick = () => {
  muted = !muted;
  buzzer.unlock();
  buzzer.setMuted(muted);
  store.set('muted', muted);
  $('#soundToggle').classList.toggle('muted', muted);
};
document.addEventListener('pointerdown', () => buzzer.unlock(), { once: true });

for (const b of $$('.eq[data-eq]')) {
  b.onclick = () => {
    const k = b.dataset.eq;
    world.set(k, !world[k]);
    b.classList.toggle('on', world[k]);
  };
}
$('#resetWorld').onclick = () => {
  world.reset();
  $$('.eq[data-eq]').forEach((b) => b.classList.remove('on'));
};

// ---------------------------------------------------------------- board + pins
let board = BOARDS[store.get('board', 'uno')] || BOARDS.uno;
const pinState = new Map();
let running = false;

function pinOut(key) {
  const st = pinState.get(board.wiring[key]);
  return st || { mode: 0, value: 0, pwm: 0, tone: 0 };
}
function buzzerLevel() {
  const st = pinOut('buzzer');
  if (st.tone) return { freq: st.tone, level: 1 };
  if (st.pwm) return { freq: 490, level: st.pwm / 255 };
  if (st.value && st.mode === 1) return { freq: 2700, level: 1 };
  return { freq: 0, level: 0 };
}
function ledLevel() {
  const st = pinOut('led');
  if (st.pwm) return st.pwm / 255;
  if (!st.value) return 0;
  return st.mode === 1 ? 1 : 0.12; // no pinMode -> dim via pull-up
}

// ---------------------------------------------------------------- sensors panel
const sparks = {
  temperature: createSparkline($('[data-m="temperature"] .spark'), { color: '#e8475f', format: (v) => `${v.toFixed(1)}°C` }),
  propane: createSparkline($('[data-m="propane"] .spark'), { color: '#7c5cf5', format: (v) => `${Math.round(v)} ppm` }),
  methane: createSparkline($('[data-m="methane"] .spark'), { color: '#f07a1a', format: (v) => `${Math.round(v)} ppm` }),
};
function adcFor(key) {
  const max = 2 ** board.adcBits - 1;
  if (key === 'propane') return Math.round((mqVoltage(world.propane + 0.12 * world.methane, 2600) / 5) * max);
  return Math.round((mqVoltage(world.methane + 0.1 * world.propane, 3400) / 5) * max);
}
function badge(el, level, text) {
  el.className = `m-badge${level === 2 ? ' bad' : level === 1 ? ' warn' : ''}`;
  el.textContent = text;
  el.closest('.metric').classList.toggle('over', level === 2);
}
function renderSensors() {
  const T = $('[data-m="temperature"]');
  $('[data-v]', T).textContent = world.temperature.toFixed(1);
  $('[data-sub]', T).textContent = `namlik ${Math.round(world.humidity)}%`;
  const tl = world.temperature > 45 ? 2 : world.temperature > 32 ? 1 : 0;
  badge($('[data-badge]', T), tl, ['me’yorda', 'issiq', 'juda issiq'][tl]);
  for (const k of ['propane', 'methane']) {
    const el = $(`[data-m="${k}"]`);
    $('[data-v]', el).textContent = Math.round(world[k]);
    $('[data-sub]', el).textContent = `ADC ${adcFor(k)}`;
    const v = world[k];
    const lvl = v > 700 ? 2 : v > 150 ? 1 : 0;
    badge($('[data-badge]', el), lvl, ['toza havo', 'sezilarli', 'xavfli'][lvl]);
  }
}
function renderWiring() {
  $('#wiringBoard').textContent = board.name;
  $('#wiringList').innerHTML = WIRING_INFO.map((w) => `<li><b>${w.part}</b><span>${w.role}</span><code>${pinLabel(board, board.wiring[w.key])}</code></li>`).join('');
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let uiAcc = 0;
let sparkAcc = 0;
let lastAlarm = false;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = (now - last) / 1000;
  last = now;
  world.step(dt);
  const bz = buzzerLevel();
  const led = ledLevel();
  const alarm = bz.freq > 0;
  buzzer.set(running ? bz.freq : 0, bz.level);
  room.update({
    temperature: world.temperature, propane: world.propane, methane: world.methane, heater: world.heater,
    heaterPower: world.heaterPower, propaneLeak: world.propaneLeak, methaneLeak: world.methaneLeak, window: world.window,
    buzzer: alarm ? 1 : 0, led, running, alarm,
  });
  if (alarm !== lastAlarm) {
    lastAlarm = alarm;
    $('#alarmBanner').classList.toggle('show', alarm);
    $('#ioBuzzer').classList.toggle('on', alarm);
    updateRunState();
  }
  $('#ioLed').classList.toggle('on', led > 0.3);
  uiAcc += dt;
  if (uiAcc > 0.2) { uiAcc = 0; renderSensors(); }
  sparkAcc += dt;
  if (sparkAcc > 0.5) {
    sparkAcc = 0;
    const h = world.history.slice(-120);
    for (const k of Object.keys(sparks)) sparks[k].set(h.map((s) => s[k]));
  }
}
requestAnimationFrame(loop);

function updateRunState() {
  const el = $('#runState');
  el.classList.toggle('on', running);
  el.classList.toggle('alarm', running && lastAlarm);
  $('.txt', el).textContent = !running
    ? 'Qurilma o‘chiq — kodni yuklang'
    : lastAlarm ? 'Signal chalinmoqda!' : `${board.name} ishlamoqda`;
}

// ---------------------------------------------------------------- IDE
const output = $('#output');
const serialOut = $('#serialOut');
const toast = $('#ideToast');
let currentExample = store.get('example', 'gaz');
let fileName = store.get('file', EXAMPLES[0].file);
let savedCode = store.get('code', null);
let dirtyFromExample = store.get('dirty', false);
let loadingCode = false;
function loadCode(code) {
  loadingCode = true;
  editor.value = code;
  loadingCode = false;
}

const editor = createEditor($('#editor'), {
  doc: savedCode ?? exampleCode(EXAMPLES.find((e) => e.id === currentExample) || EXAMPLES[0], board),
  onChange(v) {
    store.set('code', v);
    if (loadingCode) return;
    dirtyFromExample = true;
    store.set('dirty', true);
    $('#dirtyDot').classList.add('dirty');
    editor.clearProblems();
  },
  onCursor(l, c) { $('#statusPos').textContent = `Ln ${l}, Col ${c}`; },
  keys: [
    { key: 'Mod-r', preventDefault: true, run: () => { verify(); return true; } },
    { key: 'Mod-u', preventDefault: true, run: () => { upload(); return true; } },
    { key: 'Mod-s', preventDefault: true, run: () => { $('#dirtyDot').classList.remove('dirty'); return true; } },
  ],
});
$('#fileName').textContent = fileName;
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); verify(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); upload(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); showTab('serial'); }
});

// board select
const boardSelect = $('#boardSelect');
boardSelect.innerHTML = Object.values(BOARDS).map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
boardSelect.value = board.id;
function applyBoard() {
  $('#statusBoard').textContent = `${board.name} on ${board.port}`;
  $('#serialInput').placeholder = `Message (Enter to send message to '${board.name}' on '${board.port}')`;
  renderWiring();
}
boardSelect.onchange = () => {
  const prevBoard = board;
  board = BOARDS[boardSelect.value];
  store.set('board', board.id);
  if (running) stopDevice('Plata almashtirildi — kodni qayta yuklang.');
  // Untouched example -> switch its pin numbers to the new board's wiring.
  const ex = EXAMPLES.find((e) => e.id === currentExample);
  if (ex && editor.value === exampleCode(ex, prevBoard)) {
    loadCode(exampleCode(ex, board));
    dirtyFromExample = false;
    store.set('dirty', false);
    $('#dirtyDot').classList.remove('dirty');
  }
  applyBoard();
};
applyBoard();

// examples
const menu = $('#examplesMenu');
menu.innerHTML = EXAMPLES.map((e) => `<button data-ex="${e.id}"><b>${e.title}</b><small>${e.note}</small></button>`).join('');
$('#btnExamples').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
menu.addEventListener('click', (e) => e.stopPropagation());
function resetMenuConfirm() {
  for (const x of $$('button.confirm', menu)) { x.classList.remove('confirm'); $('small', x).textContent = $('small', x).dataset.note; }
}
document.addEventListener('click', () => { menu.classList.remove('open'); resetMenuConfirm(); });
for (const b of $$('button', menu)) {
  b.onclick = () => {
    const ex = EXAMPLES.find((x) => x.id === b.dataset.ex);
    // Two-step confirm inside the menu instead of window.confirm().
    if (dirtyFromExample && !b.classList.contains('confirm')) {
      $$('button', menu).forEach((x) => x.classList.remove('confirm'));
      b.classList.add('confirm');
      $('small', b).dataset.note = $('small', b).textContent;
      $('small', b).textContent = 'Kodingiz o‘zgargan. Almashtirish uchun yana bosing.';
      return;
    }
    b.classList.remove('confirm');
    currentExample = ex.id;
    fileName = ex.file;
    loadCode(exampleCode(ex, board));
    dirtyFromExample = false;
    store.set('example', ex.id);
    store.set('file', ex.file);
    store.set('dirty', false);
    $('#fileName').textContent = fileName;
    $('#dirtyDot').classList.remove('dirty');
    editor.clearProblems();
    menu.classList.remove('open');
  };
}

// console tabs
function showTab(name) {
  $$('.ctab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#paneOutput').classList.toggle('active', name === 'output');
  $('#paneSerial').classList.toggle('active', name === 'serial');
  $(`.ctab[data-tab="${name}"]`).classList.remove('pending');
}
$$('.ctab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
$('#btnSerialFocus').onclick = () => { showTab('serial'); $('#serialInput').focus(); };
$('.ctab[data-tab="output"]').insertAdjacentHTML('beforeend', '<i class="new-dot"></i>');
function activeTab() { return $('.ctab.active').dataset.tab; }
function flagTab(name) { if (activeTab() !== name) $(`.ctab[data-tab="${name}"]`).classList.add('pending'); }

// output helpers
function out(html) {
  output.insertAdjacentHTML('beforeend', html);
  output.scrollTop = output.scrollHeight;
}
function clearOutput() { output.innerHTML = ''; }

function showToast(text, pct, done) {
  $('.toast-txt', toast).textContent = text;
  $('.toast-bar i', toast).style.width = `${pct}%`;
  toast.classList.toggle('done', !!done);
  toast.classList.add('show');
  clearTimeout(showToast.t);
  if (done) showToast.t = setTimeout(() => toast.classList.remove('show'), 2600);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sourceExcerpt(line, col) {
  const src = editor.value.split('\n')[line - 1];
  if (src == null) return '';
  const n = String(line).padStart(5);
  const pad = ' '.repeat(5);
  const caret = `${' '.repeat(Math.max(0, col - 1))}^`;
  return `<span class="dim">${n} | </span>${esc(src)}\n<span class="dim">${pad} | </span><span class="err">${caret}</span>\n`;
}

function formatProblem(p, sev) {
  const loc = p.line ? `${fileName}:${p.line}:${p.col || 1}` : fileName.replace(/\.ino$/, '.ino.cpp.o');
  const cls = sev === 'error' ? 'err' : 'warn';
  let s = `<span class="errloc" data-line="${p.line}" data-col="${p.col || 1}">${loc}</span>: <span class="${cls}">${sev}: ${esc(p.message ?? p.msg)}</span>\n`;
  if (p.line) s += sourceExcerpt(p.line, p.col || 1);
  if (p.hint) s += `<span class="hint">💡 ${esc(p.hint)}</span>`;
  return s;
}
output.addEventListener('click', (e) => {
  const l = e.target.closest('.errloc');
  if (l && +l.dataset.line) editor.goto(+l.dataset.line, +l.dataset.col);
});

let busy = false;
function setBusy(b, which) {
  busy = b;
  $('#btnVerify').disabled = b;
  $('#btnUpload').disabled = b;
  $('#btnVerify').classList.toggle('busy', b && which === 'verify');
  $('#btnUpload').classList.toggle('busy', b && which === 'upload');
}

async function build(which) {
  clearOutput();
  showTab('output');
  editor.clearProblems();
  showToast('Compiling sketch...', 10);
  out(`<span class="dim">FQBN: ${board.fqbn}\nCompiling sketch...</span>\n`);
  await wait(250);
  showToast('Compiling sketch...', 55);
  await wait(250);
  let result;
  try {
    result = compile(editor.value, board);
    result.factory = new Function('__rt', '__c', result.js);
  } catch (e) {
    if (e.line === undefined) {
      out(`<span class="err">Ichki xato: ${esc(String(e.message))}</span>\n`);
      console.error(e);
    } else {
      out(formatProblem(e, 'error'));
      editor.showProblems([{ line: e.line, col: e.col, message: e.message, hint: e.hint, severity: 'error' }]);
    }
    out(`\n<span class="err">exit status 1</span>\n\n<span class="err">Compilation error: ${esc(e.message)}</span>\n`);
    showToast('Compilation error.', 100, true);
    return null;
  }
  for (const w of result.warnings) out(formatProblem(w, 'warning'));
  if (result.warnings.length) {
    editor.showProblems(result.warnings.map((w) => ({ line: w.line, col: w.col, message: w.msg, hint: w.hint, severity: 'warning' })));
  }
  const s = result.stats;
  const pct = (a, b) => Math.round((a / b) * 100);
  out(`Sketch uses ${s.flash.toLocaleString('en-US')} bytes (${pct(s.flash, s.flashMax)}%) of program storage space. Maximum is ${s.flashMax.toLocaleString('en-US')} bytes.\n`);
  out(`Global variables use ${s.ram.toLocaleString('en-US')} bytes (${pct(s.ram, s.ramMax)}%) of dynamic memory, leaving ${(s.ramMax - s.ram).toLocaleString('en-US')} bytes for local variables. Maximum is ${s.ramMax.toLocaleString('en-US')} bytes.\n`);
  if (which === 'verify') showToast('Done compiling.', 100, true);
  return result;
}

async function verify() {
  if (busy) return;
  setBusy(true, 'verify');
  try { await build('verify'); } finally { setBusy(false); }
}

async function upload() {
  if (busy) return;
  buzzer.unlock();
  setBusy(true, 'upload');
  try {
    const result = await build('upload');
    if (!result) return;
    showToast('Uploading...', 60);
    if (board.arch === 'esp32') {
      out(`<span class="dim">esptool.py v4.6 — Serial port ${board.port}\nConnecting....\nChip is ESP32-D0WD-V3 (revision v3.1)\n`);
      for (const p of [0, 38, 76, 100]) { out(`Writing at 0x000${(0x10000 + p * 420).toString(16)}... (${p} %)\n`); await wait(160); }
      out('Hard resetting via RTS pin...</span>\n');
    } else {
      await wait(350);
      out(`<span class="dim">avrdude: ${Math.round(result.stats.flash)} bytes of flash written\navrdude: verifying ... done.</span>\n`);
    }
    showToast('Done uploading.', 100, true);
    out(`<span class="ok">✓ Yuklandi — virtual ${board.name} ishga tushdi.</span>\n`);
    startDevice(result.factory);
    showTab('serial');
  } finally { setBusy(false); }
}
$('#btnVerify').onclick = verify;
$('#btnUpload').onclick = upload;
$('#btnStop').onclick = () => { if (running) stopDevice('Qurilma to‘xtatildi.'); };

// ---------------------------------------------------------------- runtime
const runtime = new Runtime(board, {
  readSensor: (k) => world.read(k),
  onPin(pin, st) { pinState.set(pin, st); },
  onSerial(text) { serialWrite(text); },
  onSerialBegin(baud) { sketchBaud = baud; },
  onDiag(_code, msg) {
    out(`<span class="diag">⚠ ${esc(msg)}</span>`);
    flagTab('output');
  },
  onError(e) {
    console.error(e);
    out(`<span class="err">Runtime xatosi: ${esc(String(e?.message || e))}</span>\n`);
    running = false;
    pinState.clear();
    updateRunState();
    showTab('output');
  },
});

function startDevice(factory) {
  runtime.stop();
  runtime.board = board;
  pinState.clear();
  sketchBaud = 0;
  serialLine = null;
  serialAppend(`\n`, 'sys');
  running = true;
  updateRunState();
  runtime.start(factory);
}
function stopDevice(msg) {
  runtime.stop();
  pinState.clear();
  running = false;
  updateRunState();
  if (msg) out(`<span class="dim">${esc(msg)}</span>\n`);
}

// ---------------------------------------------------------------- serial monitor
const BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400];
const baudSel = $('#baud');
baudSel.innerHTML = BAUDS.map((b) => `<option value="${b}">${b} baud</option>`).join('');
baudSel.value = String(store.get('baud', 9600));
baudSel.onchange = () => store.set('baud', +baudSel.value);
let sketchBaud = 0;
let autoscroll = true;
let timestamps = false;
let serialLine = null;
let lineCount = 0;
$('#autoscroll').onclick = (e) => { autoscroll = !autoscroll; e.currentTarget.classList.toggle('on', autoscroll); };
$('#timestamps').onclick = (e) => { timestamps = !timestamps; e.currentTarget.classList.toggle('on', timestamps); };
$('#btnClear').onclick = () => {
  if (activeTab() === 'serial') { serialOut.innerHTML = ''; serialLine = null; lineCount = 0; } else clearOutput();
};

const GARBAGE = '\uFFFDÿ¿þ⸮¤øÐ×åñ¢';
function garble(text) {
  let s = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) { s += '\n'; continue; }
    if (c === 13) continue;
    if ((c * 7 + i) % 3 === 0) continue;
    s += GARBAGE[(c * 31 + sketchBaud + +baudSel.value) % GARBAGE.length];
  }
  return s;
}
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} -> `;
}
function newLine(cls) {
  $('.serial-empty', serialOut)?.remove();
  serialLine = document.createElement('div');
  if (cls) serialLine.className = cls;
  if (timestamps) {
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = stamp();
    serialLine.appendChild(ts);
  }
  serialLine.appendChild(document.createTextNode(''));
  serialOut.appendChild(serialLine);
  lineCount++;
  if (lineCount > 1500) { serialOut.firstChild.remove(); lineCount--; }
}
function serialAppend(text, cls) {
  if (cls === 'sys') { serialLine = null; return; }
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0) serialLine = null;
    const clean = part.replace(/\r/g, '');
    if (!clean && i === parts.length - 1) return;
    if (!serialLine) newLine(cls);
    serialLine.lastChild.textContent += clean;
  });
  if (autoscroll) serialOut.scrollTop = serialOut.scrollHeight;
}
function serialWrite(text) {
  const mismatch = sketchBaud && +baudSel.value !== sketchBaud;
  serialAppend(mismatch ? garble(text) : text);
  flagTab('serial');
  if (mismatch && !serialWrite.warned) {
    serialWrite.warned = true;
    out(`<span class="diag">⚠ Serial Monitor tezligi (${baudSel.value} baud) sketchdagi Serial.begin(${sketchBaud}) bilan mos emas — shuning uchun matn buzuq chiqyapti. Pastdagi baud tanlovini ${sketchBaud} ga o‘zgartiring.</span>`);
    flagTab('output');
  }
}
baudSel.addEventListener('change', () => { serialWrite.warned = false; });
$('#serialInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = e.currentTarget;
  if (!running) { out('<span class="dim">Qurilma ishlamayapti — avval kodni yuklang.</span>\n'); flagTab('output'); return; }
  const le = $('#lineEnding').value.replace('\\n', '\n').replace('\\r', '\r');
  runtime.feed(input.value + le);
  input.value = '';
});

// ---------------------------------------------------------------- initial state
renderSensors();
out(`<span class="dim">NAFAS virtual laboratoriyasi tayyor.\n\n</span>1) Kodni yozing yoki <b>Misollar</b>dan tanlang.\n2) <span class="ok">✓ Verify</span> — xatolarni tekshiradi (Ctrl+R).\n3) <span class="ok">→ Upload</span> — virtual qurilmaga yuklaydi (Ctrl+U).\n4) Pastdagi <b>Equipments</b> bilan isitkich yoki gaz sizishini yoqing.\n`);
serialOut.innerHTML = '<div class="serial-empty">Serial Monitor: kod yuklangach, Serial.print() natijalari shu yerda chiqadi.</div>';
if (store.get('dirty', false)) $('#dirtyDot').classList.add('dirty');
