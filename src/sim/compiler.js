// Semantic checks + code generation: Arduino C++ AST -> async JavaScript.
//
// The generated program keeps C semantics that students actually run into:
// 16-bit int overflow on AVR boards, integer division, float printing with two
// decimals, "text" + number being pointer arithmetic, forgotten pinMode, etc.

import { CompileError, KNOWN_LIBS, stripComments, preprocess, tokenize, expandMacros } from './lexer.js';
import { Parser } from './parser.js';

const T = {
  void: { k: 'void' },
  bool: { k: 'bool' },
  float: { k: 'float' },
  str: { k: 'str' },
  lit: { k: 'lit' },
  char: { k: 'char' },
};
const I = (bits, u = false) => ({ k: 'int', bits, u });
const isNum = (t) => t.k === 'int' || t.k === 'float' || t.k === 'bool' || t.k === 'char';
const isIntLike = (t) => t.k === 'int' || t.k === 'bool' || t.k === 'char';
const isStrLike = (t) => t.k === 'str' || t.k === 'lit';

function range(t) {
  if (t.k === 'bool') return [0, 1];
  if (t.k === 'char') return [-128, 127];
  if (t.k !== 'int') return null;
  if (t.u) return [0, 2 ** t.bits - 1];
  return [-(2 ** (t.bits - 1)), 2 ** (t.bits - 1) - 1];
}
function castFn(t) {
  if (t.k === 'char') return 'i8';
  return `${t.u ? 'u' : 'i'}${t.bits}`;
}

export function typeName(t, board) {
  switch (t.k) {
    case 'void': return 'void';
    case 'bool': return 'bool';
    case 'float': return 'float';
    case 'str': return 'String';
    case 'lit': return 'const char*';
    case 'char': return 'char';
    case 'cls': return t.name;
    case 'arr': return `${typeName(t.of, board)} [${t.dims.map((d) => d ?? '').join('][')}]`;
    case 'int': {
      const ib = board?.intBits ?? 16;
      if (t.bits === 8) return t.u ? 'byte {aka unsigned char}' : 'signed char';
      if (t.bits === ib) return t.u ? 'unsigned int' : 'int';
      if (t.bits === 16) return t.u ? 'short unsigned int' : 'short int';
      if (t.bits === 32) return t.u ? 'long unsigned int' : 'long int';
      return t.u ? 'long long unsigned int' : 'long long int';
    }
    default: return '?';
  }
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}
function suggest(name, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c === name) continue;
    if (c.toLowerCase() === name.toLowerCase()) return c;
    const dist = levenshtein(name, c);
    if (dist < bestD) { bestD = dist; best = c; }
  }
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
  return bestD <= limit ? best : null;
}

class Scope {
  constructor(parent, kind = 'block') {
    this.parent = parent;
    this.kind = kind;
    this.vars = new Map();
  }
  lookup(name) {
    for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    return null;
  }
  names() {
    const out = [];
    for (let s = this; s; s = s.parent) out.push(...s.vars.keys());
    return out;
  }
}

// ---------------------------------------------------------------------------

export function compile(source, board) {
  const warnings = [];
  const cleaned = stripComments(source);
  const pre = preprocess(cleaned);
  const libConsts = {};
  const classNames = new Set();
  for (const inc of pre.includes) {
    const lib = KNOWN_LIBS[inc.lib];
    for (const c of lib.classes || []) classNames.add(c);
    Object.assign(libConsts, lib.constants || {});
  }
  const tokens = expandMacros(tokenize(pre.text), pre.macros);
  const ast = new Parser(tokens, classNames).parseProgram();
  const gen = new Gen(board, libConsts, classNames, warnings, source);
  const js = gen.program(ast);
  const stats = gen.stats(source);
  return { js, warnings, stats, usesDHT: classNames.has('DHT') };
}

class Gen {
  constructor(board, libConsts, classNames, warnings, source) {
    this.board = board;
    this.libConsts = libConsts;
    this.classNames = classNames;
    this.warnings = warnings;
    this.source = source;
    this.global = new Scope(null, 'global');
    this.funcs = new Map();
    this.statics = [];
    this.globalBytes = 0;
    this.stringBytes = 0;
    this.fn = null; // current function context
    this.loopDepth = 0;
    this.switchDepth = 0;
    this.builtins = makeBuiltins(board);
    this.constants = makeConstants(board, libConsts);
  }

  err(node, msg, hint) {
    return new CompileError(node.line, node.col, msg, hint);
  }
  warn(node, msg, flag, hint) {
    this.warnings.push({ line: node.line, col: node.col, msg: flag ? `${msg} [${flag}]` : msg, hint });
  }

  // ---------- types ----------
  resolveType(spec) {
    const w = spec.words;
    const has = (x) => w.includes(x);
    const ib = this.board.intBits;
    const esp = this.board.arch === 'esp32';
    let t;
    if (this.classNames.has(w[0])) t = { k: 'cls', name: w[0] };
    else if (has('void')) t = T.void;
    else if (has('bool') || has('boolean')) t = T.bool;
    else if (has('float') || has('double')) t = T.float;
    else if (has('String')) t = T.str;
    else if (has('char')) t = has('unsigned') ? I(8, true) : has('signed') ? I(8) : T.char;
    else if (has('byte') || has('uint8_t')) t = I(8, true);
    else if (has('int8_t')) t = I(8);
    else if (has('uint16_t')) t = I(16, true);
    else if (has('int16_t')) t = I(16);
    else if (has('uint32_t')) t = I(32, true);
    else if (has('int32_t')) t = I(32);
    else if (has('uint64_t')) t = I(64, true);
    else if (has('int64_t')) t = I(64);
    else if (has('word')) t = I(esp ? 32 : 16, true);
    else if (has('size_t')) t = I(esp ? 32 : 16, true);
    else {
      const longs = w.filter((x) => x === 'long').length;
      const bits = has('short') ? 16 : longs >= 2 ? 64 : longs === 1 ? 32 : ib;
      t = I(bits, has('unsigned'));
    }
    if (spec.ptr) {
      if (spec.ptr === 1 && t.k === 'char') return T.lit;
      throw this.err(spec, 'pointers are not supported by the NAFAS simulator', 'Ko‘rsatkichlar simulyatorda qo‘llab-quvvatlanmaydi. Matn uchun String yoki const char* ishlating.');
    }
    return t;
  }

  sizeOf(t) {
    const esp = this.board.arch === 'esp32';
    switch (t.k) {
      case 'int': return t.bits / 8;
      case 'char': case 'bool': return 1;
      case 'float': return 4;
      case 'str': return esp ? 16 : 6;
      case 'lit': return esp ? 4 : 2;
      case 'cls': return 8;
      case 'arr': return t.dims.reduce((a, d) => a * (d || 0), 1) * this.sizeOf(t.of);
      default: return 1;
    }
  }

  literalType(tok) {
    if (tok.isFloat) return T.float;
    const v = tok.v;
    const ib = this.board.intBits;
    const cands = [];
    if (tok.long >= 2) cands.push(I(64, tok.unsigned));
    else if (tok.long === 1) cands.push(I(32, tok.unsigned), I(64, tok.unsigned));
    else cands.push(I(ib, tok.unsigned));
    if (tok.hex && !tok.unsigned) {
      const expanded = [];
      for (const c of cands) expanded.push(c, I(c.bits, true));
      cands.length = 0;
      cands.push(...expanded);
    }
    if (!tok.long) cands.push(I(32, tok.unsigned), I(64, tok.unsigned));
    for (const c of cands) {
      const [lo, hi] = range(c);
      if (v >= lo && v <= hi) return c;
    }
    return I(64, true);
  }

  promote(t) {
    const ib = this.board.intBits;
    if (t.k === 'bool' || t.k === 'char') return I(ib);
    if (t.k === 'int' && t.bits < ib) return I(ib);
    return t;
  }

  arith(a, b) {
    if (a.k === 'float' || b.k === 'float') return T.float;
    const pa = this.promote(a);
    const pb = this.promote(b);
    if (pa.bits === pb.bits) return I(pa.bits, pa.u || pb.u);
    const [big, small] = pa.bits > pb.bits ? [pa, pb] : [pb, pa];
    if (!big.u && small.u && small.bits >= big.bits) return I(big.bits, true);
    return big;
  }

