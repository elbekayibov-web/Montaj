// Comment stripping, a tiny preprocessor (#include / #define / #ifdef) and the
// tokenizer for the Arduino C++ subset.

export class CompileError extends Error {
  constructor(line, col, message, hint) {
    super(message);
    this.line = line;
    this.col = col;
    this.hint = hint;
  }
}

// Libraries a sketch may include. Anything else is a "No such file" error,
// exactly like the real IDE when a library is not installed.
export const KNOWN_LIBS = {
  'Arduino.h': {},
  'math.h': {},
  'Wire.h': {},
  'SPI.h': {},
  'DHT.h': { classes: ['DHT'], constants: { DHT11: 11, DHT12: 12, DHT21: 21, DHT22: 22, AM2301: 21 } },
  'DHT_U.h': { classes: ['DHT'], constants: { DHT11: 11, DHT12: 12, DHT21: 21, DHT22: 22, AM2301: 21 } },
};

const PUNCT = [
  '<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.',
  '(', ')', '[', ']', '{', '}',
];

// Replace comments with spaces so that line/column positions stay intact.
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (j) => { if (out[j] !== '\n') out[j] = ' '; };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const startLine = lineOf(src, i);
      const startCol = colOf(src, i);
      blank(i++); blank(i++);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) blank(i++);
      if (i >= n) throw new CompileError(startLine, startCol, 'unterminated comment', 'Izoh /* ... */ yopilmagan — oxiriga */ qo‘ying.');
      blank(i++); blank(i++);
      continue;
    }
    i++;
  }
  return out.join('');
}

function lineOf(src, idx) {
  let l = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') l++;
  return l;
}
function colOf(src, idx) {
  let c = 1;
  for (let i = idx - 1; i >= 0 && src[i] !== '\n'; i--) c++;
  return c;
}

