import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/sim/compiler.js';
import { Runtime } from '../src/sim/runtime.js';
import { BOARDS } from '../src/sim/boards.js';
import { EXAMPLES as RAW, exampleCode } from '../src/sim/examples.js';
const EXAMPLES = RAW.map((e) => ({ ...e, code: exampleCode(e, BOARDS.uno) }));

function build(code, board = BOARDS.uno) {
  const r = compile(code, board);
  return { ...r, factory: new Function('__rt', '__c', r.js) };
}

async function run(code, { ms = 400, board = BOARDS.uno, sensors = {}, input } = {}) {
  const { factory } = build(code, board);
  let out = '';
  const pins = [];
  const diags = [];
  let error = null;
  const s = { propane: 0, methane: 0, temperature: 24, humidity: 45, ...sensors };
  const rt = new Runtime(board, {
    readSensor: (k) => s[k],
    onSerial: (t) => { out += t; },
    onPin: (p, st) => pins.push([p, st.value, st.tone]),
    onDiag: (c, m) => diags.push(c),
    onError: (e) => { error = e; },
  });
  rt.start(factory);
  if (input) setTimeout(() => rt.feed(input), 50);
  await new Promise((r) => setTimeout(r, ms));
  rt.stop();
  if (error) throw error;
  return { out, pins, diags };
}

function errOf(code, board) {
  try { compile(code, board ?? BOARDS.uno); } catch (e) { return e; }
  assert.fail('expected compile error');
}

test('all examples compile on every board', () => {
  for (const ex of RAW) for (const b of Object.values(BOARDS)) {
    const r = build(exampleCode(ex, b), b);
    assert.ok(r.js.length > 50, ex.id);
  }
});

test('gas example: safe vs danger follows threshold', async () => {
  const safe = await run(EXAMPLES[0].code, { ms: 1400 });
  assert.match(safe.out, /NAFAS tayyor!/);
  assert.match(safe.out, /Gaz darajasi: \d+\r\nXavfsiz/);
  const danger = await run(EXAMPLES[0].code, { ms: 1400, sensors: { propane: 900 } });
  assert.match(danger.out, /XAVF!/);
  // Changing the threshold in code changes behaviour.
  const hi = await run(EXAMPLES[0].code.replace('int chegara = 200;', 'int chegara = 900;'), { ms: 1400, sensors: { propane: 900 } });
  assert.doesNotMatch(hi.out, /XAVF!/);
  // Changing the printed text changes the monitor.
  const txt = await run(EXAMPLES[0].code.replace('"Gaz darajasi: "', '"GAS = "'), { ms: 1400 });
  assert.match(txt.out, /GAS = \d+/);
});

test('temperature example with LM35 and DHT', async () => {
  const cold = await run(EXAMPLES[1].code, { ms: 300 });
  assert.match(cold.out, /Harorat: 2[34]\.\d C/);
  const hot = await run(EXAMPLES[1].code, { ms: 300, sensors: { temperature: 45 } });
  assert.match(hot.out, /DIQQAT/);
  const full = await run(EXAMPLES[2].code, { ms: 1500, sensors: { temperature: 45, methane: 2000 } });
  assert.match(full.out, /T=4[45]\.\dC/);
  assert.match(full.out, /XAVF! Bir nechta/);
});

test('serial input', async () => {
  const r = await run(EXAMPLES[3].code, { ms: 1500, input: '350\n' });
  assert.match(r.out, /Chegara o'zgardi: 350/);
});

test('C semantics', async () => {
  const code = `
void setup() {
  Serial.begin(9600);
  int a = 7 / 2;
  float f = 7 / 2;
  float g = 7 / 2.0;
  int big = 300 * 300;
  long l = 300L * 300;
  int x = 32767; x++;
  char c = 'A';
  String s = String("T=") + 23.456;
  Serial.println(a); Serial.println(f); Serial.println(g); Serial.println(big);
  Serial.println(l); Serial.println(x); Serial.println(c); Serial.println(c + 1);
  Serial.println(s); Serial.println(3.14159, 3); Serial.println(255, HEX);
  Serial.println("abcdef" + 2);
  Serial.println(10 > 3);
}
void loop() {}`;
  const r = await run(code, { ms: 100 });
  assert.equal(r.out, '3\r\n3.00\r\n3.50\r\n24464\r\n90000\r\n-32768\r\nA\r\n66\r\nT=23.46\r\n3.142\r\nFF\r\ncdef\r\n1\r\n');
});

test('int is 32-bit on ESP32', async () => {
  const r = await run('void setup(){Serial.begin(115200); int b = 300*300; Serial.println(b);} void loop(){}', { board: BOARDS.esp32, ms: 100 });
  assert.equal(r.out, '90000\r\n');
});

test('syntax errors use gcc wording', () => {
  let e = errOf('void setup() {\n  Serial.begin(9600)\n}\nvoid loop(){}');
  assert.equal(e.message, "expected ';' before '}' token");
  assert.equal(e.line, 2);
  e = errOf('void setup() {\n  serial.begin(9600);\n}\nvoid loop(){}');
  assert.match(e.message, /'serial' was not declared in this scope; did you mean 'Serial'\?/);
  e = errOf('void setup() {\n  Serial.prinln(1);\n}\nvoid loop(){}');
  assert.match(e.message, /has no member named 'prinln'; did you mean 'println'/);
  e = errOf('void setup() {\n  digitalwrite(8, HIGH);\n}\nvoid loop(){}');
  assert.match(e.message, /did you mean 'digitalWrite'/);
  e = errOf('void setup() {\n}\nvoid lop(){}');
  assert.match(e.message, /undefined reference to `loop'/);
  e = errOf('void setup() {\n  int x = 5;\n  if (x > 3) {\n}\nvoid loop(){}');
  assert.match(e.message, /a function-definition is not allowed here|expected '}' at end of input/);
  e = errOf('#include <WiFi.h>\nvoid setup(){}\nvoid loop(){}');
  assert.match(e.message, /WiFi.h: No such file or directory/);
  e = errOf('const int a = 5;\nvoid setup(){ a = 6; }\nvoid loop(){}');
  assert.match(e.message, /assignment of read-only variable 'a'/);
  e = errOf('void setup(){ float t = 2.5; Serial.println("T: " + t); }\nvoid loop(){}');
  assert.match(e.message, /invalid operands of types 'const char\*' and 'float'/);
  e = errOf('void setup(){ int x = 3 }\nvoid loop(){}');
  assert.match(e.message, /expected ',' or ';' before '}' token/);
  e = errOf('void setup(){ Serial.println(“hi”); }\nvoid loop(){}');
  assert.match(e.message, /stray/);
});

test('warnings for assignment in condition', () => {
  const r = compile(EXAMPLES[4].code, BOARDS.uno);
  assert.ok(r.warnings.some((w) => /parentheses/.test(w.msg)));
});

test('infinite loop without delay does not hang', async () => {
  const r = await run('void setup(){ Serial.begin(9600); while(true){ } } void loop(){}', { ms: 100 });
  assert.equal(r.out, '');
});

test('missing pinMode diag', async () => {
  const r = await run('void setup(){ digitalWrite(8, HIGH);} void loop(){}', { ms: 50 });
  assert.ok(r.diags.includes('nomode-8'));
});

test('ESP32 example uses ESP32 wiring', async () => {
  const r = await run(exampleCode(RAW[1], BOARDS.esp32), { board: BOARDS.esp32, ms: 300, sensors: { temperature: 45 } });
  assert.match(r.out, /Harorat: 4[45]\.\d C/);
});