  // Convert an expression result to a target type. `ctx` selects the gcc wording.
  cast(e, to, node, ctx = 'initialization', explicit = false) {
    const from = e.t;
    const bad = () => this.err(node, `cannot convert '${typeName(from, this.board)}' to '${typeName(to, this.board)}' in ${ctx}`,
      isStrLike(from) && isNum(to)
        ? 'Matnni songa to‘g‘ridan-to‘g‘ri berib bo‘lmaydi. String uchun .toInt() yoki .toFloat() ishlating.'
        : 'Turlar mos kelmaydi.');
    if (from.k === 'arr' || to.k === 'arr') {
      if (from.k === 'arr' && to.k === 'arr') return e.c;
      if (from.k === 'arr' && from.of.k === 'char' && isStrLike(to)) return `__c.chars(${e.c})`;
      throw this.err(node, from.k === 'arr' ? `invalid conversion from '${typeName(from, this.board)}' to '${typeName(to, this.board)}'` : 'invalid array assignment',
        'Massivni bitta o‘zgaruvchiga berib bo‘lmaydi — elementini [indeks] bilan oling.');
    }
    if (to.k === 'void') return e.c;
    if (to.k === 'cls' || from.k === 'cls') {
      if (to.k === 'cls' && from.k === 'cls' && to.name === from.name) return e.c;
      throw bad();
    }
    if (from.k === 'void') throw this.err(node, 'void value not ignored as it ought to be', 'Bu funksiya hech qanday qiymat qaytarmaydi (void).');
    if (to.k === 'float') {
      if (isStrLike(from)) throw bad();
      return e.c;
    }
    if (to.k === 'bool') {
      if (from.k === 'bool') return e.c;
      if (isStrLike(from) && !explicit) throw bad();
      return `((${e.c}) ? 1 : 0)`;
    }
    if (to.k === 'int' || to.k === 'char') {
      if (isStrLike(from)) throw bad();
      if (from.k === 'float') return `__c.${castFn(to)}(${e.c})`;
      if (e.k === 'const' && typeof e.v === 'number') {
        const [lo, hi] = range(to);
        if (e.v >= lo && e.v <= hi) return e.c;
        if (!explicit) this.warn(node, `overflow in conversion from '${typeName(from, this.board)}' to '${typeName(to, this.board)}' changes value`, '-Woverflow',
          `${e.v} soni ${typeName(to, this.board)} turiga sig‘maydi (${lo}…${hi}).`);
        return `__c.${castFn(to)}(${e.c})`;
      }
      const rf = range(from);
      const rt = range(to);
      if (rf && rt && rf[0] >= rt[0] && rf[1] <= rt[1]) return e.c;
      return `__c.${castFn(to)}(${e.c})`;
    }
    if (to.k === 'str') {
      if (from.k === 'str' || from.k === 'lit') return e.c;
      return this.toStr(e);
    }
    if (to.k === 'lit') {
      if (from.k === 'lit') return e.c;
      throw bad();
    }
    return e.c;
  }

  toStr(e) {
    switch (e.t.k) {
      case 'str': case 'lit': return e.c;
      case 'char': return `String.fromCharCode(${e.c} & 255)`;
      case 'float': return `__c.fstr(${e.c}, 2)`;
      case 'bool': return `String((${e.c}) ? 1 : 0)`;
      case 'arr': return `__c.chars(${e.c})`;
      default: return `String(${e.c})`;
    }
  }

  tag(t) {
    switch (t.k) {
      case 'float': return 'f';
      case 'char': return 'c';
      case 'bool': return 'b';
      case 'str': case 'lit': return 's';
      case 'arr': return t.of.k === 'char' ? 'a' : 'x';
      case 'int': return t.u ? 'u' : 'i';
      default: return 'x';
    }
  }

  // ---------- constant evaluation ----------
  constEval(n) {
    switch (n.k) {
      case 'num': return n.tok.v;
      case 'chr': return n.v;
      case 'paren': return this.constEval(n.e);
      case 'id': {
        if (n.name in this.constants) return this.constants[n.name].v;
        const v = this.fn ? this.fn.scope.lookup(n.name) : this.global.lookup(n.name);
        const vv = v || this.global.lookup(n.name);
        return vv && vv.constVal !== undefined ? vv.constVal : undefined;
      }
      case 'un': {
        const v = this.constEval(n.e);
        if (v === undefined) return undefined;
        return n.op === '-' ? -v : n.op === '+' ? v : n.op === '~' ? ~v : +!v;
      }
      case 'bin': {
        const a = this.constEval(n.l);
        const b = this.constEval(n.r);
        if (a === undefined || b === undefined) return undefined;
        switch (n.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': return b ? Math.trunc(a / b) : undefined; case '%': return b ? a % b : undefined;
          case '<<': return a << b; case '>>': return a >> b; case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
          default: return undefined;
        }
      }
      case 'sizeof': return this.sizeofNode(n);
      case 'cast': return this.constEval(n.e);
      default: return undefined;
    }
  }

  sizeofNode(n) {
    if (n.type) return this.sizeOf(this.resolveType(n.type));
    let inner = n.e;
    while (inner.k === 'paren') inner = inner.e;
    if (inner.k === 'str') return inner.v.length + 1;
    const e = this.expr(inner);
    return this.sizeOf(e.t);
  }

  // ---------- program ----------
  program(ast) {
    // Pass 1: function signatures (Arduino generates prototypes automatically).
    for (const d of ast.decls) {
      if (d.k !== 'func') continue;
      const ret = this.resolveType(d.ret);
      const params = d.params.map((p) => {
        let t = this.resolveType(p.type);
        if (p.dims.length) t = { k: 'arr', of: t, dims: p.dims.map(() => null) };
        return { ...p, t };
      });
      if (params.some((p) => p.t.k === 'void')) {
        throw this.err(d, `invalid use of type 'void' in parameter declaration`);
      }
      const prev = this.funcs.get(d.name);
      if (prev) {
        if (prev.hasBody && d.body) {
          throw this.err(d, `redefinition of '${typeName(ret, this.board)} ${d.name}(${params.map((p) => typeName(p.t, this.board)).join(', ')})'`,
            `“${d.name}” funksiyasi ikki marta yozilgan (birinchisi ${prev.line}-qatorda).`);
        }
        if (d.body) Object.assign(prev, { params, ret, hasBody: true, line: d.line, node: d });
        continue;
      }
      if (this.builtins[d.name] && d.body) {
        throw this.err(d, `redefinition of '${d.name}'`, `“${d.name}” — Arduino’ning o‘z funksiyasi. Boshqa nom tanlang.`);
      }
      this.funcs.set(d.name, { name: d.name, js: `$${d.name}`, ret, params, hasBody: !!d.body, line: d.line, node: d });
    }

    const globalDecls = [];
    const initCode = [];
    const funcCode = [];
    this.fn = { name: '__init', temps: 0, scope: this.global, ret: T.void };
    for (const d of ast.decls) {
      if (d.k === 'var') {
        const { decl, init } = this.varDecl(d, this.global, true);
        globalDecls.push(...decl);
        initCode.push(...init);
      }
    }
    const initTemps = this.fn.temps;
    for (const d of ast.decls) {
      if (d.k === 'func' && d.body) funcCode.push(this.func(d));
    }

    for (const need of ['setup', 'loop']) {
      const f = this.funcs.get(need);
      if (!f || !f.hasBody) {
        throw new CompileError(0, 0, `undefined reference to \`${need}'`,
          `Har bir sketchda void ${need}() { ... } funksiyasi bo‘lishi shart. Nomini to‘g‘ri yozganingizni tekshiring (kichik harflar bilan).`);
      }
      if (f.params.length) throw this.err(f.node, `'${need}' must not take parameters`, `${need}() qavslari bo‘sh bo‘lishi kerak.`);
    }
    for (const [name, f] of this.funcs) {
      if (!f.hasBody && f.used) {
        throw new CompileError(f.line, 0, `undefined reference to \`${name}(${f.params.map((p) => typeName(p.t, this.board)).join(', ')})'`,
          `“${name}” funksiyasining faqat e’loni bor, tanasi yozilmagan.`);
      }
    }

    const temps = (n) => (n ? `let ${Array.from({ length: n }, (_, i) => `__t${i}`).join(', ')};` : '');
    return [
      '"use strict";',
      ...globalDecls,
      ...this.statics,
      `async function __init() { ${temps(initTemps)}\n${initCode.join('\n')}\n}`,
      ...funcCode,
      'return { init: __init, setup: $setup, loop: $loop };',
    ].join('\n');
  }

