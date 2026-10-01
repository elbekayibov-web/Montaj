// Recursive-descent parser for the Arduino C++ subset. Produces a small AST and
// reports syntax errors with gcc-style wording so students see the same text
// the real Arduino IDE would show.

import { CompileError } from './lexer.js';

export const TYPE_WORDS = new Set([
  'void', 'bool', 'boolean', 'char', 'byte', 'short', 'int', 'long', 'float', 'double', 'String',
  'word', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t',
  'unsigned', 'signed',
]);
const INT_MODS = new Set(['unsigned', 'signed', 'long', 'short', 'int']);
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'constexpr', 'inline', 'extern', 'register']);
const UNSUPPORTED = {
  struct: 'struct is not supported by the simulator yet.',
  class: 'Writing classes is not supported by the simulator.',
  typedef: 'typedef is not supported by the simulator.',
  enum: 'enum is not supported by the simulator — use const int instead.',
  union: 'union is not supported by the simulator.',
  goto: 'goto is not supported by the simulator.',
  new: 'Dynamic memory (new) is not supported by the simulator.',
  delete: 'Dynamic memory (delete) is not supported by the simulator.',
  template: 'Templates are not supported by the simulator.',
  namespace: 'namespace is not supported by the simulator.',
};

const BIN_PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function describeToken(tok) {
  if (tok.t === 'eof') return null;
  if (tok.t === 'id') return `'${tok.v}'`;
  if (tok.t === 'num') return 'numeric constant';
  if (tok.t === 'str') return 'string constant';
  if (tok.t === 'chr') return 'character constant';
  return `'${tok.v}' token`;
}

export class Parser {
  constructor(tokens, classNames) {
    this.toks = tokens;
    this.i = 0;
    this.classNames = classNames;
  }

  peek(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  prev() { return this.toks[Math.max(this.i - 1, 0)]; }
  next() { return this.toks[this.i++]; }
  is(v, k = 0) {
    const t = this.peek(k);
    return (t.t === 'op' || t.t === 'id') && t.v === v;
  }
  accept(v) {
    if (this.is(v)) { this.i++; return true; }
    return false;
  }

  err(tok, msg, hint) {
    return new CompileError(tok.line, tok.col, msg, hint);
  }

  // "expected ';' before '}' token" – reported just after the previous token,
  // which is where the character is actually missing.
  expected(what, hint) {
    const t = this.peek();
    const d = describeToken(t);
    const p = this.prev();
    const where = this.i > 0 ? { line: p.line, col: p.end } : t;
    const msg = d ? `expected ${what} before ${d}` : `expected ${what} at end of input`;
    return new CompileError(where.line, where.col, msg, hint);
  }

  expect(v, hint) {
    if (this.accept(v)) return this.prev();
    const defaults = {
      ';': 'A semicolon (;) is missing at the end of the line.',
      ')': 'A parenthesis is not closed — “)” is missing.',
      '(': 'An opening “(” was expected here.',
      '}': 'A curly brace is not closed — “}” is missing.',
      ']': 'A square bracket is not closed — “]” is missing.',
    };
    throw this.expected(`'${v}'`, hint ?? defaults[v]);
  }

  identifier(hint) {
    const t = this.peek();
    if (t.t !== 'id') throw this.expected('unqualified-id', hint ?? 'A name (variable or function) was expected here.');
    this.i++;
    return t;
  }

  isTypeStart(k = 0) {
    const t = this.peek(k);
    if (t.t !== 'id') return false;
    return TYPE_WORDS.has(t.v) || QUALIFIERS.has(t.v) || this.classNames.has(t.v);
  }

  checkUnsupported() {
    const t = this.peek();
    if (t.t === 'id' && UNSUPPORTED[t.v]) {
      throw this.err(t, `'${t.v}' is not supported by the NAFAS simulator`, UNSUPPORTED[t.v]);
    }
  }

  parseType() {
    const start = this.peek();
    const words = [];
    let isConst = false;
    let isStatic = false;
    while (this.peek().t === 'id') {
      const v = this.peek().v;
      if (QUALIFIERS.has(v)) {
        if (v === 'const' || v === 'constexpr') isConst = true;
        if (v === 'static') isStatic = true;
        this.i++;
        continue;
      }
      if (TYPE_WORDS.has(v)) {
        // Only integer modifiers combine: "unsigned long int", "unsigned char", "long double".
        const allMods = words.every((w) => INT_MODS.has(w));
        if (words.length && !(allMods && (INT_MODS.has(v) || v === 'char' || v === 'double'))) break;
        words.push(v);
        this.i++;
        continue;
      }
      if (this.classNames.has(v) && !words.length) {
        words.push(v);
        this.i++;
        break;
      }
      break;
    }
    if (!words.length) {
      const t = this.peek();
      if (t.t === 'id') throw this.err(t, `'${t.v}' does not name a type`, `Unknown type “${t.v}”. Check the spelling or that its library is #included.`);
      throw this.expected('type-specifier');
    }
    while (this.is('const')) { this.i++; isConst = true; }
    let ptr = 0;
    while (this.is('*')) { this.i++; ptr++; while (this.accept('const')); }
    if (this.is('&')) {
      throw this.err(this.peek(), 'references are not supported by the NAFAS simulator', 'References (&) are not supported — return the value or use a global variable.');
    }
    return { words, isConst, isStatic, ptr, line: start.line, col: start.col };
  }

  // ---------- top level ----------
  parseProgram() {
    const decls = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      this.checkUnsupported();
      if (!this.isTypeStart()) {
        const t = this.peek();
        if (t.t === 'id' && (this.peek(1).t === 'id')) {
          throw this.err(t, `'${t.v}' does not name a type`, `Unknown type “${t.v}”. Check upper/lower case or the #include you need.`);
        }
        if (t.t === 'id') {
          throw this.err(t, `'${t.v}' does not name a type`, 'Statements can only be written inside a function, for example inside setup() or loop().');
        }
        if (t.v === '}') throw this.err(t, "expected declaration before '}' token", 'There is an extra “}”.');
        throw this.err(t, `expected unqualified-id before ${describeToken(t)}`);
      }
      decls.push(this.parseDeclaration(true));
    }
    return { decls };
  }

