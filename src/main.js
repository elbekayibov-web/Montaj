import { createRoom } from './three/room.js';
import { World } from './sim/world.js';
import { BOARDS, WIRING_INFO, pinLabel } from './sim/boards.js';
import { compile } from './sim/compiler.js';
import { Runtime, mqVoltage } from './sim/runtime.js';
import { EXAMPLES, exampleCode } from './sim/examples.js';
import { createEditor } from './ui/editor.js';
import { Buzzer } from './ui/audio.js';
import { createCircuit } from './ui/circuit.js';
import { icon, glyph } from './ui/icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(`nafas2:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`nafas2:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state
const world = new World();
let board = BOARDS[store.get('board', 'uno')] || BOARDS.uno;
const pinState = new Map();
let running = false;
let startedAt = 0;

// ---------------------------------------------------------------- room
const room = createRoom($('#roomCanvas'), {
  onDeviceClick: () => {
    $('#circuit').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#circuit').animate([{ boxShadow: 'inset 0 0 0 2px #5eeaff' }, { boxShadow: 'inset 0 0 0 2px transparent' }], { duration: 1600, delay: 500 });
  },
});
$('#focusDevice').onclick = () => room.focusDevice();
$('#resetView').onclick = () => room.resetView();

// ---------------------------------------------------------------- sound
const buzzer = new Buzzer();
let muted = store.get('muted', false);
buzzer.setMuted(muted);
$('#soundToggle').classList.toggle('muted', muted);
$('.snd-txt').textContent = muted ? 'Sound off' : 'Sound on';
$('#soundToggle').onclick = () => {
  muted = !muted;
  buzzer.unlock();
  buzzer.setMuted(muted);
  store.set('muted', muted);
  $('#soundToggle').classList.toggle('muted', muted);
  $('.snd-txt').textContent = muted ? 'Sound off' : 'Sound on';
};
document.addEventListener('pointerdown', () => buzzer.unlock(), { once: true });

// ---------------------------------------------------------------- equipments
for (const b of $$('.pill[data-eq]')) {
  b.onclick = () => {
    const k = b.dataset.eq;
    world.set(k, !world[k]);
    b.classList.toggle('on', world[k]);
  };
}
$('#resetWorld').onclick = () => {
  world.reset();
  $$('.pill[data-eq]').forEach((b) => b.classList.remove('on'));
};

// ---------------------------------------------------------------- pins → actuators
function pinOut(key) {
  return pinState.get(board.wiring[key]) || { mode: 0, value: 0, pwm: 0, tone: 0 };
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
  return st.mode === 1 ? 1 : 0.12; // no pinMode → dim through the pull-up
}

// ---------------------------------------------------------------- reading tiles
for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
for (const el of $$('[data-glyph]')) el.innerHTML = glyph(el.dataset.glyph, el.dataset.glyph);
const TILES = {
  temperature: { min: 18, max: 70, over: (v) => v > 40, fmt: (v) => v.toFixed(1), sub: () => `Humidity ${Math.round(world.humidity)}%` },
  propane: { min: 0, max: 1200, over: (v) => v > 700, fmt: (v) => String(Math.round(v)), sub: (v) => gasNote(v, 'propane') },
  methane: { min: 0, max: 1200, over: (v) => v > 700, fmt: (v) => String(Math.round(v)), sub: (v) => gasNote(v, 'methane') },
};
function gasNote(v, key) {
  if (v > 700) return 'Dangerous level';
  if (v > 150) return `Rising · ADC ${adcFor(key)}`;
  return `Clean air · ADC ${adcFor(key)}`;
}
for (const [key, t] of Object.entries(TILES)) {
  t.el = $(`.tile[data-m="${key}"]`);
  t.val = $('[data-v]', t.el);
  t.subEl = $('[data-sub]', t.el);
  t.shown = null;
  t.subAcc = 1;
}
function renderTiles(dt) {
  for (const [key, t] of Object.entries(TILES)) {
    const v = world[key];
    t.shown = t.shown == null ? v : t.shown + (v - t.shown) * Math.min(1, dt * 5);
    const lv = Math.max(0, Math.min(1, (t.shown - t.min) / (t.max - t.min)));
    t.el.style.setProperty('--lv', lv.toFixed(3));
    t.val.textContent = t.fmt(t.shown);
    t.el.classList.toggle('over', t.over(v));
    t.subAcc += dt;
    if (t.subAcc > 0.3) { t.subAcc = 0; t.subEl.textContent = t.sub(v); }
  }
}