  func(d) {
    const f = this.funcs.get(d.name);
    const scope = new Scope(this.global, 'function');
    this.fn = { name: d.name, temps: 0, scope, ret: f.ret, info: f };
    const params = [];
    const prologue = [];
    for (const p of f.params) {
      if (!p.name) { params.push('_'); continue; }
      const js = `$${p.name}`;
      if (scope.vars.has(p.name)) throw this.err(p, `redefinition of '${typeName(p.t, this.board)} ${p.name}'`);
      scope.vars.set(p.name, { name: p.name, js, t: p.t, isConst: p.type.isConst });
      if (p.def) params.push(`${js} = ${this.cast(this.expr(p.def), p.t, p.def)}`);
      else params.push(js);
    }
    const body = d.body.body.map((s) => this.stmt(s, scope)).join('\n');
    if (f.ret.k !== 'void' && d.name !== 'main' && !this.alwaysReturns(d.body)) {
      this.warn({ line: d.body.line, col: d.body.col }, `no return statement in function returning non-void`, '-Wreturn-type',
        `“${d.name}” ${typeName(f.ret, this.board)} qaytarishi kerak, lekin ba’zi yo‘llarda return yo‘q.`);
    }
    const temps = this.fn.temps ? `let ${Array.from({ length: this.fn.temps }, (_, i) => `__t${i}`).join(', ')};` : '';
    return `async function ${f.js}(${params.join(', ')}) { ${temps}${prologue.join('')}\n${body}\n}`;
  }

  alwaysReturns(s) {
    if (!s) return false;
    if (s.k === 'return') return true;
    if (s.k === 'block') return s.body.some((x) => this.alwaysReturns(x));
    if (s.k === 'if') return this.alwaysReturns(s.then) && this.alwaysReturns(s.other);
    if (s.k === 'while' || s.k === 'for') {
      const c = s.c ? this.constEval(s.c) : 1;
      return c !== undefined && c !== 0;
    }
    return false;
  }

  varDecl(d, scope, isGlobal) {
    const base = this.resolveType(d.type);
    const decl = [];
    const init = [];
    if (base.k === 'void') throw this.err(d.declarators[0], `variable or field '${d.declarators[0].name}' declared void`, 'void — faqat funksiya turi. O‘zgaruvchi uchun int, float va h.k. ishlating.');
    for (const dc of d.declarators) {
      if (scope.vars.has(dc.name)) {
        const prev = scope.vars.get(dc.name);
        throw this.err(dc, `redeclaration of '${typeName(prev.t, this.board)} ${dc.name}'`, `“${dc.name}” shu sohada ${prev.line}-qatorda allaqachon e’lon qilingan.`);
      }
      if (isGlobal && this.funcs.has(dc.name)) {
        throw this.err(dc, `'${typeName(base, this.board)} ${dc.name}' redeclared as different kind of entity`);
      }
      let t = base;
      if (dc.dims.length) {
        const dims = dc.dims.map((de, i) => {
          if (!de) {
            if (i !== 0 || !dc.init) throw this.err(dc, `storage size of '${dc.name}' isn't known`, 'Massiv o‘lchami ko‘rsatilmagan.');
            if (dc.init.k === 'initlist') return dc.init.items.length;
            if (dc.init.k === 'str') return dc.init.v.length + 1;
            return null;
          }
          const v = this.constEval(de);
          if (v === undefined) throw this.err(de, `array bound is not an integer constant before ']' token`, 'Massiv o‘lchami o‘zgarmas son (yoki const) bo‘lishi kerak.');
          if (v <= 0) throw this.err(de, `size of array '${dc.name}' is ${v < 0 ? 'negative' : 'zero'}`);
          return v;
        });
        // char name[] = "text" -> behaves like a string.
        if (base.k === 'char' && dims.length === 1 && dc.init && dc.init.k === 'str') t = T.str;
        else t = { k: 'arr', of: base, dims };
      }
      const js = d.type.isStatic && !isGlobal ? `$$s_${this.fn.name}_${dc.name}` : `$${dc.name}`;
      const entry = { name: dc.name, js, t, isConst: d.type.isConst, line: dc.line };
      let valueCode;
      if (t.k === 'arr') valueCode = this.arrayInit(t, dc.init, dc);
      else if (t.k === 'cls') valueCode = this.construct(t, dc);
      else if (dc.init) {
        if (dc.init.k === 'initlist') {
          if (dc.init.items.length > 1) throw this.err(dc.init, `scalar object '${dc.name}' requires one element in initializer`);
          valueCode = dc.init.items.length ? this.cast(this.expr(dc.init.items[0]), t, dc.init) : this.zero(t);
        } else {
          const e = this.expr(dc.init);
          valueCode = this.cast(e, t, dc.init);
          if (d.type.isConst) {
            const cv = this.constEval(dc.init);
            if (cv !== undefined && isNum(t)) entry.constVal = t.k === 'float' ? cv : Math.trunc(cv);
          }
        }
      } else if (dc.ctorArgs) {
        if (dc.ctorArgs.length !== 1) throw this.err(dc, `expression list treated as compound expression in initializer`);
        valueCode = this.cast(this.expr(dc.ctorArgs[0]), t, dc);
      } else {
        if (d.type.isConst) throw this.err(dc, `uninitialized const '${dc.name}'`, 'const o‘zgaruvchiga darhol qiymat berilishi kerak.');
        valueCode = this.zero(t);
      }
      scope.vars.set(dc.name, entry);
      const bytes = this.sizeOf(t);
      if (isGlobal || d.type.isStatic) this.globalBytes += bytes;
      if (isGlobal) {
        decl.push(`let ${js} = ${this.zero(t)};`);
        init.push(`${js} = ${valueCode};`);
      } else if (d.type.isStatic) {
        this.statics.push(`let ${js} = ${this.zero(t)}; let ${js}__init = false;`);
        init.push(`if (!${js}__init) { ${js}__init = true; ${js} = ${valueCode}; }`);
      } else {
        init.push(`let ${js} = ${valueCode};`);
      }
    }
    return { decl, init };
  }

  zero(t) {
    if (t.k === 'str' || t.k === 'lit') return '""';
    if (t.k === 'arr') return `__c.arr(${JSON.stringify(t.dims)}, ${isStrLike(t.of) ? '""' : 0})`;
    if (t.k === 'cls') return 'null';
    return '0';
  }

  arrayInit(t, init, dc) {
    if (!init) return this.zero(t);
    const build = (dims, of, node) => {
      if (node.k === 'str' && of.k === 'char' && dims.length === 1) {
        const codes = [...node.v].map((ch) => ch.charCodeAt(0));
        if (codes.length + 1 > dims[0]) throw this.err(node, `initializer-string for array of chars is too long`);
        return `[${[...codes, ...Array(dims[0] - codes.length).fill(0)].join(', ')}]`;
      }
      if (node.k !== 'initlist') throw this.err(node, 'array must be initialized with a brace-enclosed initializer', 'Massiv {1, 2, 3} ko‘rinishida to‘ldiriladi.');
      if (node.items.length > dims[0]) throw this.err(node, `too many initializers for '${typeName({ k: 'arr', of, dims }, this.board)}'`,
        `Massivga ${dims[0]} ta element sig‘adi, lekin ${node.items.length} ta berilgan.`);
      const parts = node.items.map((it) => (dims.length > 1 ? build(dims.slice(1), of, it) : this.cast(this.expr(it), of, it)));
      const fill = dims.length > 1 ? this.zero({ k: 'arr', of, dims: dims.slice(1) }) : this.zero(of);
      while (parts.length < dims[0]) parts.push(fill);
      return `[${parts.join(', ')}]`;
    };
    void dc;
    return build(t.dims, t.of, init);
  }

  construct(t, dc) {
    if (t.name === 'DHT') {
      const args = dc.ctorArgs || [];
      if (args.length < 2 || args.length > 3) {
        throw this.err(dc, `no matching function for call to 'DHT::DHT(${args.map(() => 'int').join(', ')})'`,
          'DHT obyekti shunday yaratiladi: DHT dht(PIN, DHT22);');
      }
      const a = args.map((x) => this.cast(this.expr(x), I(8, true), x, 'argument passing'));
      return `__rt.newDHT(${a[0]}, ${a[1]})`;
    }
    throw this.err(dc, `unknown class '${t.name}'`);
  }

