// Buzzer sound via WebAudio. An active buzzer is a ~2.7 kHz square-ish tone;
// tone() uses the requested frequency.

export class Buzzer {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.muted = false;
    this.freq = 0;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5000;
    this.gain.connect(filter).connect(this.ctx.destination);
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 2700;
    this.osc.connect(this.gain);
    this.osc.start();
  }

  unlock() {
    this.ensure();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  // freq 0 = silent
  set(freq, level = 1) {
    this.freq = freq;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (freq > 0) this.osc.frequency.setTargetAtTime(freq, now, 0.002);
    const vol = freq > 0 && !this.muted ? 0.06 * level : 0;
    this.gain.gain.setTargetAtTime(vol, now, 0.004);
  }

  setMuted(m) {
    this.muted = m;
    this.set(this.freq);
  }
}
