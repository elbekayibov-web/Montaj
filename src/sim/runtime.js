// Executes a compiled sketch against the virtual hardware.
//
// `hw` is the bridge to the room simulation (sensor values) and to the UI
// (pin changes, serial output). See Runtime.constructor for the contract.

class Halt extends Error {}

const wrap = (bits, signed) => {
  const m = 2 ** bits;
  if (bits === 32) return signed ? (v) => (toNum(v) | 0) : (v) => (toNum(v) >>> 0);
  if (bits === 16) return signed ? (v) => ((toNum(v) << 16) >> 16) : (v) => (toNum(v) & 0xffff);
  if (bits === 8) return signed ? (v) => ((toNum(v) << 24) >> 24) : (v) => (toNum(v) & 0xff);
  return (v) => {
    const x = Math.trunc(toNum(v));
    return signed ? x : ((x % m) + m) % m;
  };
};
function toNum(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 0 : v > 0 ? -1 : 0;
  // Math.trunc first so bit ops on large doubles wrap the way a cast does.
  const t = Math.trunc(v);
  return Math.abs(t) >= 2 ** 31 ? Number(BigInt.asIntN(32, BigInt(t))) : t;
}

// Arduino's Print::print(double, digits)
export function formatFloat(v, digits = 2) {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (v > 4294967040 || v < -4294967040) return 'ovf';
  const d = Math.max(0, Math.min(Math.trunc(digits), 20));
  let s = v < 0 ? '-' : '';
  let x = Math.abs(v);
  // Arduino rounds by adding 0.5 / 10^digits, then prints digit by digit.
  x += 0.5 / 10 ** d;
  const int = Math.floor(x);
  s += String(int);
  if (d > 0) {
    s += '.';
    let rem = x - int;
    for (let i = 0; i < d; i++) {
      rem *= 10;
      const dig = Math.floor(rem);
      s += dig;
      rem -= dig;
    }
  }
  return s;
}

function baseStr(v, base, unsigned) {
  if (base === 10 || !base) return String(Math.trunc(v));
  let n = Math.trunc(v);
  if (n < 0 && !unsigned) n = n >>> 0;
  return n.toString(base).toUpperCase();
}

export const helpers = {
  i8: wrap(8, true), u8: wrap(8, false), i16: wrap(16, true), u16: wrap(16, false),
  i32: wrap(32, true), u32: wrap(32, false), i64: wrap(64, true), u64: wrap(64, false),
  div(a, b) {
    if (b === 0) return a >= 0 ? -1 : 1;
    return Math.trunc(a / b);
  },
  mod(a, b) { return b === 0 ? a : a % b; },
  at(arr, i) {
    const v = arr[i];
    return v === undefined ? 0 : v;
  },
  arr(dims, fill) {
    const make = (d) => (d.length === 1 ? new Array(d[0] || 0).fill(fill) : Array.from({ length: d[0] || 0 }, () => make(d.slice(1))));
    return make(dims);
  },
  chars(a) {
    let s = '';
    for (const c of a) { if (!c) break; s += String.fromCharCode(c & 255); }
    return s;
  },
  // "text" + n in C moves the pointer; past the end you get whatever is in RAM.
  ptradd(s, n) {
    if (n >= 0 && n <= s.length) return s.slice(n);
    const junk = '\u0000ÿ\u0012?\u0007';
    return n < 0 ? junk + s : junk.slice(0, 3);
  },
  fstr: formatFloat,
  base(v, b, u) { return baseStr(v, b, u); },
  toInt(s) {
    const m = String(s).trim().match(/^[+-]?\d+/);
    return m ? (parseInt(m[0], 10) | 0) : 0;
  },
  toFloat(s) {
    const m = String(s).trim().match(/^[+-]?(\d+\.?\d*|\.\d+)/);
    return m ? parseFloat(m[0]) : 0;
  },
  substring(s, a, b) { return b === undefined ? s.substring(a) : s.substring(a, b); },
  charAt(s, i) { return i >= 0 && i < s.length ? s.charCodeAt(i) : 0; },
  cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
  remove(s, i, n) { return n === undefined ? s.slice(0, i) : s.slice(0, i) + s.slice(i + n); },
  setCharAt(s, i, c) { return i < s.length ? s.slice(0, i) + String.fromCharCode(c) + s.slice(i + 1) : s; },
  map(x, a, b, c, d) {
    if (b === a) return helpers.i32(c);
    return helpers.i32(Math.trunc(((x - a) * (d - c)) / (b - a)) + c);
  },
  constrain(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; },
  round(x) { return x >= 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5); },
};

