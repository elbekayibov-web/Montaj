// Wiring diagram of the NAFAS unit, drawn as plain vector SVG (no filters, so
// it stays sharp at any zoom). The board lies landscape like a real Uno:
// digital header on top, power + analog header at the bottom. Parts sit on the
// side of the header they connect to, power comes from 5V/GND rails, and every
// signal wire has its own colour. Wheel/drag/buttons zoom and pan; hovering a
// wire or a row in the connection list highlights it end to end.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const text = (parent, x, y, str, cls, attrs = {}) => {
  const t = el('text', { x, y, class: cls, ...attrs }, parent);
  t.textContent = str;
  return t;
};

// Header layouts. `top`/`bottom` are read left to right; null = gap.
const BOARDS = {
  uno: {
    title: 'ARDUINO UNO', color: '#17639a', edge: '#0d4166',
    top: ['AREF', 'GND', '13', '12', '~11', '~10', '~9', '8', null, '7', '~6', '~5', '4', '~3', '2', 'TX→1', 'RX←0'],
    bottom: ['IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'VIN', null, 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    power: '5V',
  },
  nano: {
    title: 'ARDUINO NANO', color: '#1d4f7c', edge: '#103453',
    top: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
    bottom: ['D13', '3V3', 'REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
    power: '5V',
  },
  esp32: {
    title: 'ESP32 DEVKIT', color: '#1b1f24', edge: '#000000',
    top: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'D17', 'D16', 'D4', 'D0', 'D2', 'D15', 'GND', '3V3'],
    bottom: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'GND', 'D13', 'VIN'],
    power: '3V3',
  },
};

function labelToPin(label) {
  if (!label) return null;
  const l = label.replace(/[~←→]/g, '');
  if (/^A\d$/.test(l)) return 14 + +l[1];
  if (l === 'VP') return 36;
  if (l === 'VN') return 39;
  if (l.startsWith('TX')) return 1;
  if (l.startsWith('RX')) return null;
  const m = l.match(/^D?(\d+)$/);
  return m ? +m[1] : null;
}
const POWER_LABELS = /^(GND|5V|3V3|3\.3V|VIN|RST|RESET|EN|IOREF|AREF|REF)$/;

// Geometry (viewBox units)
const VB = { w: 1000, h: 830 };
const HOME = { x: 140, y: 0, w: 830, h: 830 };
const B = { x: 230, y: 250, w: 540, h: 300 };
const PITCH = 24;
const RAIL = { topV: 156, topG: 170, botG: 632, botV: 646 };
const LANE = { top: 196, bot: 568 };

const COLORS = {
  vcc: '#ef4444', gnd: '#6b7280',
  propane: '#a78bfa', methane: '#38bdf8', dht: '#f59e0b', led: '#fb7185', buzzer: '#f97316', pir: '#34d399', button: '#e879f9', tx: '#3b82f6',
};

const PART_INFO = {
  propane: { name: 'MQ-2', desc: 'Propane gas sensor' },
  methane: { name: 'MQ-4', desc: 'Methane gas sensor' },
  dht: { name: 'DHT22', desc: 'Temperature / humidity' },
  led: { name: 'LED', desc: 'Red alarm LED' },
  buzzer: { name: 'Buzzer', desc: 'Active buzzer' },
  pir: { name: 'HC-SR501', desc: 'PIR motion sensor' },
  button: { name: 'Button', desc: 'Push button' },
  wifi: { name: 'ESP32', desc: 'Wi-Fi module (Serial)' },
};