  // ---------- statements ----------
  stmt(s, scope) {
    switch (s.k) {
      case 'empty': return ';';
      case 'block': {
        const inner = new Scope(scope);
        return `{\n${s.body.map((x) => this.stmt(x, inner)).join('\n')}\n}`;
      }
      case 'var': {
        const prev = this.fn.scope;
        this.fn.scope = scope;
        const { init } = this.varDecl(s, scope, false);
        this.fn.scope = prev;
        return init.join('\n');
      }
      case 'expr': {
        const e = this.withScope(scope, () => this.expr(s.e, { discard: true }));
        return `${e.c};`;
      }
      case 'if': {
        const c = this.cond(s.c, scope, 'if');
        if (s.then.k === 'empty') this.warn(s.then.line ? s.then : s, `suggest braces around empty body in an 'if' statement`, '-Wempty-body',
          'if (...) dan keyin “;” qo‘yilgan — shart hech narsani boshqarmaydi!');
        const then = this.stmt(s.then, new Scope(scope));
        const other = s.other ? ` else ${this.stmt(s.other, new Scope(scope))}` : '';
        return `if (${c}) ${this.wrapBlock(then)}${other}`;
      }
      case 'while': {
        const c = this.cond(s.c, scope, 'while');
        if (s.body.k === 'empty') this.warn(s, `suggest braces around empty body in a 'while' statement`, '-Wempty-body');
        this.loopDepth++;
        const body = this.stmt(s.body, new Scope(scope));
        this.loopDepth--;
        return `while (${c}) { await __rt.tick(); ${body} }`;
      }
      case 'do': {
        this.loopDepth++;
        const body = this.stmt(s.body, new Scope(scope));
        this.loopDepth--;
        const c = this.cond(s.c, scope, 'while');
        return `do { await __rt.tick(); ${body} } while (${c});`;
      }
      case 'for': {
        const fs = new Scope(scope);
        let init = '';
        if (s.init) {
          if (s.init.k === 'var') {
            const prev = this.fn.scope;
            this.fn.scope = fs;
            init = this.varDecl(s.init, fs, false).init.map((x) => x.replace(/;$/, '')).join(', ').replace(/, let /g, ', ');
            this.fn.scope = prev;
          } else init = this.withScope(fs, () => this.expr(s.init.e, { discard: true }).c);
        }
        const c = s.c ? this.cond(s.c, fs, 'for') : '';
        const upd = s.upd ? this.withScope(fs, () => this.expr(s.upd, { discard: true }).c) : '';
        if (s.body.k === 'empty') this.warn(s, `for loop has empty body`, '-Wempty-body', 'for (...) dan keyin “;” — takrorlanadigan qism bo‘sh.');
        this.loopDepth++;
        const body = this.stmt(s.body, new Scope(fs));
        this.loopDepth--;
        return `for (${init}; ${c}; ${upd}) { await __rt.tick(); ${body} }`;
      }
      case 'switch': {
        const e = this.withScope(scope, () => this.expr(s.e));
        if (!isIntLike(e.t)) {
          throw this.err(s.e, `switch quantity not an integer`, 'switch faqat butun son (int, char) bilan ishlaydi. Matn uchun if/else ishlating.');
        }
        this.switchDepth++;
        const inner = new Scope(scope);
        const seen = new Set();
        const cases = s.cases.map((c) => {
          let head;
          if (c.test) {
            const v = this.withScope(scope, () => this.constEval(c.test));
            if (v === undefined) throw this.err(c.test, `the value of '${c.test.name ?? 'expression'}' is not usable in a constant expression`, 'case qiymati o‘zgarmas son bo‘lishi kerak.');
            if (seen.has(v)) throw this.err(c.test, `duplicate case value`);
            seen.add(v);
            head = `case ${v}:`;
          } else head = 'default:';
          return `${head}\n${c.body.map((x) => this.stmt(x, inner)).join('\n')}`;
        });
        this.switchDepth--;
        return `switch (${e.c}) {\n${cases.join('\n')}\n}`;
      }
      case 'return': {
        const ret = this.fn.ret;
        if (!s.e) {
          if (ret.k !== 'void') throw this.err(s, `return-statement with no value, in function returning '${typeName(ret, this.board)}'`, 'Bu funksiya qiymat qaytarishi kerak: return qiymat;');
          return 'return;';
        }
        const e = this.withScope(scope, () => this.expr(s.e));
        if (ret.k === 'void') {
          throw this.err(s, `return-statement with a value, in function returning 'void'`, 'void funksiya qiymat qaytarmaydi. Qiymat kerak bo‘lsa, funksiya turini int/float qiling.');
        }
        return `return ${this.cast(e, ret, s.e, 'return')};`;
      }
      case 'break':
        if (!this.loopDepth && !this.switchDepth) throw this.err(s, 'break statement not within loop or switch');
        return 'break;';
      case 'continue':
        if (!this.loopDepth) throw this.err(s, 'continue statement not within a loop');
        return 'continue;';
      default:
        throw this.err(s, `unsupported statement`);
    }
  }

  wrapBlock(code) { return code.startsWith('{') ? code : `{ ${code} }`; }

  withScope(scope, f) {
    const prev = this.fn.scope;
    this.fn.scope = scope;
    try { return f(); } finally { this.fn.scope = prev; }
  }

  cond(node, scope, kw) {
    let inner = node;
    if (inner.k === 'assign' && inner.op === '=') {
      this.warn(inner, 'suggest parentheses around assignment used as truth value', '-Wparentheses',
        `${kw} shartida “=” (qiymat berish) ishlatilgan. Taqqoslash uchun “==” yozing!`);
    }
    const e = this.withScope(scope, () => this.expr(node));
    if (e.t.k === 'void') throw this.err(node, 'could not convert to bool', 'void funksiya natijasini shart sifatida ishlatib bo‘lmaydi.');
    if (e.t.k === 'str' || e.t.k === 'cls') throw this.err(node, `could not convert '${typeName(e.t, this.board)}' to 'bool'`);
    return e.c;
  }

  temp() { return `__t${this.fn.temps++}`; }

  // ---------- expressions ----------
  // Returns { c: code, t: type, lvc?: assignable code, isConst?, k?: 'const', v? }
  expr(n, opts = {}) {
    switch (n.k) {
      case 'num': {
        const t = this.literalType(n.tok);
        return { c: String(n.tok.v), t, k: 'const', v: n.tok.v };
      }
      case 'str':
        this.stringBytes += n.v.length + 1;
        return { c: JSON.stringify(n.v), t: T.lit };
      case 'chr': return { c: String(n.v), t: T.char, k: 'const', v: n.v };
      case 'paren': {
        const e = this.expr(n.e, opts);
        return { ...e, c: `(${e.c})` };
      }
      case 'id': return this.ident(n);
      case 'un': return this.unary(n);
      case 'pre': case 'post': return this.incdec(n, opts);
      case 'bin': return this.binary(n);
      case 'assign': return this.assign(n);
      case 'cond': {
        const c = this.expr(n.c);
        const a = this.expr(n.a);
        const b = this.expr(n.b);
        let t;
        if (isStrLike(a.t) || isStrLike(b.t)) {
          if (!(isStrLike(a.t) && isStrLike(b.t))) throw this.err(n, `operands to ?: have different types '${typeName(a.t, this.board)}' and '${typeName(b.t, this.board)}'`);
          t = a.t.k === 'str' || b.t.k === 'str' ? T.str : T.lit;
        } else if (a.t.k === 'void' || b.t.k === 'void') t = T.void;
        else t = this.arith(a.t, b.t);
        return { c: `((${c.c}) ? ${this.cast(a, t, n.a)} : ${this.cast(b, t, n.b)})`, t };
      }
      case 'comma': {
        const a = this.expr(n.a, { discard: true });
        const b = this.expr(n.b, opts);
        return { c: `(${a.c}, ${b.c})`, t: b.t };
      }
      case 'cast': {
        const t = this.resolveType(n.type);
        const e = this.expr(n.e);
        return { c: this.cast(e, t, n, 'cast', true), t };
      }
      case 'sizeof': {
        const v = this.sizeofNode(n);
        return { c: String(v), t: I(this.board.arch === 'esp32' ? 32 : 16, true), k: 'const', v };
      }
      case 'call': return this.call(n, opts);
      case 'index': return this.index(n);
      case 'member':
        throw this.err(n, `invalid use of member function '${n.name}' (did you forget the '()' ?)`, `“${n.name}” dan keyin () qavslar yozilishi kerak.`);
      case 'fcast':
        throw this.err(n, `expected primary-expression before '${n.name}'`);
      case 'initlist':
        throw this.err(n, `expected primary-expression before '{' token`);
      default:
        throw this.err(n, 'unsupported expression');
    }
  }