export class Runtime {
  /**
   * @param board   board descriptor from boards.js
   * @param hw      {
   *   readSensor(key) -> physical value (propane/methane ppm, temperature °C, humidity %)
   *   onPin(pin, state)          pin output changed: {mode, value, pwm, tone}
   *   onSerial(text)             bytes written by the sketch
   *   onSerialBegin(baud)
   *   onDiag(code, message)      one-shot hints for the student (e.g. forgot pinMode)
   *   onError(err)               runtime crash
   * }
   */
  constructor(board, hw) {
    this.board = board;
    this.hw = hw;
    this.running = false;
    this.timers = new Set();
    this.reset();
  }

  reset() {
    this.pins = new Map(); // pin -> {mode, value, pwm, tone}
    this.t0 = performance.now();
    this.ticks = 0;
    this.lastYield = performance.now();
    this.baud = 0;
    this.rx = [];
    this.serialTimeout = 1000;
    this.txFreeAt = 0;
    this.diagShown = new Set();
    this.rng = 0x2545f491;
    this.adcBits = this.board.adcBits;
    this.floating = new Map();
    this.toneStop = null;
  }

  // ---------- lifecycle ----------
  async start(programFactory) {
    this.stop();
    this.reset();
    const gen = this.generation = (this.generation || 0) + 1;
    this.running = true;
    const api = this.api();
    let prog;
    try {
      prog = programFactory(api, helpers);
      await prog.init();
      await prog.setup();
      while (this.running && gen === this.generation) {
        await prog.loop();
        await api.tick(true);
      }
    } catch (e) {
      if (e instanceof Halt || gen !== this.generation) return;
      this.running = false;
      this.hw.onError?.(e);
    }
  }

  stop() {
    this.running = false;
    this.generation = (this.generation || 0) + 1;
    for (const t of this.timers) { clearTimeout(t.id); t.reject(new Halt()); }
    this.timers.clear();
    if (this.pins) {
      for (const [pin, st] of this.pins) {
        if (st.value || st.tone || st.pwm) this.hw.onPin?.(pin, { mode: 0, value: 0, pwm: 0, tone: 0 });
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve, reject) => {
      if (!this.running) { reject(new Halt()); return; }
      const t = { reject };
      t.id = setTimeout(() => {
        this.timers.delete(t);
        if (this.running) resolve(); else reject(new Halt());
      }, Math.max(0, ms));
      this.timers.add(t);
    });
  }

  diag(code, msg) {
    if (this.diagShown.has(code)) return;
    this.diagShown.add(code);
    this.hw.onDiag?.(code, msg);
  }

  pin(p) {
    if (!this.pins.has(p)) this.pins.set(p, { mode: 0, value: 0, pwm: 0, tone: 0 });
    return this.pins.get(p);
  }

  emitPin(p) {
    this.hw.onPin?.(p, { ...this.pin(p) });
  }

  validPin(p, fn) {
    if (!Number.isInteger(p) || p < 0 || p >= this.board.digitalPins + (this.board.arch === 'esp32' ? 0 : 0)) {
      this.diag(`badpin-${fn}-${p}`, `${fn}(${p}, …): ${this.board.name} platasida ${p}-pin yo‘q — buyruq e’tiborsiz qoldirildi.`);
      return false;
    }
    return true;
  }

  // Deterministic-ish noise so repeated runs look alike.
  rand() {
    this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5;
    return ((this.rng >>> 0) % 100000) / 100000;
  }

