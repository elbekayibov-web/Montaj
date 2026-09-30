// Physics of the virtual living room: temperature, humidity and two gases.
// Values change smoothly so students can watch a threshold being crossed.

export const AMBIENT = 24;
const OUTSIDE = 12;

export class World {
  constructor() {
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.temperature = AMBIENT;
    this.humidity = 46;
    this.propane = 0; // ppm
    this.methane = 0; // ppm
    this.heater = false;
    this.propaneLeak = false;
    this.methaneLeak = false;
    this.window = false;
    this.motion = false; // someone in the room (PIR)
    this.button = false; // push button held down
    this.heaterPower = 0; // 0..1, coils warm up gradually
    this.history = [];
    this.t = 0;
    this.sampleAcc = 0;
    this.emit();
  }

  set(key, value) {
    this[key] = value;
    this.emit();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  step(dt) {
    dt = Math.min(dt, 0.25);
    this.t += dt;
    // Heater coils take a few seconds to reach full power.
    this.heaterPower += ((this.heater ? 1 : 0) - this.heaterPower) * Math.min(1, dt / 3);

    // Temperature: Newton heating/cooling towards an equilibrium.
    const target = this.window
      ? AMBIENT + this.heaterPower * 34 - 9
      : AMBIENT + this.heaterPower * 52;
    const tau = this.heaterPower > 0.05 ? 34 : this.window ? 30 : 55;
    const eq = this.window && this.heaterPower < 0.05 ? (AMBIENT + OUTSIDE) / 2 + 3 : target;
    this.temperature += (eq - this.temperature) * (dt / tau);

    // Humidity drops a little when the air is heated.
    const hTarget = 46 - (this.temperature - AMBIENT) * 0.55 + (this.window ? 6 : 0);
    this.humidity += (Math.max(18, Math.min(70, hTarget)) - this.humidity) * (dt / 20);

    // Gas: leak adds ppm, ventilation removes it exponentially.
    const vent = this.window ? 0.09 : 0.006;
    if (this.propaneLeak) this.propane += 70 * dt;
    if (this.methaneLeak) this.methane += 85 * dt;
    this.propane = Math.max(0, this.propane * (1 - vent * dt));
    this.methane = Math.max(0, this.methane * (1 - vent * 1.3 * dt));
    if (this.propane < 0.5 && !this.propaneLeak) this.propane = 0;
    if (this.methane < 0.5 && !this.methaneLeak) this.methane = 0;

    this.sampleAcc += dt;
    if (this.sampleAcc >= 0.5) {
      this.sampleAcc = 0;
      this.history.push({ t: this.t, temperature: this.temperature, propane: this.propane, methane: this.methane, humidity: this.humidity });
      if (this.history.length > 240) this.history.shift();
    }
    this.emit();
  }

  read(key) {
    return this[key];
  }
}