  lookupVar(name) {
    return (this.fn && this.fn.scope ? this.fn.scope.lookup(name) : null) || this.global.lookup(name);
  }

  allNames() {
    return [
      ...(this.fn?.scope ? this.fn.scope.names() : []),
      ...this.global.names(),
      ...this.funcs.keys(),
      ...Object.keys(this.builtins),
      ...Object.keys(this.constants),
      'Serial',
    ];
  }

  undeclared(n, name) {
    const s = suggest(name, this.allNames());
    const hint = s
      ? `Ehtimol “${s}” demoqchisiz? C++ katta-kichik harflarni farqlaydi.`
      : `“${name}” e’lon qilinmagan. Avval o‘zgaruvchini e’lon qiling (masalan, int ${name} = 0;) yoki yozilishini tekshiring.`;
    return this.err(n, `'${name}' was not declared in this scope${s ? `; did you mean '${s}'?` : ''}`, hint);
  }

  ident(n) {
    const v = this.lookupVar(n.name);
    if (v) {
      const r = { c: v.js, t: v.t, lvc: v.js, isConst: v.isConst, name: n.name };
      if (v.constVal !== undefined) Object.assign(r, { k: 'const', v: v.constVal });
      return r;
    }
    if (n.name in this.constants) {
      const k = this.constants[n.name];
      return { c: String(k.v), t: k.t, k: 'const', v: k.v };
    }
    if (n.name === 'Serial') return { c: '1', t: T.bool };
    if (this.funcs.has(n.name) || this.builtins[n.name]) {
      throw this.err(n, `invalid use of function '${n.name}'`, `“${n.name}” — funksiya. Uni chaqirish uchun ${n.name}(...) yozing.`);
    }
    throw this.undeclared(n, n.name);
  }

  unary(n) {
    const e = this.expr(n.e);
    if (n.op === '!') {
      if (e.t.k === 'str' || e.t.k === 'cls') throw this.err(n, `no match for 'operator!' (operand type is '${typeName(e.t, this.board)}')`);
      return { c: `(!(${e.c}))`, t: T.bool };
    }
    if (!isNum(e.t)) throw this.err(n, `wrong type argument to unary ${n.op === '~' ? 'complement' : n.op === '-' ? 'minus' : 'plus'}`);
    if (n.op === '~') {
      if (e.t.k === 'float') throw this.err(n, `wrong type argument to bit-complement`);
      const t = this.promote(e.t);
      return { c: `__c.${castFn(t)}(~(${e.c}))`, t };
    }
    const t = e.t.k === 'float' ? T.float : this.promote(e.t);
    if (n.op === '+') return { c: `(+(${e.c}))`, t };
    if (e.k === 'const') return { c: `(-${e.c})`, t: e.t.k === 'float' ? T.float : this.literalNeg(e), k: 'const', v: -e.v };
    return { c: t.k === 'float' ? `(-(${e.c}))` : `__c.${castFn(t)}(-(${e.c}))`, t };
  }

  literalNeg(e) {
    return e.t;
  }

  requireLvalue(e, n, what = 'assignment') {
    if (!e.lvc) {
      throw this.err(n, what === 'assignment' ? 'lvalue required as left operand of assignment' : `lvalue required as ${what} operand`,
        'Chap tomonda o‘zgaruvchi bo‘lishi kerak. Taqqoslash uchun “==” ishlating.');
    }
    if (e.isConst) {
      throw this.err(n, `assignment of read-only variable '${e.name}'`, `“${e.name}” const (o‘zgarmas) deb e’lon qilingan — uning qiymatini o‘zgartirib bo‘lmaydi.`);
    }
    if (e.t.k === 'arr') throw this.err(n, 'invalid array assignment');
  }

  incdec(n, opts) {
    const e = this.expr(n.e);
    this.requireLvalue(e, n, n.op === '++' ? 'increment' : 'decrement');
    if (!isNum(e.t)) throw this.err(n, `no match for 'operator${n.op}' (operand type is '${typeName(e.t, this.board)}')`);
    const d = n.op === '++' ? '+ 1' : '- 1';
    const next = e.t.k === 'float' ? `${e.lvc} ${d}` : e.t.k === 'bool' ? '1' : `__c.${castFn(e.t)}(${e.lvc} ${d})`;
    if (n.k === 'pre' || opts.discard) return { c: `(${e.lvc} = ${next})`, t: e.t };
    const tmp = this.temp();
    return { c: `(${tmp} = ${e.lvc}, ${e.lvc} = ${next.replaceAll(e.lvc, tmp)}, ${tmp})`, t: e.t };
  }

  binary(n) {
    const op = n.op;
    const a = this.expr(n.l);
    const b = this.expr(n.r);
    const tn = (x) => typeName(x.t, this.board);
    const badOps = () => this.err(n, `invalid operands of types '${tn(a)}' and '${tn(b)}' to binary 'operator${op}'`);
    if (a.t.k === 'void' || b.t.k === 'void') throw this.err(n, 'void value not ignored as it ought to be', 'void funksiya qiymat qaytarmaydi.');
    if (a.t.k === 'cls' || b.t.k === 'cls') throw badOps();

    if (op === '&&' || op === '||') {
      return { c: `(!!(${a.c}) ${op} !!(${b.c}))`, t: T.bool };
    }

    // ---- strings ----
    if (isStrLike(a.t) || isStrLike(b.t) || a.t.k === 'arr' || b.t.k === 'arr') {
      if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
        if (!(isStrLike(a.t) || a.t.k === 'arr') || !(isStrLike(b.t) || b.t.k === 'arr')) {
          throw this.err(n, `no match for 'operator${op}' (operand types are '${tn(a)}' and '${tn(b)}')`,
            'Matnni son bilan taqqoslab bo‘lmaydi. Kerak bo‘lsa .toInt() ishlating.');
        }
        const js = op === '==' ? '===' : op === '!=' ? '!==' : op;
        return { c: `(${this.toStr(a)} ${js} ${this.toStr(b)})`, t: T.bool };
      }
      if (op !== '+') throw this.err(n, `no match for 'operator${op}' (operand types are '${tn(a)}' and '${tn(b)}')`);
      if (a.t.k === 'str' || b.t.k === 'str') {
        return { c: `(${this.toStr(a)} + ${this.toStr(b)})`, t: T.str };
      }
      // const char* + something: C pointer arithmetic, not concatenation.
      const [p, q] = a.t.k === 'lit' ? [a, b] : [b, a];
      if (q.t.k === 'lit' || q.t.k === 'float' || q.t.k === 'arr') {
        throw this.err(n, `invalid operands of types '${tn(a)}' and '${tn(b)}' to binary 'operator+'`,
          'Ikki qo‘shtirnoqli matnni yoki matn bilan kasr sonni “+” bilan qo‘shib bo‘lmaydi. Birinchisini String(...) ichiga oling: String("Harorat: ") + t');
      }
      this.warn(n, 'adding an integer to a string literal does not append to the string', '-Wstring-plus-int',
        'Bu matnga son qo‘shmaydi, balki matnni surib yuboradi (ko‘rsatkich arifmetikasi) — ekranda buzuq matn chiqadi. To‘g‘risi: String("matn") + son');
      return { c: `__c.ptradd(${p.c}, ${q.c})`, t: T.lit };
    }