  api() {
    const rt = this;
    const B = this.board;
    const W = B.wiring;
    const ADC_BITS_NATIVE = B.adcBits;
    const nameOf = (p) => {
      const a = Object.entries(B.analogNames).find(([, v]) => v === p);
      return a && B.arch === 'avr' ? a[0] : `${p}`;
    };
    const serial = {
      async begin(baud) {
        rt.baud = Math.trunc(baud);
        rt.hw.onSerialBegin?.(rt.baud);
        await rt.sleep(0);
      },
      async end() { rt.baud = 0; },
      async emit(text) {
        if (!rt.baud) {
          rt.diag('nobegin', 'Serial.print ishlatilgan, lekin setup() ichida Serial.begin(9600) chaqirilmagan — Serial Monitor’da hech narsa chiqmaydi.');
          return 0;
        }
        const now = performance.now();
        const perByte = 10000 / rt.baud; // ms per byte (8N1)
        rt.txFreeAt = Math.max(rt.txFreeAt, now) + text.length * perByte;
        rt.hw.onSerial?.(text);
        // Block like the real 64-byte TX buffer once it is full.
        const backlog = rt.txFreeAt - now - 64 * perByte;
        if (backlog > 4) await rt.sleep(backlog);
        return text.length;
      },
      fmt(v, tag, f) {
        if (typeof v === 'boolean') v = v ? 1 : 0;
        switch (tag) {
          case 'f': return formatFloat(v, f === undefined ? 2 : f);
          case 'c': return f === undefined ? String.fromCharCode(v & 255) : baseStr(v, f, false);
          case 's': return String(v);
          case 'a': return helpers.chars(v);
          case 'b': return String(v ? 1 : 0);
          case 'u': return baseStr(v, f ?? 10, true);
          default: return baseStr(v, f ?? 10, false);
        }
      },
      async print(v, tag, f) { return serial.emit(serial.fmt(v, tag, f)); },
      async println(v, tag, f) { return serial.emit(`${v === undefined ? '' : serial.fmt(v, tag, f)}\r\n`); },
      async write(v, tag) { return serial.emit(tag === 's' ? String(v) : String.fromCharCode(v & 255)); },
      async printf(fmt, args) {
        let i = 0;
        const out = String(fmt).replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?(l{0,2}|h{0,2})([diufsxXc%])/g, (m, flags, width, prec, _len, conv) => {
          if (conv === '%') return '%';
          const [val, tag] = args[i++] || [0, 'i'];
          let s;
          if (conv === 'f') s = Number(val).toFixed(prec === undefined ? 6 : +prec);
          else if (conv === 's') s = tag === 'a' ? helpers.chars(val) : String(val);
          else if (conv === 'c') s = String.fromCharCode(val);
          else if (conv === 'x' || conv === 'X') { s = (Math.trunc(val) >>> 0).toString(16); if (conv === 'X') s = s.toUpperCase(); }
          else if (conv === 'u') s = String(Math.trunc(val) >>> 0);
          else s = String(Math.trunc(val));
          const w = +width || 0;
          if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : s.padStart(w, flags.includes('0') ? '0' : ' ');
          return s;
        });
        return serial.emit(out);
      },
      async available() { await rt.tickIfBusy(); return rt.rx.length; },
      async availableForWrite() { return 63; },
      async read() { await rt.tickIfBusy(); return rt.rx.length ? rt.rx.shift() : -1; },
      async peek() { return rt.rx.length ? rt.rx[0] : -1; },
      async timedRead() {
        const start = performance.now();
        while (!rt.rx.length) {
          if (performance.now() - start >= rt.serialTimeout) return -1;
          await rt.sleep(5);
        }
        return rt.rx.shift();
      },
      async readString() {
        let s = '';
        for (let c = await serial.timedRead(); c >= 0; c = await serial.timedRead()) s += String.fromCharCode(c);
        return s;
      },
      async readStringUntil(term) {
        let s = '';
        for (let c = await serial.timedRead(); c >= 0 && c !== term; c = await serial.timedRead()) s += String.fromCharCode(c);
        return s;
      },
      async parseNumber(float) {
        // Skip non-numeric, then read digits (Stream::parseInt semantics, timeout aware).
        let c;
        for (;;) {
          c = await serial.peekTimed();
          if (c < 0) return 0;
          const ch = String.fromCharCode(c);
          if (/[0-9-]/.test(ch) || (float && ch === '.')) break;
          rt.rx.shift();
        }
        let s = '';
        for (;;) {
          c = await serial.peekTimed();
          if (c < 0) break;
          const ch = String.fromCharCode(c);
          if (!(/[0-9]/.test(ch) || (ch === '-' && !s) || (float && ch === '.' && !s.includes('.')))) break;
          s += ch;
          rt.rx.shift();
        }
        return float ? (parseFloat(s) || 0) : (parseInt(s, 10) | 0 || 0);
      },
      async peekTimed() {
        const start = performance.now();
        while (!rt.rx.length) {
          if (performance.now() - start >= rt.serialTimeout) return -1;
          await rt.sleep(5);
        }
        return rt.rx[0];
      },
      async parseInt() { return serial.parseNumber(false); },
      async parseFloat() { return serial.parseNumber(true); },
      async setTimeout(ms) { rt.serialTimeout = Math.max(0, ms); },
      async flush() {
        const wait = rt.txFreeAt - performance.now();
        if (wait > 0) await rt.sleep(wait);
      },
    };