// Handles preprocessor lines. Returns { text, includes, macros, warnings } where
// directive lines are blanked out.
export function preprocess(src) {
  const lines = src.split('\n');
  const includes = [];
  const macros = new Map();
  const cond = []; // stack of {active, taken}
  const isActive = () => cond.every((c) => c.active);
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const trimmed = raw.trimStart();
    const lineNo = li + 1;
    const indent = raw.length - trimmed.length;
    if (!trimmed.startsWith('#')) {
      if (!isActive()) lines[li] = ' '.repeat(raw.length);
      continue;
    }
    // Join continuation lines of a directive.
    let body = trimmed.slice(1).trim();
    while (body.endsWith('\\') && li + 1 < lines.length) {
      lines[li] = ' '.repeat(lines[li].length);
      li++;
      body = body.slice(0, -1) + ' ' + lines[li].trim();
    }
    lines[li] = ' '.repeat(lines[li].length);
    const m = body.match(/^(\w+)\s*(.*)$/);
    if (!m) continue;
    const [, dir, rest] = m;
    const dcol = indent + 2;
    if (dir === 'ifdef' || dir === 'ifndef') {
      const name = rest.trim().split(/\s+/)[0];
      const defined = macros.has(name) || name === 'ARDUINO';
      cond.push({ active: dir === 'ifdef' ? defined : !defined, taken: false });
      cond[cond.length - 1].taken = cond[cond.length - 1].active;
      continue;
    }
    if (dir === 'if') {
      cond.push({ active: true, taken: true });
      continue;
    }
    if (dir === 'else' || dir === 'elif') {
      const top = cond[cond.length - 1];
      if (!top) throw new CompileError(lineNo, dcol, `#${dir} without #if`);
      top.active = !top.taken;
      top.taken = true;
      continue;
    }
    if (dir === 'endif') {
      if (!cond.length) throw new CompileError(lineNo, dcol, '#endif without #if');
      cond.pop();
      continue;
    }
    if (!isActive()) continue;
    if (dir === 'include') {
      const im = rest.match(/^[<"]([^>"]+)[>"]/);
      if (!im) throw new CompileError(lineNo, dcol + 8, '#include expects "FILENAME" or <FILENAME>');
      const lib = im[1];
      if (!KNOWN_LIBS[lib]) {
        throw new CompileError(lineNo, indent + 10, `${lib}: No such file or directory`,
          `“${lib}” kutubxonasi simulyatorda yo‘q. Mavjudlari: DHT.h, Wire.h, SPI.h, math.h.`);
      }
      includes.push({ lib, line: lineNo });
      continue;
    }
    if (dir === 'define') {
      const dm = rest.match(/^([A-Za-z_]\w*)(\()?\s*(.*)$/);
      if (!dm) throw new CompileError(lineNo, dcol + 7, 'macro names must be identifiers');
      if (dm[2]) {
        throw new CompileError(lineNo, dcol + 7, `function-like macro '${dm[1]}' is not supported`,
          'Simulyator faqat oddiy #define NOM qiymat ko‘rinishini qo‘llaydi. Buning o‘rniga funksiya yozing.');
      }
      const valueCol = raw.indexOf(dm[3]) + 1 || dcol;
      macros.set(dm[1], { text: dm[3], line: lineNo, col: valueCol });
      continue;
    }
    if (dir === 'undef') {
      macros.delete(rest.trim());
      continue;
    }
    if (dir === 'pragma' || dir === 'error' || dir === 'warning' || dir === 'line') {
      if (dir === 'error') throw new CompileError(lineNo, dcol, `#error ${rest}`);
      continue;
    }
    throw new CompileError(lineNo, dcol, `invalid preprocessing directive #${dir}`);
  }
  if (cond.length) throw new CompileError(lines.length, 1, 'unterminated #if');
  return { text: lines.join('\n'), includes, macros };
}

const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

function readEscape(src, i) {
  // src[i] === '\\'
  const c = src[i + 1];
  if (c === 'x') {
    const m = src.slice(i + 2).match(/^[0-9a-fA-F]{1,2}/);
    if (m) return { code: parseInt(m[0], 16), len: 2 + m[0].length };
  }
  if (/[0-7]/.test(c) && c !== '0') {
    const m = src.slice(i + 1).match(/^[0-7]{1,3}/);
    return { code: parseInt(m[0], 8), len: 1 + m[0].length };
  }
  if (c in ESC) return { code: ESC[c], len: 2 };
  return { code: c ? c.charCodeAt(0) : 92, len: 2 };
}

export function tokenize(src, startLine = 1, startCol = 1) {
  const toks = [];
  let i = 0;
  let line = startLine;
  let col = startCol;
  const n = src.length;
  const adv = (k) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { adv(1); continue; }
    const tl = line;
    const tc = col;
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_]\w*/);
      toks.push({ t: 'id', v: m[0], line: tl, col: tc, end: tc + m[0].length });
      adv(m[0].length);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)(\w*)/);
      if (m[3]) {
        throw new CompileError(tl, tc, `invalid suffix "${m[3]}" on integer constant`,
          'Son noto‘g‘ri yozilgan — son va harf orasida bo‘sh joy yoki operator qolib ketgan bo‘lishi mumkin.');
      }
      const raw = m[1];
      const suf = m[2].toLowerCase();
      let v;
      let isFloat = false;
      if (/^0[xX]/.test(raw)) v = parseInt(raw.slice(2), 16);
      else if (/^0[bB]/.test(raw)) v = parseInt(raw.slice(2), 2);
      else if (/[.eE]/.test(raw) || suf.includes('f')) { v = parseFloat(raw); isFloat = true; }
      else if (/^0\d/.test(raw)) v = parseInt(raw, 8);
      else v = parseInt(raw, 10);
      toks.push({
        t: 'num', v, isFloat, hex: /^0[xXbB]/.test(raw) || /^0\d/.test(raw),
        unsigned: suf.includes('u'), long: (suf.match(/l/g) || []).length,
        line: tl, col: tc, end: tc + m[0].length, raw: m[0],
      });
      adv(m[0].length);
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\n') throw new CompileError(tl, tc, 'missing terminating " character', 'Qo‘shtirnoq (") yopilmagan.');
        if (src[j] === '\\') {
          const e = readEscape(src, j);
          s += String.fromCharCode(e.code);
          j += e.len;
        } else s += src[j++];
      }
      if (j >= n) throw new CompileError(tl, tc, 'missing terminating " character', 'Qo‘shtirnoq (") yopilmagan.');
      toks.push({ t: 'str', v: s, line: tl, col: tc, end: tc + (j + 1 - i) });
      adv(j + 1 - i);
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let code;
      if (src[j] === '\\') {
        const e = readEscape(src, j);
        code = e.code;
        j += e.len;
      } else if (src[j] === "'" || src[j] === '\n' || j >= n) {
        throw new CompileError(tl, tc, src[j] === "'" ? 'empty character constant' : "missing terminating ' character");
      } else {
        code = src.charCodeAt(j);
        j++;
      }
      if (src[j] !== "'") {
        // Multi-char constant or a string written with single quotes.
        const close = src.indexOf("'", j);
        const nl = src.indexOf('\n', j);
        if (close === -1 || (nl !== -1 && nl < close)) {
          throw new CompileError(tl, tc, "missing terminating ' character", 'Bitta tirnoq (\') yopilmagan. Matn uchun qo‘shtirnoq (") ishlating.');
        }
        throw new CompileError(tl, tc, 'character constant too long for its type',
          'Bitta tirnoq ichida faqat bitta belgi bo‘ladi. Matn uchun qo‘shtirnoq (") ishlating.');
      }
      toks.push({ t: 'chr', v: code, line: tl, col: tc, end: tc + (j + 1 - i) });
      adv(j + 1 - i);
      continue;
    }
    const p = PUNCT.find((pp) => src.startsWith(pp, i));
    if (p) {
      toks.push({ t: 'op', v: p, line: tl, col: tc, end: tc + p.length });
      adv(p.length);
      continue;
    }
    if (c === '#') throw new CompileError(tl, tc, "stray '#' in program", 'Preprotsessor buyrug‘i (#include, #define) qator boshida bo‘lishi kerak.');
    const code = c.charCodeAt(0);
    if (code > 127) {
      const hint = /[“”‘’]/.test(c)
        ? 'Word/Telegramdan ko‘chirilgan “chiroyli” qo‘shtirnoq. Oddiy " yoki \' bilan almashtiring.'
        : 'Kodda lotin bo‘lmagan belgi bor (masalan, kirill harfi yoki maxsus belgi).';
      throw new CompileError(tl, tc, `stray '\\${code.toString(8)}' in program`, hint);
    }
    throw new CompileError(tl, tc, `stray '${c}' in program`);
  }
  toks.push({ t: 'eof', v: '', line, col, end: col });
  return toks;
}

// Expand object-like macros; tokens take the position of the usage site.
export function expandMacros(toks, macros) {
  if (!macros.size) return toks;
  const cache = new Map();
  const bodyToks = (name) => {
    if (!cache.has(name)) {
      const m = macros.get(name);
      const t = tokenize(m.text, m.line, m.col);
      t.pop();
      cache.set(name, t);
    }
    return cache.get(name);
  };
  const out = [];
  const expand = (tok, depth, seen) => {
    if (tok.t === 'id' && macros.has(tok.v) && !seen.has(tok.v) && depth < 32) {
      const next = new Set(seen).add(tok.v);
      for (const bt of bodyToks(tok.v)) {
        expand({ ...bt, line: tok.line, col: tok.col, end: tok.end, macro: tok.v }, depth + 1, next);
      }
    } else out.push(tok);
  };
  for (const t of toks) expand(t, 0, new Set());
  return out;
}