  parseDeclaration(topLevel) {
    const type = this.parseType();
    const nameTok = this.identifier();
    if (this.is('(')) {
      const isClass = this.classNames.has(type.words[0]);
      // Function definition / prototype (top level), or constructor call.
      if (topLevel && !isClass) return this.parseFunction(type, nameTok);
      if (!topLevel && !isClass && this.looksLikeParamList()) {
        throw this.err(nameTok, `a function-definition is not allowed here before '{' token`,
          'A function cannot be declared inside another function. The previous function is probably missing its “}”.');
      }
    }
    const declarators = [];
    let first = nameTok;
    for (;;) {
      declarators.push(this.parseDeclarator(first, type));
      if (!this.accept(',')) break;
      first = this.identifier();
    }
    if (!this.is(';')) {
      throw this.expected(declarators.length ? "',' or ';'" : "';'", 'A semicolon (;) is missing after the variable declaration.');
    }
    this.i++;
    return { k: 'var', type, declarators, line: type.line, col: type.col };
  }

  looksLikeParamList() {
    // After '(' : ')' or a type name followed by an identifier means a parameter list.
    const a = this.peek(1);
    if (a.t === 'op' && a.v === ')') return this.is('{', 2);
    return a.t === 'id' && (TYPE_WORDS.has(a.v) || this.classNames.has(a.v)) && this.peek(2).t === 'id';
  }

  parseDeclarator(nameTok, type) {
    const d = { name: nameTok.v, line: nameTok.line, col: nameTok.col, dims: [], init: null, ctorArgs: null };
    while (this.accept('[')) {
      if (this.accept(']')) d.dims.push(null);
      else {
        d.dims.push(this.parseExpr());
        this.expect(']');
      }
    }
    if (this.accept('=')) {
      d.init = this.is('{') ? this.parseInitList() : this.parseAssign();
    } else if (this.is('(')) {
      this.i++;
      d.ctorArgs = [];
      if (!this.is(')')) {
        do d.ctorArgs.push(this.parseAssign()); while (this.accept(','));
      }
      this.expect(')');
    } else if (this.is('{')) {
      d.init = this.parseInitList();
    }
    void type;
    return d;
  }