    return {
      serial,
      async tick(force) {
        if (!rt.running) throw new Halt();
        rt.ticks++;
        const now = performance.now();
        if (force || now - rt.lastYield > 12) {
          rt.lastYield = now;
          await rt.sleep(0);
        }
      },
      async delay(ms) {
        ms = Math.max(0, Math.trunc(ms)) >>> 0;
        await rt.sleep(ms);
      },
      async delayMicroseconds(us) {
        if (us > 1000) await rt.sleep(us / 1000);
        else await rt.tickIfBusy();
      },
      async millis() { return Math.floor(performance.now() - rt.t0) >>> 0; },
      async micros() { return Math.floor((performance.now() - rt.t0) * 1000) >>> 0; },
      async pinMode(p, m) {
        if (!rt.validPin(p, 'pinMode')) return;
        const st = rt.pin(p);
        st.mode = m;
        rt.emitPin(p);
      },
      async digitalWrite(p, v) {
        if (!rt.validPin(p, 'digitalWrite')) return;
        const st = rt.pin(p);
        st.value = v ? 1 : 0;
        st.pwm = 0;
        if (st.mode !== 1 && (p === W.buzzer || p === W.led)) {
          rt.diag(`nomode-${p}`, `digitalWrite(${nameOf(p)}, …) ishladi, lekin pinMode(${nameOf(p)}, OUTPUT) yozilmagan. Haqiqiy platada pin chiqishga sozlanmagani uchun ${p === W.buzzer ? 'buzzer ovoz chiqarmaydi' : 'LED juda xira yonadi'}.`);
        }
        rt.emitPin(p);
      },
      async digitalRead(p) {
        if (!rt.validPin(p, 'digitalRead')) return 0;
        const st = rt.pin(p);
        if (st.mode === 1) return st.value;
        if (st.mode === 2 && p !== W.button) return 1;
        if (p === W.dht) return 1; // DHT data line idles high (pull-up)
        if (p === W.pir) return rt.hw.readSensor('motion') ? 1 : 0; // PIR drives its output
        if (p === W.button) {
          // Button connects the pin to GND: pressed = LOW. Without the pull-up it floats.
          if (rt.hw.readSensor('button')) return 0;
          if (st.mode === 2) return 1;
          rt.diag('btn-float', `Tugma ${nameOf(p)}-pinda: pinMode(${nameOf(p)}, INPUT_PULLUP) yozilmagan, shuning uchun bosilmaganda qiymat tasodifiy (suzuvchi).`);
          return rt.rand() > 0.5 ? 1 : 0;
        }
        return rt.rand() > 0.5 ? 1 : 0; // floating input
      },
      async analogRead(p) {
        await rt.tickIfBusy();
        // Accept 0..5 as channel numbers on AVR, like the core does.
        if (B.arch === 'avr' && p >= 0 && p < 8) p += 14;
        const max = 2 ** rt.adcBits - 1;
        const nativeMax = 2 ** ADC_BITS_NATIVE - 1;
        let frac;
        if (p === W.propane) frac = mqVoltage(rt.hw.readSensor('propane') + 0.12 * rt.hw.readSensor('methane'), 2600) / 5;
        else if (p === W.methane) frac = mqVoltage(rt.hw.readSensor('methane') + 0.1 * rt.hw.readSensor('propane'), 3400) / 5;
        else if (p === W.dht) frac = 0.97; // DHT data line idles high
        else {
          const isAnalog = Object.values(B.analogNames).includes(p);
          if (!isAnalog) {
            rt.diag(`notanalog-${p}`, `analogRead(${p}): bu pin analog kirish emas yoki unga hech narsa ulanmagan — tasodifiy qiymatlar keladi.`);
          } else {
            rt.diag(`floating-${p}`, `analogRead(${nameOf(p)}): bu pinga sensor ulanmagan, qiymatlar “suzib” yuradi. Gaz sensorlari: propan ${nameOf(W.propane)}, metan ${nameOf(W.methane)}.`);
          }
          const prev = rt.floating.get(p) ?? 0.35;
          const next = Math.min(0.8, Math.max(0.1, prev + (rt.rand() - 0.5) * 0.08));
          rt.floating.set(p, next);
          frac = next;
        }
        const noise = (rt.rand() - 0.5) * 3 / nativeMax;
        return Math.max(0, Math.min(max, Math.round((frac + noise) * max)));
      },
      async analogReadResolution(bits) { rt.adcBits = Math.max(1, Math.min(16, bits)); },
      async analogWrite(p, v) {
        if (!rt.validPin(p, 'analogWrite')) return;
        const st = rt.pin(p);
        v = Math.max(0, Math.min(255, Math.trunc(v)));
        if (B.pwmPins && !B.pwmPins.includes(p)) {
          rt.diag(`pwm-${p}`, `analogWrite(${p}, …): ${B.name} platasida ${p}-pin PWM emas (PWM pinlar: ${B.pwmPins.join(', ')}). Pin faqat HIGH/LOW bo‘ladi.`);
          st.value = v >= 128 ? 1 : 0;
          st.pwm = 0;
        } else {
          st.pwm = v;
          st.value = v > 0 ? 1 : 0;
        }
        if (st.mode !== 1) st.mode = 1; // analogWrite sets the pin to output
        rt.emitPin(p);
      },
      async tone(p, freq, dur) {
        if (!rt.validPin(p, 'tone')) return;
        const st = rt.pin(p);
        st.tone = Math.max(31, Math.trunc(freq));
        st.mode = 1;
        rt.emitPin(p);
        if (rt.toneStop) clearTimeout(rt.toneStop);
        if (dur) {
          const gen = rt.generation;
          rt.toneStop = setTimeout(() => {
            if (gen !== rt.generation) return;
            st.tone = 0;
            rt.emitPin(p);
          }, dur);
        }
      },
      async noTone(p) {
        const st = rt.pin(p);
        st.tone = 0;
        st.value = 0;
        rt.emitPin(p);
      },
      async pulseIn() { await rt.sleep(1); return 0; },
      async randomSeed(s) { rt.rng = (Math.trunc(s) | 0) || 0x2545f491; },
      async random(a, b) {
        const [lo, hi] = b === undefined ? [0, a] : [a, b];
        if (hi <= lo) return lo;
        return lo + Math.floor(rt.rand() * (hi - lo));
      },
      newDHT(pin, type) {
        let begun = false;
        let lastRead = -1e9;
        let cache = { t: NaN, h: NaN };
        const read = () => {
          const now = performance.now();
          if (!begun) {
            rt.diag('dht-begin', 'dht.begin() chaqirilmagan — DHT sensor o‘qilmaydi (nan). setup() ichiga dht.begin(); qo‘shing.');
            return { t: NaN, h: NaN };
          }
          if (pin !== W.dht) {
            rt.diag('dht-pin', `DHT sensor ${nameOf(pin)}-pin deb ko‘rsatilgan, lekin u ${nameOf(W.dht)}-pinga ulangan. Natija: nan (o‘qib bo‘lmadi).`);
            return { t: NaN, h: NaN };
          }
          if (type !== 22 && type !== 21) {
            rt.diag('dht-type', `Sensor turi noto‘g‘ri: ulangan sensor DHT22, kodda DHT${type}. Qiymatlar buzilib keladi.`);
          }
          if (now - lastRead >= 2000) {
            lastRead = now;
            const t = rt.hw.readSensor('temperature') + (rt.rand() - 0.5) * 0.2;
            const h = rt.hw.readSensor('humidity') + (rt.rand() - 0.5) * 0.6;
            // A DHT22 decoded with the DHT11 protocol gives nonsense numbers.
            cache = type === 22 || type === 21
              ? { t: Math.round(t * 10) / 10, h: Math.round(h * 10) / 10 }
              : { t: Math.round(t * 0.39), h: Math.round(h * 2.1) };
          }
          return cache;
        };
        return {
          begin() { begun = true; lastRead = -1e9; },
          read() { return !Number.isNaN(read().t); },
          readTemperature(isF = false) {
            const t = read().t;
            return isF ? t * 1.8 + 32 : t;
          },
          readHumidity() { return read().h; },
          computeHeatIndex(t, h, isF = true) {
            const T = isF ? t : t * 1.8 + 32;
            let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + h * 0.094);
            if (hi > 79) {
              hi = -42.379 + 2.04901523 * T + 10.14333127 * h - 0.22475541 * T * h - 0.00683783 * T * T
                - 0.05481717 * h * h + 0.00122874 * T * T * h + 0.00085282 * T * h * h - 0.00000199 * T * T * h * h;
            }
            return isF ? hi : (hi - 32) / 1.8;
          },
        };
      },
    };
  }

  async tickIfBusy() {
    const now = performance.now();
    if (now - this.lastYield > 12) {
      this.lastYield = now;
      await this.sleep(0);
    }
    if (!this.running) throw new Halt();
  }

  // Bytes typed into the Serial Monitor.
  feed(text) {
    for (const ch of text) this.rx.push(ch.charCodeAt(0) & 255);
    if (this.rx.length > 64) this.rx.splice(0, this.rx.length - 64); // 64-byte RX buffer overflow
  }
}

// MQ-x module output: ~0.4 V in clean air rising towards ~4 V with gas.
export function mqVoltage(ppm, k) {
  return 0.4 + 3.6 * (1 - Math.exp(-Math.max(0, ppm) / k));
}