export function createCircuit(host, { onButton } = {}) {
  host.classList.add('circuit-host');
  const svg = el('svg', { viewBox: `0 0 ${VB.w} ${VB.h}`, class: 'circuit-svg', role: 'img', 'aria-label': 'NAFAS Nano wiring diagram' });
  host.appendChild(svg);
  const world = el('g', {}, svg);
  const gRails = el('g', {}, world);
  const gWires = el('g', {}, world);
  const gBoard = el('g', {}, world);
  const gParts = el('g', {}, world);
  const gPins = el('g', {}, world);

  // UI: zoom buttons, tooltip and connection list
  const ui = document.createElement('div');
  ui.className = 'cz';
  ui.innerHTML = `<button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit">⤢</button><button data-z="list" class="cz-list" title="Connections list">☰</button>`;
  host.appendChild(ui);
  const tip = document.createElement('div');
  tip.className = 'c-tip';
  host.appendChild(tip);
  const list = document.createElement('div');
  list.className = 'c-list';
  list.hidden = true;
  host.appendChild(list);

  let board = null;
  let layout = null;
  const pinPos = new Map(); // header label -> {x, y, side}
  const parts = {};
  let wires = [];

  // ---------------------------------------------------------------- parts
  // Each part: group + pins { name: {x, y, side} } where side is 'top' (part
  // sits above the board, pins point down) or 'bottom'.
  function pinStub(g, x, y, up, label) {
    el('rect', { x: x - 3, y: up ? y - 12 : y, width: 6, height: 12, rx: 1, fill: '#c9b36a' }, g);
    // vertical label inside the part body, like a silkscreen
    const ty = up ? y + 6 : y - 6;
    text(g, x, ty, label, 'c-pin', { transform: `rotate(-90 ${x} ${ty})`, 'text-anchor': up ? 'end' : 'start', 'dominant-baseline': 'middle' });
  }
  function partLabel(g, cx, y, key, valueClass) {
    text(g, cx, y, PART_INFO[key].name, 'c-name', { 'text-anchor': 'middle' });
    return text(g, cx, y + 15, '', valueClass || 'c-val', { 'text-anchor': 'middle' });
  }

  function gasModule(key, cx) {
    // below the board, pins on top edge
    const top = 678;
    const g = el('g', { class: 'part', 'data-part': key }, gParts);
    el('rect', { x: cx - 52, y: top, width: 104, height: 80, rx: 6, fill: '#155d8b', stroke: '#0b3d5e', 'stroke-width': 1.5 }, g);
    el('circle', { cx, cy: top + 46, r: 22, fill: '#b87333' }, g);
    el('circle', { cx, cy: top + 46, r: 17, fill: '#d6dade', stroke: '#8f979d', 'stroke-width': 1 }, g);
    for (let r = 4; r < 17; r += 4) el('circle', { cx, cy: top + 46, r, fill: 'none', stroke: '#9aa2a8', 'stroke-width': 0.8 }, g);
    const pwr = el('circle', { cx: cx - 42, cy: top + 70, r: 3.5, fill: '#3a1010' }, g);
    const pins = {};
    [['VCC', -26], ['GND', 0], ['AO', 26]].forEach(([n, dx]) => { pinStub(g, cx + dx, top, true, n); pins[n] = { x: cx + dx, y: top - 12, side: 'bottom' }; });
    text(g, cx, top + 94, PART_INFO[key].name, 'c-name', { 'text-anchor': 'middle' });
    const val = text(g, cx, top + 108, '', 'c-val', { 'text-anchor': 'middle' });
    parts[key] = { g, pins, pwr, val, signal: 'AO' };
  }
  function dht(cx) {
    const top = 678;
    const g = el('g', { class: 'part', 'data-part': 'dht' }, gParts);
    el('rect', { x: cx - 36, y: top, width: 72, height: 80, rx: 5, fill: '#f3f4f6', stroke: '#c7ccd1', 'stroke-width': 1.5 }, g);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) el('rect', { x: cx - 26 + c * 14, y: top + 30 + r * 12, width: 9, height: 7, rx: 1, fill: '#aab1b8' }, g);
    const pins = {};
    [['VCC', -18], ['DATA', -6], ['NC', 6], ['GND', 18]].forEach(([n, dx]) => { pinStub(g, cx + dx, top, true, n === 'DATA' ? 'SDA' : n); pins[n] = { x: cx + dx, y: top - 12, side: 'bottom' }; });
    text(g, cx, top + 98, 'DHT22', 'c-name', { 'text-anchor': 'middle' });
    const val = text(g, cx, top + 112, '', 'c-val', { 'text-anchor': 'middle' });
    parts.dht = { g, pins, val, signal: 'DATA' };
  }
  function led(cx) {
    const bottom = 128; // pins end here, part above
    const g = el('g', { class: 'part', 'data-part': 'led' }, gParts);
    const lens = el('path', { d: `M${cx - 13} ${bottom - 34} V${bottom - 58} a13 13 0 0 1 26 0 V${bottom - 34} Z`, fill: '#7f1d1d', stroke: '#4c0d0d', 'stroke-width': 1.5 }, g);
    el('rect', { x: cx - 16, y: bottom - 36, width: 32, height: 5, rx: 1, fill: '#991b1b' }, g);
    el('line', { x1: cx - 6, y1: bottom - 31, x2: cx - 6, y2: bottom, stroke: '#c0c6cb', 'stroke-width': 2.5 }, g);
    el('line', { x1: cx + 6, y1: bottom - 31, x2: cx + 6, y2: bottom - 6, stroke: '#c0c6cb', 'stroke-width': 2.5 }, g);
    text(g, cx - 6, bottom + 14, 'A', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx + 6, bottom + 8, 'K', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx, bottom - 84, 'LED', 'c-name', { 'text-anchor': 'middle' });
    parts.led = { g, lens, pins: { A: { x: cx - 6, y: bottom, side: 'top' }, K: { x: cx + 6, y: bottom - 6, side: 'top' } }, signal: 'A', gnd: 'K' };
  }
  function buzzer(cx) {
    const bottom = 128;
    const g = el('g', { class: 'part', 'data-part': 'buzzer' }, gParts);
    const waves = el('g', { class: 'bz-waves' }, g);
    for (let i = 0; i < 3; i++) el('path', { d: `M${cx + 34 + i * 7} ${bottom - 76 + i * 3} q${9 + i * 2} ${16} 0 ${32 - i * 6}`, fill: 'none', stroke: '#5eeaff', 'stroke-width': 2, 'stroke-linecap': 'round', style: `animation-delay:${i * 0.12}s` }, waves);
    el('circle', { cx, cy: bottom - 60, r: 26, fill: '#1c1f22', stroke: '#3a4146', 'stroke-width': 2 }, g);
    el('circle', { cx, cy: bottom - 60, r: 5, fill: '#0b0d0e' }, g);
    text(g, cx - 10, bottom - 56, '+', 'c-mark-light', { 'text-anchor': 'middle' });
    el('line', { x1: cx - 8, y1: bottom - 34, x2: cx - 8, y2: bottom, stroke: '#c0c6cb', 'stroke-width': 2.5 }, g);
    el('line', { x1: cx + 8, y1: bottom - 34, x2: cx + 8, y2: bottom, stroke: '#c0c6cb', 'stroke-width': 2.5 }, g);
    text(g, cx - 8, bottom + 14, '+', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx + 8, bottom + 14, '−', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx, bottom - 94, 'Buzzer', 'c-name', { 'text-anchor': 'middle' });
    parts.buzzer = { g, waves, pins: { '+': { x: cx - 8, y: bottom, side: 'top' }, '−': { x: cx + 8, y: bottom, side: 'top' } }, signal: '+', gnd: '−' };
  }
  function pir(cx) {
    const bottom = 116;
    const g = el('g', { class: 'part', 'data-part': 'pir' }, gParts);
    el('rect', { x: cx - 48, y: bottom - 78, width: 96, height: 78, rx: 5, fill: '#1c4f86', stroke: '#123a63', 'stroke-width': 1.5 }, g);
    el('circle', { cx, cy: bottom - 42, r: 28, fill: '#eef1f3', stroke: '#c3cad0', 'stroke-width': 1 }, g);
    for (let r = 8; r < 28; r += 7) el('circle', { cx, cy: bottom - 42, r, fill: 'none', stroke: '#c3cad0', 'stroke-width': 0.8 }, g);
    const pins = {};
    [['VCC', -16], ['OUT', 0], ['GND', 16]].forEach(([n, dx]) => {
      el('rect', { x: cx + dx - 3, y: bottom, width: 6, height: 12, rx: 1, fill: '#c9b36a' }, g);
      text(g, cx + dx, bottom + 24, n === 'OUT' ? 'OUT' : n === 'VCC' ? '+' : '−', 'c-pin', { 'text-anchor': 'middle' });
      pins[n] = { x: cx + dx, y: bottom + 12, side: 'top' };
    });
    text(g, cx, bottom - 88, 'HC-SR501 PIR', 'c-name', { 'text-anchor': 'middle' });
    parts.pir = { g, pins, signal: 'OUT' };
  }
  function button(cx) {
    const bottom = 116;
    const g = el('g', { class: 'part button-part', 'data-part': 'button' }, gParts);
    el('rect', { x: cx - 30, y: bottom - 56, width: 60, height: 56, rx: 5, fill: '#e5e7ea', stroke: '#b8bec4', 'stroke-width': 1.5 }, g);
    const cap = el('circle', { cx, cy: bottom - 28, r: 17, fill: '#1f8a3b', stroke: '#14632a', 'stroke-width': 2 }, g);
    const pins = {};
    [['1', -12], ['2', 12]].forEach(([n, dx]) => {
      el('rect', { x: cx + dx - 3, y: bottom, width: 6, height: 12, rx: 1, fill: '#c9b36a' }, g);
      pins[n] = { x: cx + dx, y: bottom + 12, side: 'top' };
    });
    text(g, cx - 12, bottom + 24, '1', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx + 12, bottom + 24, '2', 'c-pin', { 'text-anchor': 'middle' });
    text(g, cx, bottom - 66, 'Button (press)', 'c-name', { 'text-anchor': 'middle' });
    parts.button = { g, cap, pins, signal: '1', gnd: '2' };
    const press = (v) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      cap.setAttribute('r', v ? 15 : 17);
      cap.setAttribute('fill', v ? '#14632a' : '#1f8a3b');
      onButton?.(v);
    };
    g.addEventListener('pointerdown', press(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) g.addEventListener(ev, press(false));
  }
  function wifi(cx) {
    const bottom = 128;
    const g = el('g', { class: 'part', 'data-part': 'wifi' }, gParts);
    el('rect', { x: cx - 56, y: bottom - 112, width: 112, height: 112, rx: 7, fill: '#16191c', stroke: '#30363b', 'stroke-width': 1.5 }, g);
    el('rect', { x: cx - 34, y: bottom - 100, width: 68, height: 60, rx: 3, fill: '#aeb4b9' }, g);
    text(g, cx, bottom - 66, 'ESP32', 'c-mark', { 'text-anchor': 'middle' });
    const tx = el('circle', { cx: cx + 40, cy: bottom - 20, r: 4, fill: '#2a1f06' }, g);
    const pins = {};
    [['VIN', -24], ['GND', 0], ['RX', 24]].forEach(([n, dx]) => {
      el('rect', { x: cx + dx - 3, y: bottom, width: 6, height: 12, rx: 1, fill: '#c9b36a' }, g);
      text(g, cx + dx, bottom + 24, n, 'c-pin', { 'text-anchor': 'middle' });
      pins[n] = { x: cx + dx, y: bottom + 12, side: 'top' };
    });
    text(g, cx, bottom - 122, 'ESP32 Wi-Fi', 'c-name', { 'text-anchor': 'middle' });
    parts.wifi = { g, tx, pins, signal: 'RX' };
  }

  gasModule('propane', 300);
  gasModule('methane', 470);
  dht(640);
  led(250);
  pir(380);
  buzzer(520);
  button(650);
  wifi(870);

  // ---------------------------------------------------------------- board
  let boardLeds = {};
  // Header sits flush right like on a real Uno; returns x of the first pin.
  const headerX0 = (n) => B.x + B.w - 46 - (n - 1) * PITCH;

  function drawBoard() {
    gBoard.innerHTML = '';
    pinPos.clear();
    const L = layout;
    const { x, y, w, h } = B;
    const g = gBoard;
    // outline with the bevelled right side of an Uno
    el('path', { d: `M${x + 10} ${y} H${x + w - 28} L${x + w - 14} ${y + 14} V${y + 34} L${x + w} ${y + 48} V${h + y - 40} L${x + w - 14} ${y + h - 26} V${y + h - 10} Q${x + w - 14} ${y + h} ${x + w - 24} ${y + h} H${x + 10} Q${x} ${y + h} ${x} ${y + h - 10} V${y + 10} Q${x} ${y} ${x + 10} ${y} Z`, fill: L.color, stroke: L.edge, 'stroke-width': 2 }, g);
    for (const [hx, hy] of [[x + 112, y + 16], [x + w - 30, y + 66], [x + w - 30, y + h - 54], [x + 100, y + h - 16]]) el('circle', { cx: hx, cy: hy, r: 8, fill: '#15181b' }, g);

    const header = (labels, top) => {
      const n = labels.length;
      const x0 = headerX0(n);
      const hy = top ? y + 18 : y + h - 18;
      // one black strip per group of pins (split at the gap)
      let start = 0;
      for (let i = 0; i <= n; i++) {
        if (i === n || labels[i] === null) {
          if (i > start) el('rect', { x: x0 + start * PITCH - 11, y: hy - 11, width: (i - start - 1) * PITCH + 22, height: 22, rx: 2, fill: '#1a1d20' }, g);
          start = i + 1;
        }
      }
      labels.forEach((lab, i) => {
        if (!lab) return;
        const px = x0 + i * PITCH;
        el('rect', { x: px - 7, y: hy - 7, width: 14, height: 14, fill: '#3b4045' }, g);
        el('rect', { x: px - 4, y: hy - 4, width: 8, height: 8, fill: '#08090a' }, g);
        const ty = top ? hy + 18 : hy - 18;
        text(g, px, ty, lab, 'c-silk', { transform: `rotate(-90 ${px} ${ty})`, 'text-anchor': top ? 'end' : 'start', 'dominant-baseline': 'central' });
        pinPos.set(lab + (pinPos.has(lab) ? `#${i}` : ''), { x: px, y: top ? hy - 7 : hy + 7, side: top ? 'top' : 'bottom', label: lab });
      });
      return x0;
    };
    const tx0 = header(L.top, true);
    const bx0 = header(L.bottom, false);

    if (board.id === 'uno') {
      // group captions
      const gapTop = L.top.indexOf(null);
      const dx1 = tx0 + (gapTop + 1) * PITCH - 10;
      el('line', { x1: tx0 + 2 * PITCH - 8, y1: y + 68, x2: x + w - 36, y2: y + 68, stroke: '#ffffff', 'stroke-width': 1.5 }, g);
      text(g, dx1 + 60, y + 84, 'DIGITAL (PWM ~)', 'c-silk-cap', { 'text-anchor': 'middle' });
      const gapBot = L.bottom.indexOf(null);
      el('line', { x1: bx0 - 8, y1: y + h - 66, x2: bx0 + (gapBot - 1) * PITCH + 8, y2: y + h - 66, stroke: '#ffffff', 'stroke-width': 1.5 }, g);
      el('line', { x1: bx0 + (gapBot + 1) * PITCH - 8, y1: y + h - 66, x2: bx0 + (L.bottom.length - 1) * PITCH + 8, y2: y + h - 66, stroke: '#ffffff', 'stroke-width': 1.5 }, g);
      text(g, bx0 + (gapBot - 1) * PITCH + 8, y + h - 72, 'POWER', 'c-silk-cap', { 'text-anchor': 'end' });
      text(g, bx0 + (L.bottom.length - 1) * PITCH + 8, y + h - 72, 'ANALOG IN', 'c-silk-cap', { 'text-anchor': 'end' });
      // USB-B, DC jack, reset, ICSP
      el('rect', { x: x - 26, y: y + 34, width: 76, height: 58, rx: 2, fill: '#a9adb1', stroke: '#7d8388', 'stroke-width': 1.5 }, g);
      el('rect', { x: x - 20, y: y + 40, width: 64, height: 46, fill: '#c4c8cb' }, g);
      el('rect', { x: x - 18, y: y + h - 78, width: 62, height: 52, rx: 4, fill: '#0d0f10' }, g);
      el('rect', { x: x + 44, y: y + h - 70, width: 6, height: 36, fill: '#26292c' }, g);
      el('rect', { x: x + 30, y: y + 8, width: 28, height: 28, rx: 2, fill: '#c0c4c7' }, g);
      el('circle', { cx: x + 44, cy: y + 22, r: 8, fill: '#a3161b' }, g);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) el('circle', { cx: x + 76 + c * 10, cy: y + 42 + r * 10, r: 3.2, fill: '#b9bfc4', stroke: '#2a2e31' }, g);
      // logo
      const lx = x + 230;
      const ly = y + 118;
      el('circle', { cx: lx - 17, cy: ly, r: 16, fill: 'none', stroke: '#ffffff', 'stroke-width': 5 }, g);
      el('circle', { cx: lx + 17, cy: ly, r: 16, fill: 'none', stroke: '#ffffff', 'stroke-width': 5 }, g);
      el('rect', { x: lx - 23, y: ly - 1.5, width: 12, height: 3, fill: '#ffffff' }, g);
      el('rect', { x: lx + 11, y: ly - 1.5, width: 12, height: 3, fill: '#ffffff' }, g);
      el('rect', { x: lx + 15.5, y: ly - 6, width: 3, height: 12, fill: '#ffffff' }, g);
      text(g, lx, ly + 34, 'ARDUINO', 'c-brand', { 'text-anchor': 'middle' });
      el('rect', { x: lx + 48, y: ly - 18, width: 66, height: 34, rx: 7, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.5 }, g);
      text(g, lx + 81, ly + 7, 'UNO', 'c-uno', { 'text-anchor': 'middle' });
      // ATmega328P
      const cx0 = x + 250;
      const cy0 = y + 158;
      el('rect', { x: cx0, y: cy0, width: 250, height: 40, rx: 2, fill: '#202326' }, g);
      for (let i = 0; i < 14; i++) {
        el('rect', { x: cx0 + 10 + i * 17, y: cy0 - 4, width: 7, height: 4, fill: '#c9cdd0' }, g);
        el('rect', { x: cx0 + 10 + i * 17, y: cy0 + 40, width: 7, height: 4, fill: '#c9cdd0' }, g);
      }
      el('circle', { cx: cx0 + 12, cy: cy0 + 20, r: 4, fill: '#121416' }, g);
      text(g, cx0 + 140, cy0 + 24, 'ATMEGA328P', 'c-chip', { 'text-anchor': 'middle' });
    } else {
      text(g, x + w / 2, y + h / 2, L.title, 'c-uno', { 'text-anchor': 'middle' });
      el('rect', { x: x + w / 2 - 70, y: y + h / 2 + 20, width: 140, height: 34, rx: 2, fill: '#202326' }, g);
      el('rect', { x: x - 20, y: y + h / 2 - 22, width: 40, height: 44, rx: 3, fill: '#a9adb1' }, g);
    }
    // status LEDs (L, TX, RX, ON)
    const led = (lx, ly, label, anchor) => {
      const r = el('rect', { x: lx, y: ly, width: 14, height: 8, rx: 1.5, fill: '#e9ecee' }, g);
      text(g, anchor === 'end' ? lx - 6 : lx + 20, ly + 4, label, 'c-silk-cap', { 'text-anchor': anchor, 'dominant-baseline': 'central' });
      return r;
    };
    const lLed = led(x + 170, y + 92, 'L', 'end');
    const txLed = led(x + 170, y + 112, 'TX', 'end');
    led(x + 170, y + 126, 'RX', 'end');
    const onLed = led(x + w - 92, y + 112, 'ON', 'start');
    boardLeds = { onLed, lLed, txLed };
  }

  function findPin(predicate) {
    for (const [, p] of pinPos) if (predicate(p.label)) return p;
    return null;
  }
  function signalPin(num) {
    return findPin((lab) => labelToPin(lab) === num && !POWER_LABELS.test(lab));
  }

  // ---------------------------------------------------------------- wiring
  function path(points) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  }
  function addWire(id, color, points, from, to, desc) {
    const g = el('g', { class: 'wire', 'data-id': id }, gWires);
    const d = path(points);
    el('path', { d, class: 'w-case' }, g);
    el('path', { d, class: 'w-core', stroke: color }, g);
    el('path', { d, class: 'w-hit' }, g);
    for (const p of [points[0], points[points.length - 1]]) el('circle', { cx: p[0], cy: p[1], r: 3.2, fill: color, class: 'w-end' }, g);
    const w = { id, g, color, from, to, desc };
    g.addEventListener('pointerenter', (e) => focus(w, e));
    g.addEventListener('pointermove', (e) => placeTip(e));
    g.addEventListener('pointerleave', () => focus(null));
    wires.push(w);
    return w;
  }

  function drawWires() {
    gWires.innerHTML = '';
    gRails.innerHTML = '';
    wires = [];
    const W = board.wiring;
    const hasWifi = board.arch === 'avr';
    parts.wifi.g.style.display = hasWifi ? '' : 'none';
    const pwr = findPin((l) => l === layout.power) || findPin((l) => l === '5V' || l === 'VIN' || l === '3V3');
    const gndTop = findPin((l) => l === 'GND' && true) && [...pinPos.values()].find((p) => p.label === 'GND' && p.side === 'top');
    const gndBot = [...pinPos.values()].find((p) => p.label === 'GND' && p.side === 'bottom');
    const gnd = (side) => (side === 'top' ? gndTop || gndBot : gndBot || gndTop);
    const vName = layout.power;

    // rails
    const rail = (y, color, x1, x2, label) => {
      el('line', { x1, y1: y, x2, y2: y, class: 'rail', stroke: color }, gRails);
      text(gRails, x1 - 8, y + 4, label, 'c-rail', { 'text-anchor': 'end' });
    };
    rail(RAIL.topV, COLORS.vcc, 180, 940, vName);
    rail(RAIL.topG, COLORS.gnd, 180, 940, 'GND');
    rail(RAIL.botG, COLORS.gnd, 180, 790, 'GND');
    rail(RAIL.botV, COLORS.vcc, 180, 790, vName);

    // feed the rails from the board's power pins
    const feed = (pin, railY, color, id, label) => {
      if (!pin) return;
      if (pin.side === 'bottom' && railY > B.y) addWire(id, color, [[pin.x, pin.y], [pin.x, railY]], `${board.id.toUpperCase()} ${pin.label}`, `${label} rail`, `${pin.label} → ${label} rail`);
      else if (pin.side === 'top' && railY < B.y) addWire(id, color, [[pin.x, pin.y], [pin.x, railY]], `${board.id.toUpperCase()} ${pin.label}`, `${label} rail`, `${pin.label} → ${label} rail`);
      else {
        // around the left end of the board
        const lane = B.x - 34 - (id.length % 3) * 8;
        const exitY = pin.side === 'top' ? B.y - 30 : B.y + B.h + 30;
        addWire(id, color, [[pin.x, pin.y], [pin.x, exitY], [lane, exitY], [lane, railY]], `${board.id.toUpperCase()} ${pin.label}`, `${label} rail`, `${pin.label} → ${label} rail`);
      }
    };
    feed(pwr, RAIL.botV, COLORS.vcc, 'v-bot', vName);
    feed(gnd('bottom'), RAIL.botG, COLORS.gnd, 'g-bot', 'GND');
    feed(gnd('top'), RAIL.topG, COLORS.gnd, 'g-top', 'GND');
    // top 5V rail fed from the bottom one around the left side
    addWire('v-link', COLORS.vcc, [[188, RAIL.botV], [188, RAIL.topV]], `${vName} rail (bottom)`, `${vName} rail (top)`, `${vName} rail link`);

    // part power pins to rails
    const toRail = (part, pinName, railY, color, kind) => {
      const p = parts[part].pins[pinName];
      if (!p) return;
      addWire(`${part}-${kind}`, color, [[p.x, p.y], [p.x, railY]], `${PART_INFO[part].name} ${pinName}`, `${kind === 'v' ? vName : 'GND'} rail`, `${PART_INFO[part].name} ${pinName} → ${kind === 'v' ? vName : 'GND'}`);
    };
    for (const k of ['propane', 'methane']) { toRail(k, 'VCC', RAIL.botV, COLORS.vcc, 'v'); toRail(k, 'GND', RAIL.botG, COLORS.gnd, 'g'); }
    toRail('dht', 'VCC', RAIL.botV, COLORS.vcc, 'v');
    toRail('dht', 'GND', RAIL.botG, COLORS.gnd, 'g');
    toRail('pir', 'VCC', RAIL.topV, COLORS.vcc, 'v');
    toRail('pir', 'GND', RAIL.topG, COLORS.gnd, 'g');
    toRail('led', 'K', RAIL.topG, COLORS.gnd, 'g');
    toRail('buzzer', '−', RAIL.topG, COLORS.gnd, 'g');
    toRail('button', '2', RAIL.topG, COLORS.gnd, 'g');
    if (hasWifi) { toRail('wifi', 'VIN', RAIL.topV, COLORS.vcc, 'v'); toRail('wifi', 'GND', RAIL.topG, COLORS.gnd, 'g'); }

    // signal wires
    let laneTop = 0;
    let laneBot = 0;
    let laneSide = 0;
    const signal = (part, key, pinNum, color) => {
      const pp = parts[part].pins[parts[part].signal];
      const bp = pinNum === 'tx' ? findPin((l) => /^TX/.test(l)) : signalPin(pinNum);
      if (!pp || !bp) return;
      const from = `${PART_INFO[part].name} ${parts[part].signal === 'DATA' ? 'SDA' : parts[part].signal}`;
      const to = `${board.name} ${bp.label.replace(/[~←→]/g, '')}`;
      let pts;
      if (pp.side === bp.side) {
        const y = pp.side === 'top' ? LANE.top + (laneTop++ % 6) * 8 : LANE.bot + (laneBot++ % 6) * 8;
        pts = [[pp.x, pp.y], [pp.x, y], [bp.x, y], [bp.x, bp.y]];
      } else {
        // around the right end of the board
        const x = B.x + B.w + 30 + (laneSide++ % 5) * 9;
        const y1 = pp.side === 'top' ? LANE.top + (laneTop++ % 6) * 8 : LANE.bot + (laneBot++ % 6) * 8;
        const y2 = bp.side === 'top' ? LANE.top + (laneTop++ % 6) * 8 : LANE.bot + (laneBot++ % 6) * 8;
        pts = [[pp.x, pp.y], [pp.x, y1], [x, y1], [x, y2], [bp.x, y2], [bp.x, bp.y]];
      }
      const w = addWire(`sig-${key}`, color, pts, from, to, `${from} → ${to}`);
      w.key = key;
    };
    signal('propane', 'propane', W.propane, COLORS.propane);
    signal('methane', 'methane', W.methane, COLORS.methane);
    signal('dht', 'dht', W.dht, COLORS.dht);
    signal('led', 'led', W.led, COLORS.led);
    signal('pir', 'pir', W.pir, COLORS.pir);
    signal('buzzer', 'buzzer', W.buzzer, COLORS.buzzer);
    signal('button', 'button', W.button, COLORS.button);
    if (hasWifi) signal('wifi', 'tx', 'tx', COLORS.tx);

    // connection list (signals first)
    const rows = wires.filter((w) => w.id.startsWith('sig-')).concat(wires.filter((w) => !w.id.startsWith('sig-')));
    list.innerHTML = `<div class="c-list-head">Connections <span>${board.name}</span></div>${rows.map((w) => `<div class="c-row" data-id="${w.id}"><i style="background:${w.color}"></i><span>${w.from}</span><b>→</b><span>${w.to}</span></div>`).join('')}`;
    for (const row of list.querySelectorAll('.c-row')) {
      const w = wires.find((x) => x.id === row.dataset.id);
      row.addEventListener('pointerenter', () => focus(w));
      row.addEventListener('pointerleave', () => focus(null));
    }
  }

  // ---------------------------------------------------------------- focus + tooltip
  function focus(w, e) {
    svg.classList.toggle('dim', !!w);
    for (const x of wires) x.g.classList.toggle('focus', x === w);
    for (const row of list.querySelectorAll('.c-row')) row.classList.toggle('on', w && row.dataset.id === w.id);
    if (w) {
      tip.innerHTML = `<i style="background:${w.color}"></i>${w.desc}`;
      tip.classList.add('show');
      if (e) placeTip(e);
      else { tip.style.left = '12px'; tip.style.top = '12px'; }
    } else tip.classList.remove('show');
  }
  function placeTip(e) {
    const r = host.getBoundingClientRect();
    tip.style.left = `${Math.min(r.width - 240, e.clientX - r.left + 14)}px`;
    tip.style.top = `${e.clientY - r.top + 14}px`;
  }

  // ---------------------------------------------------------------- zoom / pan
  let view = { ...HOME };
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  apply();
  function zoomAt(f, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    const nw = Math.max(VB.w / 8, Math.min(VB.w * 1.2, view.w / f));
    const k = nw / view.w;
    view = { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w: nw, h: view.h * k };
    apply();
  }
  const toSvg = (e) => {
    const r = svg.getBoundingClientRect();
    // viewBox is letterboxed with preserveAspectRatio meet: compute the scale
    const s = Math.max(view.w / r.width, view.h / r.height);
    const ox = (r.width - view.w / s) / 2;
    const oy = (r.height - view.h / s) / 2;
    return [view.x + (e.clientX - r.left - ox) * s, view.y + (e.clientY - r.top - oy) * s, s];
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = toSvg(e);
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, x, y);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.button-part')) return;
    drag = { x: e.clientX, y: e.clientY, view: { ...view } };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('grabbing');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [, , s] = toSvg(e);
    view = { ...drag.view, x: drag.view.x - (e.clientX - drag.x) * s, y: drag.view.y - (e.clientY - drag.y) * s };
    apply();
  });
  const endDrag = () => { drag = null; svg.classList.remove('grabbing'); };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  ui.addEventListener('click', (e) => {
    const z = e.target.closest('button')?.dataset.z;
    if (z === 'in') zoomAt(1.4);
    if (z === 'out') zoomAt(1 / 1.4);
    if (z === 'fit') { view = { ...HOME }; apply(); }
    if (z === 'list') { list.hidden = !list.hidden; e.target.classList.toggle('on', !list.hidden); }
  });

  function setBoard(b) {
    board = b;
    layout = BOARDS[b.id] || BOARDS.uno;
    drawBoard();
    drawWires();
  }

  let txUntil = 0;
  return {
    setBoard,
    serialActivity() { txUntil = performance.now() + 120; },
    update(s) {
      boardLeds.onLed?.setAttribute('fill', s.running ? '#3ee05a' : '#e9ecee');
      boardLeds.lLed?.setAttribute('fill', s.pinValue(board.ledBuiltin) ? '#ffc21a' : '#e9ecee');
      boardLeds.txLed?.setAttribute('fill', performance.now() < txUntil ? '#ffc21a' : '#e9ecee');
      parts.led.lens.setAttribute('fill', s.led > 0.05 ? '#ef4444' : '#7f1d1d');
      parts.buzzer.waves.classList.toggle('on', s.buzzer);
      for (const k of ['propane', 'methane']) {
        parts[k].pwr.setAttribute('fill', s.running ? '#ef4444' : '#3a1010');
        parts[k].val.textContent = `ADC ${s.adc[k]}`;
      }
      parts.dht.val.textContent = `${s.sensors.temperature.toFixed(1)} °C`;
      parts.wifi.tx.setAttribute('fill', performance.now() < txUntil ? '#ffd23a' : '#2a1f06');
      for (const w of wires) {
        if (!w.key) continue;
        const on = w.key === 'tx' ? performance.now() < txUntil : ['led', 'buzzer'].includes(w.key) && s.pinValue(board.wiring[w.key]) > 0;
        w.g.classList.toggle('active', !!on);
      }
    },
  };
}