  parseInitList() {
    const t = this.expect('{');
    const items = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.parseInitList() : this.parseAssign());
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return { k: 'initlist', items, line: t.line, col: t.col };
  }

  parseFunction(ret, nameTok) {
    this.expect('(');
    const params = [];
    if (this.is('void') && this.is(')', 1)) this.i++;
    else if (!this.is(')')) {
      do {
        if (!this.isTypeStart()) {
          const t = this.peek();
          if (t.t === 'id') throw this.err(t, `'${t.v}' has not been declared`, 'The parameter has no type (for example: int value).');
          throw this.expected('primary-expression');
        }
        const ptype = this.parseType();
        const p = { type: ptype, name: null, dims: [], def: null, line: ptype.line, col: ptype.col };
        if (this.peek().t === 'id') {
          const pt = this.next();
          p.name = pt.v;
          p.line = pt.line;
          p.col = pt.col;
        }
        while (this.accept('[')) {
          p.dims.push(this.is(']') ? null : this.parseExpr());
          this.expect(']');
        }
        if (this.accept('=')) p.def = this.parseAssign();
        params.push(p);
      } while (this.accept(','));
    }
    this.expect(')');
    const fn = { k: 'func', ret, name: nameTok.v, params, body: null, line: nameTok.line, col: nameTok.col };
    if (this.accept(';')) return fn;
    if (!this.is('{')) {
      throw this.expected("'{'", 'A function header must be followed by a { ... } body or a ;.');
    }
    fn.body = this.parseBlock();
    return fn;
  }

  // ---------- statements ----------
  parseBlock() {
    const open = this.expect('{');
    const body = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') {
        throw new CompileError(this.prev().line, this.prev().end, "expected '}' at end of input",
          `The “{” opened on line ${open.line} is never closed — add “}” at the end.`);
      }
      body.push(this.parseStatement());
    }
    this.i++;
    return { k: 'block', body, line: open.line, col: open.col };
  }

  parseStatement() {
    const t = this.peek();
    this.checkUnsupported();
    if (t.t === 'op') {
      if (t.v === '{') return this.parseBlock();
      if (t.v === ';') { this.i++; return { k: 'empty' }; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.i++;
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          const then = this.parseStatement();
          let other = null;
          if (this.accept('else')) other = this.parseStatement();
          return { k: 'if', c, then, other, line: t.line, col: t.col };
        }
        case 'else':
          throw this.err(t, "'else' without a previous 'if'", 'else needs an if before it. There may be a stray “;” after the if.');
        case 'while': {
          this.i++;
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          return { k: 'while', c, body: this.parseStatement(), line: t.line, col: t.col };
        }
        case 'do': {
          this.i++;
          const body = this.parseStatement();
          if (!this.is('while')) throw this.expected("'while'");
          this.i++;
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          this.expect(';');
          return { k: 'do', c, body, line: t.line, col: t.col };
        }
        case 'for': {
          this.i++;
          this.expect('(');
          let init = null;
          if (this.accept(';')) init = null;
          else if (this.isTypeStart()) init = this.parseDeclaration(false);
          else { init = { k: 'expr', e: this.parseExpr() }; this.expect(';', 'for (init; condition; step) — the three parts are separated by semicolons.'); }
          const c = this.is(';') ? null : this.parseExpr();
          this.expect(';', 'for (init; condition; step) — the three parts are separated by semicolons.');
          const upd = this.is(')') ? null : this.parseExpr();
          this.expect(')');
          return { k: 'for', init, c, upd, body: this.parseStatement(), line: t.line, col: t.col };
        }
        case 'switch': {
          this.i++;
          this.expect('(');
          const e = this.parseExpr();
          this.expect(')');
          this.expect('{');
          const cases = [];
          while (!this.is('}')) {
            if (this.peek().t === 'eof') throw this.expected("'}'");
            if (this.accept('case')) {
              const test = this.parseCond();
              this.expect(':');
              cases.push({ test, body: [] });
            } else if (this.accept('default')) {
              this.expect(':');
              cases.push({ test: null, body: [] });
            } else {
              if (!cases.length) throw this.err(this.peek(), 'statement in switch before any case label', 'Inside switch the first thing must be a case label.');
              cases[cases.length - 1].body.push(this.parseStatement());
            }
          }
          this.i++;
          return { k: 'switch', e, cases, line: t.line, col: t.col };
        }
        case 'case':
        case 'default':
          throw this.err(t, `case label not within a switch statement`);
        case 'return': {
          this.i++;
          const e = this.is(';') ? null : this.parseExpr();
          this.expect(';');
          return { k: 'return', e, line: t.line, col: t.col };
        }
        case 'break':
        case 'continue':
          this.i++;
          this.expect(';');
          return { k: t.v, line: t.line, col: t.col };
        default:
          break;
      }
      if (this.isTypeStart() && !(this.classNames.has(t.v) && this.is('.', 1))) {
        // "String(x)" at statement start is an expression, not a declaration.
        if (!(TYPE_WORDS.has(t.v) && this.is('(', 1))) return this.parseDeclaration(false);
      }
    }
    const e = this.parseExpr();
    if (!this.is(';')) {
      throw this.expected("';'", 'A semicolon (;) is missing at the end of the statement.');
    }
    this.i++;
    return { k: 'expr', e, line: t.line, col: t.col };
  }

  // ---------- expressions ----------
  parseExpr() {
    let e = this.parseAssign();
    while (this.is(',')) {
      const t = this.next();
      e = { k: 'comma', a: e, b: this.parseAssign(), line: t.line, col: t.col };
    }
    return e;
  }

  parseAssign() {
    const left = this.parseCond();
    const t = this.peek();
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.i++;
      const right = this.parseAssign();
      return { k: 'assign', op: t.v, l: left, r: right, line: t.line, col: t.col };
    }
    return left;
  }

  parseCond() {
    const c = this.parseBin(1);
    if (this.is('?')) {
      const t = this.next();
      const a = this.parseExpr();
      this.expect(':');
      const b = this.parseCond();
      return { k: 'cond', c, a, b, line: t.line, col: t.col };
    }
    return c;
  }

  parseBin(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const prec = t.t === 'op' ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) break;
      this.i++;
      const right = this.parseBin(prec + 1);
      left = { k: 'bin', op: t.v, l: left, r: right, line: t.line, col: t.col };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') {
        this.i++;
        return { k: 'pre', op: t.v, e: this.parseUnary(), line: t.line, col: t.col };
      }
      if (['!', '~', '-', '+'].includes(t.v)) {
        this.i++;
        return { k: 'un', op: t.v, e: this.parseUnary(), line: t.line, col: t.col };
      }
      if (t.v === '&' || t.v === '*') {
        throw this.err(t, 'pointers are not supported by the NAFAS simulator', 'Pointers (& and *) are not supported by the simulator.');
      }
      if (t.v === '(' && this.isTypeStart(1)) {
        // C-style cast: (type) expr
        const save = this.i;
        this.i++;
        const type = this.parseType();
        if (this.accept(')')) return { k: 'cast', type, e: this.parseUnary(), line: t.line, col: t.col };
        this.i = save;
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.i++;
      if (this.is('(') && this.isTypeStart(1)) {
        this.i++;
        const type = this.parseType();
        this.expect(')');
        return { k: 'sizeof', type, line: t.line, col: t.col };
      }
      return { k: 'sizeof', e: this.parseUnary(), line: t.line, col: t.col };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  parsePostfix(e) {
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') return e;
      if (t.v === '(') {
        this.i++;
        const args = [];
        if (!this.is(')')) {
          do {
            if (this.is(')')) throw this.expected('primary-expression');
            args.push(this.parseAssign());
          } while (this.accept(','));
        }
        this.expect(')');
        e = { k: 'call', callee: e, args, line: e.line, col: e.col };
      } else if (t.v === '[') {
        this.i++;
        const idx = this.parseExpr();
        this.expect(']');
        e = { k: 'index', obj: e, idx, line: t.line, col: t.col };
      } else if (t.v === '.' || t.v === '->') {
        this.i++;
        const name = this.identifier();
        e = { k: 'member', obj: e, name: name.v, line: name.line, col: name.col };
      } else if (t.v === '++' || t.v === '--') {
        this.i++;
        e = { k: 'post', op: t.v, e, line: t.line, col: t.col };
      } else if (t.v === '::') {
        throw this.err(t, "'::' is not supported by the NAFAS simulator");
      } else return e;
    }
  }

  parsePrimary() {
    const t = this.peek();
    if (t.t === 'num') { this.i++; return { k: 'num', tok: t, line: t.line, col: t.col }; }
    if (t.t === 'str') {
      this.i++;
      let v = t.v;
      while (this.peek().t === 'str') v += this.next().v; // "a" "b" concatenation
      return { k: 'str', v, line: t.line, col: t.col };
    }
    if (t.t === 'chr') { this.i++; return { k: 'chr', v: t.v, line: t.line, col: t.col }; }
    if (t.t === 'id') {
      this.i++;
      if (TYPE_WORDS.has(t.v) && this.is('(')) {
        // functional cast: int(x), float(x), String(x, DEC)
        return { k: 'fcast', name: t.v, line: t.line, col: t.col };
      }
      return { k: 'id', name: t.v, line: t.line, col: t.col };
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const e = this.parseExpr();
      this.expect(')');
      return { k: 'paren', e, line: t.line, col: t.col };
    }
    if (t.t === 'eof') throw this.expected('primary-expression');
    throw this.err(t, `expected primary-expression before ${describeToken(t)}`,
      t.v === ')' ? 'An expression is missing inside the parentheses.' : 'A value or an expression was expected here.');
  }
}
