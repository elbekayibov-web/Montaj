// Ready-made sketches. {{PIN}} placeholders are filled with the wiring of the
// selected board (see exampleCode below).

export const EXAMPLES = [
  {
    id: 'nafas',
    file: 'nafas_nano.ino',
    title: 'NAFAS Nano monitor',
    note: 'Beep-beep above 40 °C, alarm on gas',
    code: `// NAFAS Nano — room safety monitor
// DHT22 temperature, MQ-2 propane and MQ-4 methane sensors.
#include <DHT.h>

#define DHTPIN {{DHT}}
#define PROPANE_PIN {{PROPAN}}
#define METHANE_PIN {{METAN}}
#define BUZZER {{BUZZER}}
#define LED {{LED}}

DHT dht(DHTPIN, DHT22);

const float MAX_TEMP = 40.0;   // °C
const int MAX_PROPANE = 200;   // raw sensor value
const int MAX_METHANE = 220;

void beep(int count, int ms) {
  for (int i = 0; i < count; i++) {
    tone(BUZZER, 2800);
    delay(ms);
    noTone(BUZZER);
    delay(ms);
  }
}

void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
  beep(2, 80);
  Serial.println("NAFAS Nano ready");
}

void loop() {
  float t = dht.readTemperature();
  int propane = analogRead(PROPANE_PIN);
  int methane = analogRead(METHANE_PIN);

  Serial.print("T=");
  Serial.print(t, 1);
  Serial.print("C  propane=");
  Serial.print(propane);
  Serial.print("  methane=");
  Serial.println(methane);

  bool gas = propane > MAX_PROPANE || methane > MAX_METHANE;

  if (gas) {
    Serial.println("DANGER: gas leak!");
    digitalWrite(LED, HIGH);
    beep(6, 70);              // fast alarm
  } else if (t > MAX_TEMP) {
    Serial.println("WARNING: too hot!");
    digitalWrite(LED, HIGH);
    beep(2, 90);              // beep-beep
    delay(600);
  } else {
    digitalWrite(LED, LOW);
    delay(1000);
  }
}
`,
  },
  {
    id: 'gaz',
    file: 'gas_sensor.ino',
    title: 'Gas sensor (photo sketch)',
    note: '3 start-up beeps, alarm above 200',
    code: `// NAFAS — gas leak detection
// MQ-2 (propane) on {{PROPAN}}, buzzer on pin {{BUZZER}}.

#define GAS_PIN {{PROPAN}}
#define BUZZER {{BUZZER}}

int threshold = 200;   // raw sensor value

void setup() {
  Serial.begin(9600);
  pinMode(BUZZER, OUTPUT);

  // three short beeps on start-up
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER, HIGH);
    delay(150);
    digitalWrite(BUZZER, LOW);
    delay(150);
  }
  Serial.println("NAFAS ready!");
}

void loop() {
  int gas = analogRead(GAS_PIN);

  Serial.print("Gas level: ");
  Serial.println(gas);

  if (gas > threshold) {
    Serial.println("DANGER! Gas leak!");
    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(BUZZER, LOW);
    delay(100);
  } else {
    Serial.println("Safe");
    digitalWrite(BUZZER, LOW);
    delay(500);
  }
}
`,
  },
  {
    id: 'harorat',
    file: 'temperature.ino',
    title: 'Temperature 40 °C',
    note: 'Turn the heater on and wait',
    code: `// NAFAS — temperature watch (DHT22 on {{DHT}})
#include <DHT.h>

#define DHTPIN {{DHT}}
#define BUZZER {{BUZZER}}
#define LED {{LED}}

DHT dht(DHTPIN, DHT22);
float limit = 40.0;   // °C

void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  float temperature = dht.readTemperature();

  Serial.print("Temperature: ");
  Serial.print(temperature, 1);
  Serial.println(" C");

  if (temperature > limit) {
    Serial.println("WARNING: temperature too high!");
    digitalWrite(LED, HIGH);
    tone(BUZZER, 2800, 120);   // beep
    delay(220);
    tone(BUZZER, 2800, 120);   // beep
  } else {
    digitalWrite(LED, LOW);
  }
  delay(1000);
}
`,
  },
  {
    id: 'tugma',
    file: 'silence_button.ino',
    title: 'Silence button',
    note: 'Press the button in the circuit',
    code: `// The alarm beeps while gas is detected; the button silences it.
#define GAS_PIN {{PROPAN}}
#define BUTTON {{BUTTON}}
#define LED {{LED}}
#define BUZZER {{BUZZER}}

bool muted = false;

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  int gas = analogRead(GAS_PIN);
  bool danger = gas > 200;

  // pressed = LOW because of INPUT_PULLUP
  if (digitalRead(BUTTON) == LOW && danger && !muted) {
    muted = true;
    Serial.println("Alarm silenced");
  }
  if (!danger) muted = false;

  digitalWrite(LED, danger ? HIGH : LOW);
  digitalWrite(BUZZER, danger && !muted && (millis() / 200) % 2 ? HIGH : LOW);
  delay(20);
}
`,
  },
  {
    id: 'serial',
    file: 'serial_threshold.ino',
    title: 'Threshold over Serial',
    note: 'Type a number in the Serial Monitor',
    code: `// Change the alarm threshold from the Serial Monitor.
// Type for example 300 and press Enter.

int threshold = 200;

void setup() {
  Serial.begin(9600);
  pinMode({{BUZZER}}, OUTPUT);
  Serial.println("Type a new threshold:");
}

void loop() {
  if (Serial.available() > 0) {
    int value = Serial.parseInt();
    if (value > 0) {
      threshold = value;
      Serial.print("Threshold set to ");
      Serial.println(threshold);
    }
    while (Serial.available()) Serial.read();
  }

  int methane = analogRead({{METAN}});
  Serial.print("Methane: ");
  Serial.print(methane);
  Serial.print(" / ");
  Serial.println(threshold);

  digitalWrite({{BUZZER}}, methane > threshold ? HIGH : LOW);
  delay(700);
}
`,
  },
  {
    id: 'xato',
    file: 'find_the_bug.ino',
    title: 'Find the logic bug',
    note: 'Compiles, but behaves wrong',
    code: `// This sketch compiles, but it has two logic bugs.
// The buzzer should sound only when gas is detected. What is wrong?

int threshold = 200;

void setup() {
  Serial.begin(9600);
  pinMode({{BUZZER}}, OUTPUT);
}

void loop() {
  int gas = analogRead({{PROPAN}});
  Serial.print("Gas: ");
  Serial.println(gas);

  if (gas = threshold) {
    digitalWrite({{BUZZER}}, HIGH);
  }
  if (gas < threshold) {
    digitalWrite({{BUZZER}}, HIGH);
  }
  delay(500);
}
`,
  },
];

// Fill the {{PIN}} placeholders with the wiring of the selected board.
export function exampleCode(ex, board) {
  const w = board.wiring;
  const name = (pin) => {
    if (board.arch === 'avr') {
      const a = Object.entries(board.analogNames).find(([, v]) => v === pin);
      if (a) return a[0];
    }
    return String(pin);
  };
  const vals = {
    PROPAN: name(w.propane), METAN: name(w.methane), DHT: name(w.dht), PIR: name(w.pir), BUTTON: name(w.button),
    BUZZER: name(w.buzzer), LED: name(w.led), VREF: board.vref.toFixed(1), ADCMAX: String(2 ** board.adcBits - 1),
  };
  return ex.code.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k]);
}