    // ---- numbers ----
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      if (a.t.k === 'float' && b.t.k === 'float' && (op === '==' || op === '!=')) {
        // allowed, but a classic pitfall; gcc only warns with -Wfloat-equal.
      }
      return { c: `(${a.c} ${op} ${b.c})`, t: T.bool };
    }
    const t = this.arith(a.t, b.t);
    if (t.k === 'float') {
      if (['%', '&', '|', '^', '<<', '>>'].includes(op)) throw badOps();
      return { c: `(${a.c} ${op} ${b.c})`, t: T.float };
    }
    const cf = castFn(t);
    if (a.k === 'const' && b.k === 'const') {
      const v = this.constEval(n);
      if (v !== undefined) {
        const [lo, hi] = range(t);
        if (v < lo || v > hi) {
          this.warn(n, `integer overflow in expression of type '${typeName(t, this.board)}' results in '${wrapInt(v, t)}'`, '-Woverflow',
            `${this.board.name} platasida ${typeName(t, this.board)} ${lo}…${hi} oralig‘ida. Katta son uchun long yoki 1000UL kabi yozing.`);
        }
        const w = wrapInt(v, t);
        return { c: String(w), t, k: 'const', v: w };
      }
    }
    let c;
    if (op === '/') {
      if (b.k === 'const' && b.v === 0) this.warn(n, 'division by zero', '-Wdiv-by-zero');
      c = `__c.${cf}(__c.div(${a.c}, ${b.c}))`;
    } else if (op === '%') {
      if (b.k === 'const' && b.v === 0) this.warn(n, 'division by zero', '-Wdiv-by-zero');
      c = `__c.${cf}(__c.mod(${a.c}, ${b.c}))`;
    } else if (op === '>>') c = t.u && t.bits >= 32 ? `((${a.c}) >>> (${b.c}))` : `((${a.c}) >> (${b.c}))`;
    else if (op === '*' && t.bits === 32) c = `__c.${cf}(Math.imul(${a.c}, ${b.c}))`;
    else c = `__c.${cf}(${a.c} ${op} ${b.c})`;
    return { c, t };
  }

  assign(n) {
    const l = this.expr(n.l);
    this.requireLvalue(l, n.l);
    if (n.op === '=') {
      const r = this.expr(n.r);
      return { c: `(${l.lvc} = ${this.cast(r, l.t, n.r, 'assignment')})`, t: l.t };
    }
    const op = n.op.slice(0, -1);
    if (l.t.k === 'str') {
      if (op !== '+') throw this.err(n, `no match for 'operator${n.op}' (operand types are 'String' and '${typeName(this.expr(n.r).t, this.board)}')`);
      const r = this.expr(n.r);
      return { c: `(${l.lvc} = ${l.lvc} + ${this.toStr(r)})`, t: T.str };
    }
    const combined = this.binary({ k: 'bin', op, l: n.l, r: n.r, line: n.line, col: n.col });
    return { c: `(${l.lvc} = ${this.cast({ c: combined.c, t: combined.t }, l.t, n, 'assignment', true)})`, t: l.t };
  }

  index(n) {
    const o = this.expr(n.obj);
    const i = this.expr(n.idx);
    if (!isIntLike(i.t)) throw this.err(n.idx, `invalid types '${typeName(o.t, this.board)}[${typeName(i.t, this.board)}]' for array subscript`, 'Massiv indeksi butun son bo‘lishi kerak.');
    if (o.t.k === 'arr') {
      const t = o.t.dims.length > 1 ? { k: 'arr', of: o.t.of, dims: o.t.dims.slice(1) } : o.t.of;
      if (i.k === 'const' && o.t.dims[0] && (i.v >= o.t.dims[0] || i.v < 0)) {
        this.warn(n, `array subscript ${i.v} is outside array bounds of '${typeName(o.t, this.board)}'`, '-Warray-bounds',
          `Massivda ${o.t.dims[0]} ta element bor: indekslar 0…${o.t.dims[0] - 1}.`);
      }
      const lvc = `${o.c}[${i.c}]`;
      const read = t.k === 'arr' ? lvc : `__c.at(${o.c}, ${i.c})`;
      return { c: read, t, lvc, isConst: o.isConst, name: o.name };
    }
    if (isStrLike(o.t)) return { c: `__c.charAt(${o.c}, ${i.c})`, t: T.char };
    throw this.err(n, `invalid types '${typeName(o.t, this.board)}[${typeName(i.t, this.board)}]' for array subscript`,
      `“${o.name ?? 'bu'}” massiv emas, unga [ ] bilan murojaat qilib bo‘lmaydi.`);
  }

  args(n) { return n.args.map((a) => this.expr(a)); }

  call(n) {
    const callee = n.callee;
    if (callee.k === 'fcast') return this.fcast(callee.name, n);
    if (callee.k === 'member') return this.method(callee, n);
    if (callee.k !== 'id') throw this.err(n, 'expression cannot be used as a function');
    const name = callee.name;
    const local = this.lookupVar(name);
    if (local) {
      throw this.err(callee, `'${name}' cannot be used as a function`, `“${name}” — o‘zgaruvchi, funksiya emas.`);
    }
    const f = this.funcs.get(name);
    if (f) {
      f.used = true;
      const args = this.args(n);
      const required = f.params.filter((p) => !p.def).length;
      const sig = `${typeName(f.ret, this.board)} ${name}(${f.params.map((p) => typeName(p.t, this.board)).join(', ')})`;
      if (args.length < required) throw this.err(n, `too few arguments to function '${sig}'`, `“${name}” ${required} ta argument kutadi, ${args.length} ta berilgan.`);
      if (args.length > f.params.length) throw this.err(n, `too many arguments to function '${sig}'`, `“${name}” ${f.params.length} ta argument kutadi, ${args.length} ta berilgan.`);
      const codes = args.map((a, i) => this.cast(a, f.params[i].t, n.args[i], 'argument passing'));
      return { c: `(await ${f.js}(${codes.join(', ')}))`, t: f.ret };
    }
    const b = this.builtins[name];
    if (b) {
      const args = this.args(n);
      if (args.length < b.min || args.length > b.max) {
        throw this.err(n, `too ${args.length < b.min ? 'few' : 'many'} arguments to function '${b.sig}'`,
          `${name}() ${b.min === b.max ? b.min : `${b.min}–${b.max}`} ta argument oladi, ${args.length} ta berilgan.`);
      }
      args.forEach((a, i) => {
        if (b.types && b.types[i] === 'num' && !isNum(a.t)) {
          throw this.err(n.args[i], `cannot convert '${typeName(a.t, this.board)}' to 'int' for argument '${i + 1}' to '${b.sig}'`);
        }
      });
      return b.gen(args, this, n);
    }
    if (this.constants[name] || name === 'Serial') throw this.err(callee, `'${name}' cannot be used as a function`);
    throw this.undeclared(callee, name);
  }

  fcast(name, n) {
    const args = this.args(n);
    if (name === 'String') {
      if (args.length === 0) return { c: '""', t: T.str };
      const a = args[0];
      if (args.length === 2) {
        if (a.t.k === 'float') return { c: `__c.fstr(${a.c}, ${args[1].c})`, t: T.str };
        return { c: `__c.base(${a.c}, ${args[1].c}, ${a.t.k === 'int' && a.t.u ? 1 : 0})`, t: T.str };
      }
      if (args.length > 2) throw this.err(n, `no matching function for call to 'String::String(...)'`);
      return { c: this.toStr(a), t: T.str };
    }
    if (args.length !== 1) throw this.err(n, `expression list treated as compound expression in functional cast`);
    const t = this.resolveType({ words: [name], ptr: 0 });
    return { c: this.cast(args[0], t, n, 'cast', true), t };
  }

  method(m, n) {
    const objNode = m.obj;
    const args = this.args(n);
    const argc = args.length;
    const need = (min, max, sig) => {
      if (argc < min || argc > max) throw this.err(n, `no matching function for call to '${sig}'`, `${m.name}() ${min === max ? min : `${min}–${max}`} ta argument oladi.`);
    };
    // Serial.*
    if (objNode.k === 'id' && objNode.name === 'Serial' && !this.lookupVar('Serial')) {
      const S = serialMethods(this.board);
      const spec = S[m.name];
      if (!spec) {
        const s = suggest(m.name, Object.keys(S));
        throw this.err(m, `'class HardwareSerial' has no member named '${m.name}'${s ? `; did you mean '${s}'?` : ''}`,
          s ? `Ehtimol Serial.${s} demoqchisiz?` : `Serial’da “${m.name}” degan buyruq yo‘q.`);
      }
      need(spec.min, spec.max, `HardwareSerial::${m.name}(...)`);
      return spec.gen(args, this, n);
    }
    const o = this.expr(objNode);
    if (o.t.k === 'cls' && o.t.name === 'DHT') {
      const D = {
        begin: [0, 1, () => ({ c: `(${o.c}.begin())`, t: T.void })],
        readTemperature: [0, 2, (a) => ({ c: `(${o.c}.readTemperature(${a.map((x) => x.c).join(', ')}))`, t: T.float })],
        readHumidity: [0, 1, () => ({ c: `(${o.c}.readHumidity())`, t: T.float })],
        computeHeatIndex: [2, 3, (a) => ({ c: `(${o.c}.computeHeatIndex(${a.map((x) => x.c).join(', ')}))`, t: T.float })],
        convertCtoF: [1, 1, (a) => ({ c: `((${a[0].c}) * 1.8 + 32)`, t: T.float })],
        convertFtoC: [1, 1, (a) => ({ c: `(((${a[0].c}) - 32) / 1.8)`, t: T.float })],
        read: [0, 1, () => ({ c: `(${o.c}.read())`, t: T.bool })],
      };
      const spec = D[m.name];
      if (!spec) {
        const s = suggest(m.name, Object.keys(D));
        throw this.err(m, `'class DHT' has no member named '${m.name}'${s ? `; did you mean '${s}'?` : ''}`);
      }
      need(spec[0], spec[1], `DHT::${m.name}(...)`);
      return spec[2](args);
    }
    if (isStrLike(o.t)) return this.stringMethod(o, m, n, args, need);
    throw this.err(m, `request for member '${m.name}' in '${objNode.name ?? 'expression'}', which is of non-class type '${typeName(o.t, this.board)}'`,
      `“${objNode.name ?? 'bu'}” — ${typeName(o.t, this.board)} turidagi qiymat, uning metodlari yo‘q.`);
  }

  stringMethod(o, m, n, args, need) {
    const a = args.map((x) => x.c);
    const s = (x) => this.toStr(x);
    const inplace = (fn) => {
      if (!o.lvc) return { c: `(${fn(o.c)}, undefined)`, t: T.void };
      if (o.isConst) throw this.err(n, `passing 'const String' as 'this' argument discards qualifiers`);
      return { c: `(${o.lvc} = ${fn(o.lvc)}, undefined)`, t: T.void };
    };
    const M = {
      length: [0, 0, () => ({ c: `(${o.c}).length`, t: I(this.board.intBits, true) })],
      toInt: [0, 0, () => ({ c: `__c.toInt(${o.c})`, t: I(32) })],
      toFloat: [0, 0, () => ({ c: `__c.toFloat(${o.c})`, t: T.float })],
      toDouble: [0, 0, () => ({ c: `__c.toFloat(${o.c})`, t: T.float })],
      indexOf: [1, 2, () => ({ c: `(${o.c}).indexOf(${s(args[0])}${a[1] ? `, ${a[1]}` : ''})`, t: I(this.board.intBits) })],
      lastIndexOf: [1, 2, () => ({ c: `(${o.c}).lastIndexOf(${s(args[0])}${a[1] ? `, ${a[1]}` : ''})`, t: I(this.board.intBits) })],
      substring: [1, 2, () => ({ c: `__c.substring(${o.c}, ${a.join(', ')})`, t: T.str })],
      charAt: [1, 1, () => ({ c: `__c.charAt(${o.c}, ${a[0]})`, t: T.char })],
      equals: [1, 1, () => ({ c: `(${o.c} === ${s(args[0])})`, t: T.bool })],
      equalsIgnoreCase: [1, 1, () => ({ c: `((${o.c}).toLowerCase() === (${s(args[0])}).toLowerCase())`, t: T.bool })],
      startsWith: [1, 1, () => ({ c: `(${o.c}).startsWith(${s(args[0])})`, t: T.bool })],
      endsWith: [1, 1, () => ({ c: `(${o.c}).endsWith(${s(args[0])})`, t: T.bool })],
      compareTo: [1, 1, () => ({ c: `__c.cmp(${o.c}, ${s(args[0])})`, t: I(this.board.intBits) })],
      isEmpty: [0, 0, () => ({ c: `((${o.c}).length === 0)`, t: T.bool })],
      c_str: [0, 0, () => ({ c: o.c, t: T.lit })],
      trim: [0, 0, () => inplace((x) => `(${x}).trim()`)],
      toUpperCase: [0, 0, () => inplace((x) => `(${x}).toUpperCase()`)],
      toLowerCase: [0, 0, () => inplace((x) => `(${x}).toLowerCase()`)],
      replace: [2, 2, () => inplace((x) => `(${x}).split(${s(args[0])}).join(${s(args[1])})`)],
      concat: [1, 1, () => inplace((x) => `(${x} + ${s(args[0])})`)],
      remove: [1, 2, () => inplace((x) => `__c.remove(${x}, ${a.join(', ')})`)],
      setCharAt: [2, 2, () => inplace((x) => `__c.setCharAt(${x}, ${a[0]}, ${a[1]})`)],
    };
    if (o.t.k === 'lit') {
      throw this.err(m, `request for member '${m.name}' in '${o.name ?? 'string literal'}', which is of non-class type 'const char*'`,
        'Bu metod faqat String turida ishlaydi: String matn = "..."; deb e’lon qiling.');
    }
    const spec = M[m.name];
    if (!spec) {
      const sg = suggest(m.name, Object.keys(M));
      throw this.err(m, `'class String' has no member named '${m.name}'${sg ? `; did you mean '${sg}'?` : ''}`);
    }
    need(spec[0], spec[1], `String::${m.name}(...)`);
    return spec[2]();
  }

  stats(source) {
    const esp = this.board.arch === 'esp32';
    const lines = source.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    const flash = (esp ? 264000 : 1440) + lines * (esp ? 52 : 34) + this.stringBytes;
    const ram = (esp ? 21000 : 184) + this.globalBytes + (esp ? 0 : this.stringBytes);
    return { flash, ram, flashMax: this.board.flash, ramMax: this.board.ram };
  }
}