function adcFor(key) {
  const max = 2 ** board.adcBits - 1;
  if (key === 'propane') return Math.round((mqVoltage(world.propane + 0.12 * world.methane, 2600) / 5) * max);
  return Math.round((mqVoltage(world.methane + 0.1 * world.propane, 3400) / 5) * max);
}

// ---------------------------------------------------------------- circuit
const circuit = createCircuit($('#circuit'), { onButton: (v) => { world.button = v; } });

// ---------------------------------------------------------------- main loop
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = (now - last) / 1000;
  last = now;
  world.step(dt);
  const bz = buzzerLevel();
  const led = ledLevel();
  const alarm = running && bz.freq > 0;
  buzzer.set(running ? bz.freq : 0, bz.level);
  room.update({
    temperature: world.temperature, propane: world.propane, methane: world.methane, heater: world.heater,
    heaterPower: world.heaterPower, propaneLeak: world.propaneLeak, methaneLeak: world.methaneLeak, window: world.window,
    buzzer: alarm ? 1 : 0, led, running, alarm,
  });
  $('#ioBuzzer').classList.toggle('on', alarm);
  $('#ioLed').classList.toggle('on', led > 0.3);
  const orb = $('#unitOrb');
  orb.classList.toggle('run', running && led <= 0.3 && !alarm);
  orb.classList.toggle('alarm', running && (led > 0.3 || alarm));
  circuit.update({
    running, led, buzzer: alarm, motion: world.motion,
    pinValue: (p) => (pinState.get(p)?.value || pinState.get(p)?.pwm || pinState.get(p)?.tone ? 1 : 0),
    sensors: world, adc: { propane: adcFor('propane'), methane: adcFor('methane') },
  });
  if (running) {
    const ms = Math.floor(now - startedAt);
    const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    $('#simTime').textContent = `${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
  }
  renderTiles(dt);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- editor
const output = $('#output');
const serialOut = $('#serialOut');
const toast = $('#ideToast');
let currentExample = store.get('example', EXAMPLES[0].id);
let fileName = store.get('file', EXAMPLES[0].file);
let dirty = store.get('dirty', false);
let loadingCode = false;

const editor = createEditor($('#editor'), {
  doc: store.get('code', null) ?? exampleCode(EXAMPLES.find((e) => e.id === currentExample) || EXAMPLES[0], board),
  onChange(v) {
    store.set('code', v);
    if (loadingCode) return;
    setDirty(true);
    editor.clearProblems();
  },
  onCursor(l, c) { $('#statusPos').textContent = `Ln ${l}, Col ${c}`; },
  keys: [
    { key: 'Mod-r', preventDefault: true, run: () => { verify(); return true; } },
    { key: 'Mod-u', preventDefault: true, run: () => { upload(); return true; } },
    { key: 'Mod-s', preventDefault: true, run: () => { remember(); return true; } },
  ],
});
function setDirty(v) {
  dirty = v;
  store.set('dirty', v);
  $('#dirtyDot').classList.toggle('dirty', v);
  renderExamples();
}
function loadCode(code, name, exampleId = null) {
  loadingCode = true;
  editor.value = code;
  loadingCode = false;
  fileName = name;
  currentExample = exampleId;
  store.set('file', name);
  store.set('example', exampleId);
  $('#fileName').textContent = name;
  editor.clearProblems();
  showFile('sketch');
  setDirty(false);
  renderRecent();
}
$('#fileName').textContent = fileName;
$('#dirtyDot').classList.toggle('dirty', dirty);
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); verify(); }
  if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); upload(); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); showTab('serial'); }
});

// file tabs (sketch.ino / diagram.json / libraries.txt)
function diagramJson() {
  const partType = { propane: 'wokwi-gas-sensor', methane: 'wokwi-gas-sensor', dht: 'wokwi-dht22', buzzer: 'wokwi-buzzer', led: 'wokwi-led', pir: 'wokwi-pir-motion-sensor', button: 'wokwi-pushbutton' };
  const boardType = { uno: 'wokwi-arduino-uno', nano: 'wokwi-arduino-nano', esp32: 'board-esp32-devkit-c-v4' }[board.id];
  const parts = [{ type: boardType, id: board.id, top: 0, left: 0, attrs: {} }];
  const connections = [];
  for (const w of WIRING_INFO) {
    parts.push({ type: partType[w.key], id: w.key, attrs: w.key === 'led' ? { color: 'red' } : {} });
    connections.push([`${w.key}:${w.key === 'button' ? '1.l' : w.key === 'led' ? 'A' : w.key === 'buzzer' ? '2' : w.key === 'dht' ? 'SDA' : w.key === 'pir' ? 'OUT' : 'AOUT'}`, `${board.id}:${pinLabel(board, board.wiring[w.key]).replace(/^D|^GPIO/, '')}`, 'green', []]);
  }
  if (board.arch === 'avr') {
    parts.push({ type: 'board-esp32-devkit-c-v4', id: 'wifi', attrs: {} });
    connections.push([`${board.id}:1`, 'wifi:RX', 'blue', []]);
  }
  return JSON.stringify({ version: 1, author: 'NAFAS', editor: 'nafas-lab', parts, connections }, null, 2);
}
function showFile(name) {
  $$('.file').forEach((f) => f.classList.toggle('active', f.dataset.file === name));
  const aux = $('#auxView');
  if (name === 'sketch') { aux.hidden = true; return; }
  aux.hidden = false;
  aux.textContent = name === 'diagram'
    ? diagramJson()
    : '# Libraries available to the sketch\n\nDHT sensor library   (#include <DHT.h>)\nWire                 (#include <Wire.h>)\nSPI                  (#include <SPI.h>)\n';
}
$$('.file').forEach((f) => { f.onclick = () => showFile(f.dataset.file); });

// board select
const boardSelect = $('#boardSelect');
boardSelect.innerHTML = Object.values(BOARDS).map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
boardSelect.value = board.id;
function applyBoard() {
  $('#statusBoard').textContent = `${board.name} · ${board.port}`;
  $('#unitBoard').textContent = board.name;
  circuit.setBoard(board);
  if (!$('#auxView').hidden && $('.file.active').dataset.file === 'diagram') showFile('diagram');
}
boardSelect.onchange = () => {
  const prev = board;
  board = BOARDS[boardSelect.value];
  store.set('board', board.id);
  if (running) stopDevice('Board changed — upload the sketch again.');
  const ex = EXAMPLES.find((e) => e.id === currentExample);
  if (ex && editor.value === exampleCode(ex, prev)) loadCode(exampleCode(ex, board), ex.file, ex.id);
  applyBoard();
};
applyBoard();

// ---------------------------------------------------------------- examples & recent sketches
let confirming = null; // id of the item waiting for a second click
function guarded(id, action) {
  if (dirty && confirming !== id) {
    confirming = id;
    renderExamples();
    renderRecent();
    return;
  }
  confirming = null;
  action();
}
document.addEventListener('click', (e) => {
  if (confirming && !e.target.closest('.file-item')) { confirming = null; renderExamples(); renderRecent(); }
});
const FILE_ICON = icon('folder');
function renderExamples() {
  $('#examplesList').innerHTML = EXAMPLES.map((e) => {
    const cur = !dirty && currentExample === e.id;
    const conf = confirming === `ex:${e.id}`;
    return `<button class="file-item${cur ? ' current' : ''}${conf ? ' confirm' : ''}" data-ex="${e.id}"><span class="fi">${FILE_ICON}</span><span class="meta"><span>${esc(e.title)}</span><small>${conf ? 'Unsaved edits — click again to replace' : esc(e.note)}</small></span></button>`;
  }).join('');
  for (const b of $$('[data-ex]', $('#examplesList'))) {
    b.onclick = () => {
      const ex = EXAMPLES.find((x) => x.id === b.dataset.ex);
      guarded(`ex:${ex.id}`, () => loadCode(exampleCode(ex, board), ex.file, ex.id));
    };
  }
}

function recentList() { return store.get('recent', []); }
function remember() {
  const code = editor.value;
  let list = recentList().filter((r) => r.code !== code);
  list.unshift({ id: Date.now(), name: fileName, board: board.id, code, t: Date.now() });
  list = list.slice(0, 10);
  store.set('recent', list);
  renderRecent();
}
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-GB');
}
function renderRecent() {
  const list = recentList();
  $('#recentCount').textContent = list.length;
  if (!list.length) {
    $('#recentList').innerHTML = '<div class="empty">Sketches are saved here when you upload (▶) or press Ctrl+S.</div>';
    return;
  }
  $('#recentList').innerHTML = list.map((r) => {
    const conf = confirming === `rc:${r.id}`;
    const lines = r.code.split('\n').length;
    return `<button class="file-item${conf ? ' confirm' : ''}" data-rc="${r.id}"><span class="fi">${FILE_ICON}</span><span class="meta"><span>${esc(r.name)}</span><small>${conf ? 'Unsaved edits — click again to replace' : `${ago(r.t)} · ${lines} lines · ${BOARDS[r.board]?.name ?? ''}`}</small></span></button>`;
  }).join('');
  for (const b of $$('[data-rc]', $('#recentList'))) {
    b.onclick = () => {
      const r = recentList().find((x) => String(x.id) === b.dataset.rc);
      guarded(`rc:${r.id}`, () => {
        if (BOARDS[r.board] && r.board !== board.id) { board = BOARDS[r.board]; boardSelect.value = board.id; store.set('board', board.id); applyBoard(); }
        loadCode(r.code, r.name, null);
      });
    };
  }
}
renderExamples();
renderRecent();
setInterval(renderRecent, 60000);

// ---------------------------------------------------------------- console tabs + output
function showTab(name) {
  $$('.ctab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#paneOutput').classList.toggle('active', name === 'output');
  $('#paneSerial').classList.toggle('active', name === 'serial');
  $(`.ctab[data-tab="${name}"]`).classList.remove('pending');
}
$$('.ctab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
const activeTab = () => $('.ctab.active').dataset.tab;
const flagTab = (name) => { if (activeTab() !== name) $(`.ctab[data-tab="${name}"]`).classList.add('pending'); };
function out(html) {
  output.insertAdjacentHTML('beforeend', html);
  output.scrollTop = output.scrollHeight;
}
const clearOutput = () => { output.innerHTML = ''; };
function showToast(text, pct, done) {
  $('.toast-txt', toast).textContent = text;
  $('.toast-bar i', toast).style.width = `${pct}%`;
  toast.classList.toggle('done', !!done);
  toast.classList.add('show');
  clearTimeout(showToast.t);
  if (done) showToast.t = setTimeout(() => toast.classList.remove('show'), 2400);
}
function sourceExcerpt(line, col) {
  const src = editor.value.split('\n')[line - 1];
  if (src == null) return '';
  return `<span class="dim">${String(line).padStart(5)} | </span>${esc(src)}\n<span class="dim">      | </span><span class="err">${' '.repeat(Math.max(0, col - 1))}^</span>\n`;
}
function formatProblem(p, sev) {
  const loc = p.line ? `${fileName}:${p.line}:${p.col || 1}` : fileName.replace(/\.ino$/, '.ino.cpp.o');
  let s = `<span class="errloc" data-line="${p.line}" data-col="${p.col || 1}">${esc(loc)}</span>: <span class="${sev === 'error' ? 'err' : 'warn'}">${sev}: ${esc(p.message ?? p.msg)}</span>\n`;
  if (p.line) s += sourceExcerpt(p.line, p.col || 1);
  if (p.hint) s += `<span class="hint">${esc(p.hint)}</span>`;
  return s;
}
output.addEventListener('click', (e) => {
  const l = e.target.closest('.errloc');
  if (l && +l.dataset.line) editor.goto(+l.dataset.line, +l.dataset.col);
});

// ---------------------------------------------------------------- verify / upload
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
  showFile('sketch');
  editor.clearProblems();
  showToast('Compiling sketch...', 15);
  out(`<span class="dim">FQBN: ${board.fqbn}\nCompiling sketch...</span>\n`);
  await wait(220);
  showToast('Compiling sketch...', 60);
  await wait(220);
  let result;
  try {
    result = compile(editor.value, board);
    result.factory = new Function('__rt', '__c', result.js);
  } catch (e) {
    if (e.line === undefined) {
      out(`<span class="err">Internal error: ${esc(String(e.message))}</span>\n`);
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
  if (result.warnings.length) editor.showProblems(result.warnings.map((w) => ({ line: w.line, col: w.col, message: w.msg, hint: w.hint, severity: 'warning' })));
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
    showToast('Uploading...', 70);
    if (board.arch === 'esp32') {
      out(`<span class="dim">esptool.py v4.6 · ${board.port}\nConnecting....\nChip is ESP32-D0WD-V3 (revision v3.1)\n`);
      for (const p of [0, 38, 76, 100]) { out(`Writing at 0x000${(0x10000 + p * 420).toString(16)}... (${p} %)\n`); await wait(140); }
      out('Hard resetting via RTS pin...</span>\n');
    } else {
      await wait(300);
      out(`<span class="dim">avrdude: ${Math.round(result.stats.flash)} bytes of flash written\navrdude: verifying ... done.</span>\n`);
    }
    showToast('Done uploading.', 100, true);
    out(`<span class="ok">✓ Uploaded to ${board.name}.</span>\n`);
    remember();
    startDevice(result.factory);
    showTab('serial');
  } finally { setBusy(false); }
}
$('#btnVerify').onclick = verify;
$('#btnUpload').onclick = upload;
$('#btnStop').onclick = () => { if (running) stopDevice(); };

// ---------------------------------------------------------------- runtime
const runtime = new Runtime(board, {
  readSensor: (k) => world.read(k),
  onPin(pin, st) { pinState.set(pin, st); },
  onSerial(text) { serialWrite(text); circuit.serialActivity(); },
  onSerialBegin(baud) { sketchBaud = baud; },
  onDiag(_code, msg) { out(`<span class="diag">${esc(msg)}</span>`); flagTab('output'); },
  onError(e) {
    console.error(e);
    out(`<span class="err">Runtime error: ${esc(String(e?.message || e))}</span>\n`);
    stopDevice();
    showTab('output');
  },
});
function startDevice(factory) {
  runtime.stop();
  runtime.board = board;
  pinState.clear();
  sketchBaud = 0;
  serialLine = null;
  running = true;
  startedAt = performance.now();
  $('#simTime').classList.add('live');
  runtime.start(factory);
}
function stopDevice(msg) {
  runtime.stop();
  pinState.clear();
  running = false;
  $('#simTime').classList.remove('live');
  if (msg) out(`<span class="dim">${esc(msg)}</span>\n`);
}

// ---------------------------------------------------------------- serial monitor
const BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400];
const baudSel = $('#baud');
baudSel.innerHTML = BAUDS.map((b) => `<option value="${b}">${b} baud</option>`).join('');
baudSel.value = String(store.get('baud', 9600));
baudSel.onchange = () => { store.set('baud', +baudSel.value); serialWrite.warned = false; };
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
const GARBAGE = '�ÿ¿þ⸮¤øÐ×åñ¢';
function garble(text) {
  let s = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) { s += '\n'; continue; }
    if (c === 13 || (c * 7 + i) % 3 === 0) continue;
    s += GARBAGE[(c * 31 + sketchBaud + +baudSel.value) % GARBAGE.length];
  }
  return s;
}
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} -> `;
}
function newLine() {
  $('.serial-empty', serialOut)?.remove();
  serialLine = document.createElement('div');
  if (timestamps) {
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = stamp();
    serialLine.appendChild(ts);
  }
  serialLine.appendChild(document.createTextNode(''));
  serialOut.appendChild(serialLine);
  if (++lineCount > 1500) { serialOut.firstChild.remove(); lineCount--; }
}
function serialAppend(text) {
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0) serialLine = null;
    const clean = part.replace(/\r/g, '');
    if (!clean && i === parts.length - 1) return;
    if (!serialLine) newLine();
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
    out(`<span class="diag">The Serial Monitor runs at ${baudSel.value} baud but the sketch calls Serial.begin(${sketchBaud}) — that is why the text is garbled. Set the baud rate to ${sketchBaud}.</span>`);
    flagTab('output');
  }
}
$('#serialInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = e.currentTarget;
  if (!running) { out('<span class="dim">Upload a sketch first (▶).</span>\n'); flagTab('output'); return; }
  const le = $('#lineEnding').value.replace('\\n', '\n').replace('\\r', '\r');
  runtime.feed(input.value + le);
  input.value = '';
});

// ---------------------------------------------------------------- initial state
out('<span class="dim">Ctrl+R verify · Ctrl+U upload · Ctrl+S save\n</span>');
serialOut.innerHTML = '<div class="serial-empty">Press ▶ — Serial.print() output appears here.</div>';
