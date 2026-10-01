// Live wiring diagram of the NAFAS unit (Wokwi-style): the board, the two gas
// sensors, DHT22, LED, buzzer, PIR, push button and — on AVR boards — the
// ESP32 Wi-Fi module on the serial line. Parts react to the running sketch.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

const LAYOUT = {
  uno: {
    x: 318, y: 40, w: 190, h: 330, color: '#1b5e8c', title: 'ARDUINO UNO',
    left: ['IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'Vin', null, 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    right: ['AREF', 'GND', '13', '12', '~11', '~10', '~9', '8', null, '7', '~6', '~5', '4', '~3', '2', 'TX→1', 'RX←0'],
  },
  nano: {
    x: 352, y: 50, w: 120, h: 300, color: '#20507a', title: 'NANO',
    left: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
    right: ['D13', '3V3', 'REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
  },
  esp32: {
    x: 345, y: 40, w: 140, h: 330, color: '#15181b', title: 'ESP32',
    left: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'GND', 'D13', 'VIN'],
    right: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'D17', 'D16', 'D4', 'D0', 'D2', 'D15', 'GND', '3V3'],
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

export function createCircuit(host, { onButton } = {}) {
  const svg = el('svg', { viewBox: '0 0 730 460', class: 'circuit-svg', role: 'img', 'aria-label': 'NAFAS Nano wiring diagram' });
  host.appendChild(svg);
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".45"/></filter>
    <radialGradient id="mesh" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#e4e7ea"/><stop offset=".7" stop-color="#9aa2a8"/><stop offset="1" stop-color="#5d666c"/></radialGradient>
    <pattern id="meshDots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.1" fill="#4a5258"/></pattern>
    <radialGradient id="dome" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9cfd4"/></radialGradient>`;
  const gWires = el('g', { class: 'wires' }, svg);
  const gBoard = el('g', {}, svg);
  const gParts = el('g', {}, svg);

  let board = null;
  let layout = null;
  const pinPos = new Map(); // label -> {x,y,side}
  const parts = {};
  const wires = [];

  // ---------- parts (fixed positions) ----------
  function label(g, x, y, text, cls = 'c-label') {
    const t = el('text', { x, y, class: cls, 'text-anchor': 'middle' }, g);
    t.textContent = text;
    return t;
  }
  function pinDot(g, x, y) { el('rect', { x: x - 2.5, y: y - 1, width: 5, height: 9, rx: 1, fill: '#c9b36a' }, g); }

  function gasModule(key, x, y, name, sub) {
    const g = el('g', { class: 'part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    el('rect', { x: 0, y: 0, width: 84, height: 76, rx: 6, fill: '#155d8b', stroke: '#0e4466' }, g);
    el('circle', { cx: 42, cy: 34, r: 24, fill: '#b87333' }, g);
    el('circle', { cx: 42, cy: 34, r: 19, fill: 'url(#mesh)' }, g);
    el('circle', { cx: 42, cy: 34, r: 19, fill: 'url(#meshDots)', opacity: 0.55 }, g);
    const pwr = el('circle', { cx: 10, cy: 10, r: 3, fill: '#3a1010' }, g);
    for (const [i, t] of ['VCC', 'GND', 'AO'].entries()) {
      label(g, 22 + i * 20, 70, t, 'c-pin');
      pinDot(g, 22 + i * 20, 76);
    }
    label(g, 42, 104, name, 'c-name');
    const val = label(g, 42, 119, sub, 'c-val');
    parts[key] = { g, pwr, val, pins: { VCC: [x + 22, y + 84], GND: [x + 42, y + 84], OUT: [x + 62, y + 84] } };
  }
  gasModule('propane', 18, 64, 'MQ-2', '');
  gasModule('methane', 118, 64, 'MQ-4', '');

  (() => {
    const x = 222;
    const y = 40;
    const g = el('g', { class: 'part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    el('rect', { x: 0, y: 0, width: 62, height: 92, rx: 5, fill: '#f4f5f6' }, g);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) el('rect', { x: 9 + c * 12, y: 9 + r * 11, width: 8, height: 6, rx: 1, fill: '#aeb5bb' }, g);
    label(g, 31, 84, 'DHT22', 'c-mark');
    for (let i = 0; i < 4; i++) pinDot(g, 13 + i * 12, 92);
    label(g, 31, 128, 'DHT22', 'c-name');
    const val = label(g, 31, 143, '', 'c-val');
    parts.dht = { g, val, pins: { VCC: [x + 13, y + 100], OUT: [x + 25, y + 100], GND: [x + 49, y + 100] } };
  })();

  (() => {
    const x = 572;
    const y = 16;
    const g = el('g', { class: 'part', transform: `translate(${x},${y})` }, gParts);
    const halo = el('circle', { cx: 14, cy: 16, r: 22, fill: '#ff3030', filter: 'url(#glow)', opacity: 0 }, g);
    el('path', { d: 'M4 30 V14 a10 10 0 0 1 20 0 V30 Z', fill: '#8a1c1c', stroke: '#5a0f0f' }, g);
    const lens = el('path', { d: 'M6 28 V14 a8 8 0 0 1 16 0 V28 Z', fill: '#c0392b' }, g);
    el('rect', { x: 2, y: 30, width: 24, height: 4, rx: 1, fill: '#9e2a22' }, g);
    el('line', { x1: 9, y1: 34, x2: 9, y2: 58, stroke: '#b9bec2', 'stroke-width': 2 }, g);
    el('line', { x1: 19, y1: 34, x2: 19, y2: 52, stroke: '#b9bec2', 'stroke-width': 2 }, g);
    label(g, 14, 80, 'LED', 'c-name');
    parts.led = { g, halo, lens, pins: { OUT: [x + 9, y + 58], GND: [x + 19, y + 52] } };
  })();

  (() => {
    const x = 632;
    const y = 20;
    const g = el('g', { class: 'part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    const waves = el('g', { class: 'bz-waves' }, g);
    for (let i = 0; i < 3; i++) el('path', { d: `M${50 + i * 8} ${6 - i * 2} q${10 + i * 3} ${14 + i * 2} 0 ${28 + i * 4}`, fill: 'none', stroke: '#c6f432', 'stroke-width': 2, 'stroke-linecap': 'round', style: `animation-delay:${i * 0.12}s` }, waves);
    el('circle', { cx: 24, cy: 22, r: 22, fill: '#1c1f22', stroke: '#33393d', 'stroke-width': 2 }, g);
    el('circle', { cx: 24, cy: 22, r: 5, fill: '#0b0d0e' }, g);
    label(g, 24, 26, '', 'c-mark');
    el('line', { x1: 16, y1: 44, x2: 16, y2: 58, stroke: '#b9bec2', 'stroke-width': 2 }, g);
    el('line', { x1: 32, y1: 44, x2: 32, y2: 58, stroke: '#b9bec2', 'stroke-width': 2 }, g);
    label(g, 24, 76, 'Buzzer', 'c-name');
    parts.buzzer = { g, waves, pins: { OUT: [x + 16, y + 58], GND: [x + 32, y + 58] } };
  })();

  (() => {
    const x = 590;
    const y = 132;
    const g = el('g', { class: 'part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    el('rect', { x: 0, y: 0, width: 92, height: 70, rx: 5, fill: '#1c4f86' }, g);
    const glow = el('circle', { cx: 46, cy: 32, r: 32, fill: '#c6f432', filter: 'url(#glow)', opacity: 0 }, g);
    el('circle', { cx: 46, cy: 32, r: 26, fill: 'url(#dome)' }, g);
    for (let r = 0; r < 3; r++) el('circle', { cx: 46, cy: 32, r: 8 + r * 7, fill: 'none', stroke: '#b4bcc2', 'stroke-width': 0.8 }, g);
    for (const [i, t] of ['+', 'D', '−'].entries()) { label(g, 30 + i * 16, 68, t, 'c-pin'); pinDot(g, 30 + i * 16, 70); }
    label(g, 46, 100, 'PIR', 'c-name');
    parts.pir = { g, glow, pins: { VCC: [x + 30, y + 78], OUT: [x + 46, y + 78], GND: [x + 62, y + 78] } };
  })();

  (() => {
    const x = 150;
    const y = 360;
    const g = el('g', { class: 'part button-part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    el('rect', { x: 0, y: 0, width: 52, height: 44, rx: 4, fill: '#e6e8ea' }, g);
    const cap = el('circle', { cx: 26, cy: 22, r: 14, fill: '#1f8a3b', stroke: '#156b2c', 'stroke-width': 2 }, g);
    for (const [px, py] of [[-6, 10], [-6, 34], [52, 10], [52, 34]]) el('rect', { x: px, y: py - 2, width: 6, height: 4, fill: '#b9bec2' }, g);
    label(g, 26, 66, 'Button · press', 'c-name');
    parts.button = { g, cap, pins: { OUT: [x + 58, y + 10], GND: [x + 58, y + 34] } };
    const press = (v) => (e) => {
      e.preventDefault();
      cap.setAttribute('r', v ? 12 : 14);
      cap.setAttribute('fill', v ? '#156b2c' : '#1f8a3b');
      onButton?.(v);
    };
    g.addEventListener('pointerdown', press(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) g.addEventListener(ev, press(false));
  })();

  (() => {
    const x = 600;
    const y = 262;
    const g = el('g', { class: 'part', transform: `translate(${x},${y})`, filter: 'url(#soft)' }, gParts);
    el('rect', { x: 0, y: 0, width: 110, height: 150, rx: 8, fill: '#16191c', stroke: '#2a2f33' }, g);
    el('rect', { x: 20, y: 56, width: 70, height: 70, rx: 3, fill: '#aeb4b9' }, g);
    el('rect', { x: 26, y: 62, width: 58, height: 58, rx: 2, fill: '#c7ccd0' }, g);
    el('path', { d: 'M22 24 h66 v26 h-66 z M30 30 h10 v14 h-10 z M50 30 h10 v14 h-10 z M70 30 h10 v14 h-10z', fill: '#b9975b', 'fill-rule': 'evenodd' }, g);
    label(g, 55, 95, 'ESP32', 'c-mark dark');
    const tx = el('circle', { cx: 14, cy: 138, r: 3.5, fill: '#2a1f06' }, g);
    label(g, 55, 168, 'ESP32 Wi-Fi', 'c-name');
    parts.wifi = { g, tx, pins: { RX: [x, y + 120] } };
  })();

  // ---------- board ----------
  function drawBoard() {
    gBoard.innerHTML = '';
    pinPos.clear();
    const L = layout;
    const g = el('g', { filter: 'url(#soft)' }, gBoard);
    el('rect', { x: L.x, y: L.y, width: L.w, height: L.h, rx: 10, fill: L.color, stroke: '#0a2a40' }, g);
    // headers
    const pitch = 17.5;
    const colTop = L.y + 22;
    const drawCol = (labels, side) => {
      const hx = side === 'l' ? L.x + 12 : L.x + L.w - 24;
      el('rect', { x: hx, y: colTop - 8, width: 12, height: labels.length * pitch + 4, rx: 2, fill: '#101214' }, g);
      labels.forEach((lab, i) => {
        if (!lab) return;
        const py = colTop + i * pitch;
        el('rect', { x: hx + 3, y: py - 3, width: 6, height: 6, fill: '#3a3f44' }, g);
        const t = el('text', { x: side === 'l' ? hx + 18 : hx - 6, y: py + 3.5, class: 'c-board', 'text-anchor': side === 'l' ? 'start' : 'end' }, g);
        t.textContent = lab;
        pinPos.set(lab, { x: side === 'l' ? hx : hx + 12, y: py, side });
      });
    };
    drawCol(L.left, 'l');
    drawCol(L.right, 'r');
    // chip + logo
    if (board.arch === 'avr') {
      el('rect', { x: L.x + L.w / 2 - 20, y: L.y + L.h * 0.45, width: 40, height: 120, rx: 3, fill: '#15171a' }, g);
      el('circle', { cx: L.x + L.w / 2, cy: L.y + L.h * 0.22, r: 22, fill: 'none', stroke: '#e8f1f7', 'stroke-width': 3 }, g);
      const t = el('text', { x: L.x + L.w / 2, y: L.y + L.h * 0.22 + 42, class: 'c-board big', 'text-anchor': 'middle' }, g);
      t.textContent = layout.title;
      el('rect', { x: L.x + L.w / 2 - 22, y: L.y - 12, width: 44, height: 30, rx: 3, fill: '#b9bec2' }, g); // USB
    } else {
      el('rect', { x: L.x + 22, y: L.y + 40, width: L.w - 44, height: 110, rx: 3, fill: '#aeb4b9' }, g);
      const t = el('text', { x: L.x + L.w / 2, y: L.y + 100, class: 'c-mark dark', 'text-anchor': 'middle' }, g);
      t.textContent = 'ESP32-WROOM';
      el('rect', { x: L.x + L.w / 2 - 14, y: L.y + L.h - 16, width: 28, height: 22, rx: 3, fill: '#b9bec2' }, g);
    }
    const onLed = el('circle', { cx: L.x + L.w - 44, cy: L.y + 14, r: 3.5, fill: '#08300f' }, g);
    const lLed = el('circle', { cx: L.x + L.w - 58, cy: L.y + 14, r: 3.5, fill: '#3a2606' }, g);
    boardLeds = { onLed, lLed };
  }
  let boardLeds = {};

  function findLabel(pin) {
    for (const lab of [...layout.left, ...layout.right]) if (lab && labelToPin(lab) === pin && !/^(GND|5V|3V3|3\.3V|Vin|VIN|RST|RESET|EN|IOREF|AREF|REF)$/.test(lab)) return lab;
    return null;
  }

  // ---------- wiring ----------
  function drawWires() {
    gWires.innerHTML = '';
    wires.length = 0;
    const L = layout;
    const W = board.wiring;
    const pwrLabel = layout.left.includes('5V') ? '5V' : layout.right.includes('5V') ? '5V' : '3V3';
    const gndLabel = 'GND';
    let laneBelow = 0;
    const route = (from, lab, color, key, part) => {
      const p = pinPos.get(lab) || [...pinPos.entries()].find(([k]) => k === lab)?.[1];
      if (!p) return;
      const [fx, fy] = from;
      const partLeft = fx < L.x;
      const onLeft = p.side === 'l';
      const idx = wires.length;
      const approachX = onLeft ? p.x - 14 - (idx % 9) * 5 : p.x + 14 + (idx % 9) * 5;
      let d;
      const cross = (partLeft && !onLeft) || (!partLeft && onLeft && fx > L.x + L.w);
      if (cross) {
        const yl = L.y + L.h + 26 + (laneBelow++) * 6;
        d = `M${fx} ${fy} V${yl} H${approachX} V${p.y} H${p.x}`;
      } else {
        const yl = fy < p.y ? Math.min(Math.max(fy + 10 + (idx % 6) * 4, fy + 8), p.y) : fy + 10 + (idx % 6) * 4;
        d = `M${fx} ${fy} V${yl} H${approachX} V${p.y} H${p.x}`;
      }
      const path = el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'wire' }, gWires);
      wires.push({ path, key, part });
    };
    const findPwr = () => (pinPos.has(pwrLabel) ? pwrLabel : '3V3');
    const signal = (part, key) => {
      const lab = findLabel(W[key]);
      if (lab) route(parts[part].pins.OUT, lab, '#2e9d4a', key, part);
    };
    for (const [part, key] of [['propane', 'propane'], ['methane', 'methane'], ['dht', 'dht'], ['led', 'led'], ['buzzer', 'buzzer'], ['pir', 'pir'], ['button', 'button']]) {
      signal(part, key);
      if (parts[part].pins.VCC) route(parts[part].pins.VCC, findPwr(), '#e53935', null, part);
      if (parts[part].pins.GND) route(parts[part].pins.GND, gndLabel, '#0b0b0b', null, part);
    }
    const wifi = board.arch === 'avr';
    parts.wifi.g.style.display = wifi ? '' : 'none';
    if (wifi) {
      const tx = pinPos.has('TX→1') ? 'TX→1' : 'TX1';
      route(parts.wifi.pins.RX, tx, '#3b6cff', 'tx', 'wifi');
    }
  }

  function setBoard(b) {
    board = b;
    layout = LAYOUT[b.id] || LAYOUT.uno;
    drawBoard();
    drawWires();
    // TX1 label differs per layout; the helper maps both.
  }

  let txUntil = 0;
  return {
    setBoard,
    serialActivity() { txUntil = performance.now() + 120; },
    // s: { running, pin(key)->{value,pwm,tone,mode}, buzzer, led, sensors:{...}, adc:{propane,methane} }
    update(s) {
      boardLeds.onLed?.setAttribute('fill', s.running ? '#39ff6a' : '#08300f');
      const p13 = s.pinValue(13);
      boardLeds.lLed?.setAttribute('fill', p13 ? '#ffb020' : '#3a2606');
      parts.led.halo.setAttribute('opacity', (s.led * 0.9).toFixed(2));
      parts.led.lens.setAttribute('fill', s.led > 0.05 ? '#ff4a3a' : '#8e2a22');
      parts.buzzer.waves.classList.toggle('on', s.buzzer);
      parts.pir.glow.setAttribute('opacity', s.motion ? 0.55 : 0);
      for (const k of ['propane', 'methane']) {
        parts[k].pwr.setAttribute('fill', s.running ? '#ff4040' : '#3a1010');
        parts[k].val.textContent = `ADC ${s.adc[k]}`;
      }
      parts.dht.val.textContent = `${s.sensors.temperature.toFixed(1)}°C`;
      parts.wifi.tx.setAttribute('fill', performance.now() < txUntil ? '#ffd23a' : '#2a1f06');
      for (const w of wires) {
        if (!w.key) continue;
        const hot = w.key === 'tx' ? performance.now() < txUntil : s.pinValue(board.wiring[w.key]) > 0 && ['led', 'buzzer'].includes(w.key);
        w.path.classList.toggle('hot', !!hot);
      }
    },
  };
}