export function wrapInt(v, t) {
  if (t.bits >= 64) return Math.trunc(v);
  const m = 2 ** t.bits;
  let r = ((Math.trunc(v) % m) + m) % m;
  if (!t.u && r >= m / 2) r -= m;
  return r;
}

// ---------------------------------------------------------------------------
// Built-in functions and constants

function makeConstants(board, libConsts) {
  const int = I(board.intBits);
  const c = {
    HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, LED_BUILTIN: board.ledBuiltin,
    HEX: 16, DEC: 10, OCT: 8, BIN: 2, NULL: 0, LSBFIRST: 0, MSBFIRST: 1, CHANGE: 1, RISING: 3, FALLING: 2,
    ...board.analogNames, ...libConsts,
  };
  const out = {};
  for (const [k, v] of Object.entries(c)) out[k] = { v, t: int };
  out.true = { v: 1, t: T.bool };
  out.false = { v: 0, t: T.bool };
  for (const [k, v] of Object.entries({ PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E })) {
    out[k] = { v, t: T.float };
  }
  return out;
}

function makeBuiltins(board) {
  const ib = board.intBits;
  const esp = board.arch === 'esp32';
  const int = I(ib);
  const long = I(32);
  const ulong = I(32, true);
  const call = (fn, t) => (args) => ({ c: `(await __rt.${fn}(${args.map((a) => a.c).join(', ')}))`, t });
  const pure = (fn, t) => (args) => ({ c: `${fn}(${args.map((a) => a.c).join(', ')})`, t });
  const B = {
    pinMode: { min: 2, max: 2, sig: 'void pinMode(uint8_t, uint8_t)', types: ['num', 'num'], gen: call('pinMode', T.void) },
    digitalWrite: { min: 2, max: 2, sig: 'void digitalWrite(uint8_t, uint8_t)', types: ['num', 'num'], gen: call('digitalWrite', T.void) },
    digitalRead: { min: 1, max: 1, sig: 'int digitalRead(uint8_t)', types: ['num'], gen: call('digitalRead', int) },
    analogRead: { min: 1, max: 1, sig: 'int analogRead(uint8_t)', types: ['num'], gen: call('analogRead', esp ? I(16, true) : int) },
    analogWrite: { min: 2, max: 2, sig: 'void analogWrite(uint8_t, int)', types: ['num', 'num'], gen: call('analogWrite', T.void) },
    delay: { min: 1, max: 1, sig: 'void delay(long unsigned int)', types: ['num'], gen: call('delay', T.void) },
    delayMicroseconds: { min: 1, max: 1, sig: 'void delayMicroseconds(unsigned int)', types: ['num'], gen: call('delayMicroseconds', T.void) },
    millis: { min: 0, max: 0, sig: 'long unsigned int millis()', gen: call('millis', ulong) },
    micros: { min: 0, max: 0, sig: 'long unsigned int micros()', gen: call('micros', ulong) },
    tone: { min: 2, max: 3, sig: 'void tone(uint8_t, unsigned int, long unsigned int)', types: ['num', 'num', 'num'], gen: call('tone', T.void) },
    noTone: { min: 1, max: 1, sig: 'void noTone(uint8_t)', types: ['num'], gen: call('noTone', T.void) },
    pulseIn: { min: 2, max: 3, sig: 'long unsigned int pulseIn(uint8_t, uint8_t, long unsigned int)', gen: call('pulseIn', ulong) },
    yield: { min: 0, max: 0, sig: 'void yield()', gen: call('tick', T.void) },
    randomSeed: { min: 1, max: 1, sig: 'void randomSeed(long unsigned int)', gen: call('randomSeed', T.void) },
    random: { min: 1, max: 2, sig: 'long int random(long int, long int)', types: ['num', 'num'], gen: call('random', long) },
    map: {
      min: 5, max: 5, sig: 'long int map(long int, long int, long int, long int, long int)', types: ['num', 'num', 'num', 'num', 'num'],
      gen: (a) => ({ c: `__c.map(${a.map((x) => x.c).join(', ')})`, t: long }),
    },
    constrain: {
      min: 3, max: 3, sig: 'constrain(amt, low, high)', types: ['num', 'num', 'num'],
      gen: (a, g) => ({ c: `__c.constrain(${a.map((x) => x.c).join(', ')})`, t: g.arith(a[0].t, g.arith(a[1].t, a[2].t)) }),
    },
    min: { min: 2, max: 2, sig: 'min(a, b)', types: ['num', 'num'], gen: (a, g) => ({ c: `Math.min(${a[0].c}, ${a[1].c})`, t: g.arith(a[0].t, a[1].t) }) },
    max: { min: 2, max: 2, sig: 'max(a, b)', types: ['num', 'num'], gen: (a, g) => ({ c: `Math.max(${a[0].c}, ${a[1].c})`, t: g.arith(a[0].t, a[1].t) }) },
    abs: { min: 1, max: 1, sig: 'abs(x)', types: ['num'], gen: (a, g) => ({ c: `Math.abs(${a[0].c})`, t: a[0].t.k === 'float' ? T.float : g.promote(a[0].t) }) },
    sq: { min: 1, max: 1, sig: 'sq(x)', types: ['num'], gen: (a) => ({ c: `((${a[0].c}) * (${a[0].c}))`, t: a[0].t.k === 'float' ? T.float : long }) },
    pow: { min: 2, max: 2, sig: 'double pow(double, double)', types: ['num', 'num'], gen: pure('Math.pow', T.float) },
    sqrt: { min: 1, max: 1, sig: 'double sqrt(double)', types: ['num'], gen: pure('Math.sqrt', T.float) },
    sin: { min: 1, max: 1, sig: 'double sin(double)', types: ['num'], gen: pure('Math.sin', T.float) },
    cos: { min: 1, max: 1, sig: 'double cos(double)', types: ['num'], gen: pure('Math.cos', T.float) },
    tan: { min: 1, max: 1, sig: 'double tan(double)', types: ['num'], gen: pure('Math.tan', T.float) },
    atan2: { min: 2, max: 2, sig: 'double atan2(double, double)', types: ['num', 'num'], gen: pure('Math.atan2', T.float) },
    floor: { min: 1, max: 1, sig: 'double floor(double)', types: ['num'], gen: pure('Math.floor', T.float) },
    ceil: { min: 1, max: 1, sig: 'double ceil(double)', types: ['num'], gen: pure('Math.ceil', T.float) },
    round: { min: 1, max: 1, sig: 'round(x)', types: ['num'], gen: pure('__c.round', long) },
    fabs: { min: 1, max: 1, sig: 'double fabs(double)', types: ['num'], gen: pure('Math.abs', T.float) },
    log: { min: 1, max: 1, sig: 'double log(double)', types: ['num'], gen: pure('Math.log', T.float) },
    log10: { min: 1, max: 1, sig: 'double log10(double)', types: ['num'], gen: pure('Math.log10', T.float) },
    exp: { min: 1, max: 1, sig: 'double exp(double)', types: ['num'], gen: pure('Math.exp', T.float) },
    isnan: { min: 1, max: 1, sig: 'int isnan(double)', types: ['num'], gen: (a) => ({ c: `(Number.isNaN(${a[0].c}))`, t: T.bool }) },
    isinf: { min: 1, max: 1, sig: 'int isinf(double)', types: ['num'], gen: (a) => ({ c: `(!Number.isFinite(${a[0].c}) && !Number.isNaN(${a[0].c}))`, t: T.bool }) },
    bitRead: { min: 2, max: 2, sig: 'bitRead(value, bit)', types: ['num', 'num'], gen: (a) => ({ c: `(((${a[0].c}) >> (${a[1].c})) & 1)`, t: int }) },
    bit: { min: 1, max: 1, sig: 'bit(b)', types: ['num'], gen: (a) => ({ c: `(2 ** (${a[0].c}))`, t: ulong }) },
    lowByte: { min: 1, max: 1, sig: 'lowByte(w)', types: ['num'], gen: (a) => ({ c: `((${a[0].c}) & 255)`, t: I(8, true) }) },
    highByte: { min: 1, max: 1, sig: 'highByte(w)', types: ['num'], gen: (a) => ({ c: `(((${a[0].c}) >> 8) & 255)`, t: I(8, true) }) },
    F: {
      min: 1, max: 1, sig: 'F(string_literal)',
      gen: (a, g, n) => {
        if (a[0].t.k !== 'lit') throw g.err(n, 'F() macro requires a string literal', 'F() ichida faqat qo‘shtirnoqli matn bo‘ladi.');
        return { c: a[0].c, t: T.lit };
      },
    },
  };
  if (esp) {
    B.analogReadResolution = { min: 1, max: 1, sig: 'void analogReadResolution(uint8_t)', gen: call('analogReadResolution', T.void) };
  }
  return B;
}

