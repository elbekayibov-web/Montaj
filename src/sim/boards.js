// Virtual boards supported by the simulator and the fixed "Nafas shield" wiring
// for each one. The wiring is what the student's sketch talks to: reading the
// propane pin returns the MQ-2 voltage, writing the buzzer pin makes a sound, etc.

export const BOARDS = {
  uno: {
    id: 'uno',
    name: 'Arduino Uno',
    fqbn: 'arduino:avr:uno',
    port: 'COM3',
    arch: 'avr',
    intBits: 16,
    adcBits: 10,
    vref: 5,
    flash: 32256,
    ram: 2048,
    digitalPins: 20,
    analogNames: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19 },
    pwmPins: [3, 5, 6, 9, 10, 11],
    ledBuiltin: 13,
    wiring: { propane: 14, methane: 15, dht: 16, buzzer: 8, led: 13, pir: 10, button: 4 },
  },
  nano: {
    id: 'nano',
    name: 'Arduino Nano',
    fqbn: 'arduino:avr:nano',
    port: 'COM4',
    arch: 'avr',
    intBits: 16,
    adcBits: 10,
    vref: 5,
    flash: 30720,
    ram: 2048,
    digitalPins: 22,
    analogNames: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21 },
    pwmPins: [3, 5, 6, 9, 10, 11],
    ledBuiltin: 13,
    wiring: { propane: 14, methane: 15, dht: 16, buzzer: 8, led: 13, pir: 10, button: 4 },
  },
  esp32: {
    id: 'esp32',
    name: 'ESP32 Dev Module',
    fqbn: 'esp32:esp32:esp32',
    port: 'COM7',
    arch: 'esp32',
    intBits: 32,
    adcBits: 12,
    vref: 3.3,
    flash: 1310720,
    ram: 327680,
    digitalPins: 40,
    analogNames: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35 },
    pwmPins: null, // every output pin can do PWM via LEDC
    ledBuiltin: 2,
    wiring: { propane: 34, methane: 35, dht: 4, buzzer: 25, led: 2, pir: 27, button: 0 },
  },
};

export function pinLabel(board, pin) {
  for (const [name, num] of Object.entries(board.analogNames)) {
    if (num === pin && board.arch === 'avr') return name;
  }
  return board.arch === 'esp32' ? `GPIO${pin}` : `D${pin}`;
}

export const WIRING_INFO = [
  { key: 'propane', part: 'MQ-2', role: 'Propane sensor (analog)' },
  { key: 'methane', part: 'MQ-4', role: 'Methane sensor (analog)' },
  { key: 'dht', part: 'DHT22', role: 'Temperature + humidity' },
  { key: 'buzzer', part: 'Buzzer', role: 'Active buzzer (HIGH = sound)' },
  { key: 'led', part: 'LED', role: 'Red alarm LED' },
  { key: 'pir', part: 'HC-SR501', role: 'Motion sensor (PIR)' },
  { key: 'button', part: 'Button', role: 'Button to GND (INPUT_PULLUP)' },
];