function serialMethods(board) {
  const esp = board.arch === 'esp32';
  const aw = (fn, t) => (args, g) => ({ c: `(await __rt.serial.${fn}(${args.map((a) => a.c).join(', ')}))`, t });
  const S = {
    begin: { min: 1, max: 2, gen: aw('begin', T.void) },
    end: { min: 0, max: 0, gen: aw('end', T.void) },
    print: {
      min: 1, max: 2,
      gen: (a, g) => ({ c: `(await __rt.serial.print(${a[0].c}, '${g.tag(a[0].t)}'${a[1] ? `, ${a[1].c}` : ''}))`, t: I(16, true) }),
    },
    println: {
      min: 0, max: 2,
      gen: (a, g) => ({
        c: a.length ? `(await __rt.serial.println(${a[0].c}, '${g.tag(a[0].t)}'${a[1] ? `, ${a[1].c}` : ''}))` : '(await __rt.serial.println())',
        t: I(16, true),
      }),
    },
    write: { min: 1, max: 1, gen: (a, g) => ({ c: `(await __rt.serial.write(${a[0].c}, '${g.tag(a[0].t)}'))`, t: I(16, true) }) },
    available: { min: 0, max: 0, gen: aw('available', I(board.intBits)) },
    availableForWrite: { min: 0, max: 0, gen: aw('availableForWrite', I(board.intBits)) },
    read: { min: 0, max: 0, gen: aw('read', I(board.intBits)) },
    peek: { min: 0, max: 0, gen: aw('peek', I(board.intBits)) },
    readString: { min: 0, max: 0, gen: aw('readString', T.str) },
    readStringUntil: { min: 1, max: 1, gen: aw('readStringUntil', T.str) },
    parseInt: { min: 0, max: 0, gen: aw('parseInt', I(32)) },
    parseFloat: { min: 0, max: 0, gen: aw('parseFloat', T.float) },
    setTimeout: { min: 1, max: 1, gen: aw('setTimeout', T.void) },
    flush: { min: 0, max: 0, gen: aw('flush', T.void) },
  };
  if (esp) {
    S.printf = {
      min: 1, max: 12,
      gen: (a, g) => ({ c: `(await __rt.serial.printf(${a[0].c}, [${a.slice(1).map((x) => `[${x.c}, '${g.tag(x.t)}']`).join(', ')}]))`, t: I(32, true) }),
    };
  }
  return S;
}
