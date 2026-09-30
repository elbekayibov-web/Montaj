// Ready-made sketches. The first one reproduces the program from the
// student's photos: three start-up beeps, reads the gas sensor, prints
// "Gaz darajasi:" and alarms above 200.

export const EXAMPLES = [
  {
    id: 'gaz',
    file: 'nafas_gaz.ino',
    title: 'Gaz sensori (propan)',
    note: 'Rasmdagi kod: 3 marta signal, gaz > 200 bo‘lsa xavf.',
    code: `// NAFAS — gaz sizishini aniqlash
// MQ-2 (propan) sensori {{PROPAN}} pinga, buzzer {{BUZZER}}-pinga ulangan.

#define GAS_PIN {{PROPAN}}
#define BUZZER {{BUZZER}}

int chegara = 200;   // xavf chegarasi (sensor qiymati)

void setup() {
  Serial.begin(9600);
  pinMode(BUZZER, OUTPUT);

  // Ishga tushganda 3 marta qisqa signal
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER, HIGH);
    delay(150);
    digitalWrite(BUZZER, LOW);
    delay(150);
  }
  Serial.println("NAFAS tayyor!");
}

void loop() {
  int gaz = analogRead(GAS_PIN);

  Serial.print("Gaz darajasi: ");
  Serial.println(gaz);

  if (gaz > chegara) {
    Serial.println("XAVF! Gaz sizib chiqmoqda!");
    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(BUZZER, LOW);
    delay(100);
  } else {
    Serial.println("Xavfsiz");
    digitalWrite(BUZZER, LOW);
    delay(500);
  }
}
`,
  },
  {
    id: 'harorat',
    file: 'nafas_harorat.ino',
    title: 'Harorat 40°C (DHT22)',
    note: 'Isitkichni yoqing — 40°C dan oshsa signal.',
    code: `// NAFAS — harorat nazorati
// DHT22 sensori {{DHT}} pinga ulangan.
#include <DHT.h>

#define DHTPIN {{DHT}}
#define BUZZER {{BUZZER}}
#define LED {{LED}}

DHT dht(DHTPIN, DHT22);
float chegara = 40.0;   // °C

void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  float harorat = dht.readTemperature();

  Serial.print("Harorat: ");
  Serial.print(harorat, 1);
  Serial.println(" C");

  if (harorat > chegara) {
    Serial.println("DIQQAT! Harorat juda yuqori!");
    digitalWrite(LED, HIGH);
    tone(BUZZER, 2000, 300);
  } else {
    digitalWrite(LED, LOW);
  }
  delay(1000);
}
`,
  },
  {
    id: 'harakat',
    file: 'nafas_harakat.ino',
    title: 'Harakat sensori + tugma',
    note: 'PIR harakatni sezadi, tugma signalni o‘chiradi.',
    code: `// Harakat sensori (HC-SR501) va signalni o'chirish tugmasi
#define PIR {{PIR}}
#define TUGMA {{BUTTON}}
#define LED {{LED}}
#define BUZZER {{BUZZER}}

bool signalYoniq = false;

void setup() {
  Serial.begin(9600);
  pinMode(PIR, INPUT);
  pinMode(TUGMA, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (digitalRead(PIR) == HIGH && !signalYoniq) {
    Serial.println("Xonada harakat bor!");
    signalYoniq = true;
  }

  // Tugma bosilganda LOW bo'ladi (INPUT_PULLUP)
  if (digitalRead(TUGMA) == LOW) {
    Serial.println("Signal o'chirildi");
    signalYoniq = false;
    delay(300);
  }

  digitalWrite(LED, signalYoniq ? HIGH : LOW);
  digitalWrite(BUZZER, signalYoniq && (millis() / 250) % 2 ? HIGH : LOW);
  delay(20);
}
`,
  },
  {
    id: 'toliq',
    file: 'nafas_nano.ino',
    title: 'To‘liq NAFAS (DHT22 + 2 gaz)',
    note: 'Harorat, propan va metan — xavf darajalari bilan.',
    code: `// NAFAS Nano — to'liq monitoring
#include <DHT.h>

#define DHTPIN {{DHT}}
#define DHTTYPE DHT22
#define PROPAN_PIN {{PROPAN}}
#define METAN_PIN {{METAN}}
#define BUZZER {{BUZZER}}
#define LED {{LED}}

DHT dht(DHTPIN, DHTTYPE);

const float MAX_HARORAT = 40.0;
const int MAX_PROPAN = 200;
const int MAX_METAN = 220;

unsigned long oldingiVaqt = 0;

void signal(int soni, int davomiylik) {
  for (int i = 0; i < soni; i++) {
    digitalWrite(BUZZER, HIGH);
    delay(davomiylik);
    digitalWrite(BUZZER, LOW);
    delay(davomiylik);
  }
}

void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
  signal(3, 120);
  Serial.println("NAFAS Nano ishga tushdi");
}

void loop() {
  if (millis() - oldingiVaqt < 1000) return;
  oldingiVaqt = millis();

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int propan = analogRead(PROPAN_PIN);
  int metan = analogRead(METAN_PIN);

  if (isnan(t)) {
    Serial.println("DHT sensorini o'qib bo'lmadi!");
    return;
  }

  Serial.print("T=");
  Serial.print(t, 1);
  Serial.print("C  H=");
  Serial.print(h, 0);
  Serial.print("%  Propan=");
  Serial.print(propan);
  Serial.print("  Metan=");
  Serial.println(metan);

  int xavf = 0;
  if (t > MAX_HARORAT) xavf++;
  if (propan > MAX_PROPAN) xavf++;
  if (metan > MAX_METAN) xavf++;

  if (xavf == 0) {
    digitalWrite(LED, LOW);
  } else if (xavf == 1) {
    Serial.println(">> Ogohlantirish: 1 ta ko'rsatkich me'yordan yuqori");
    digitalWrite(LED, HIGH);
    signal(1, 200);
  } else {
    Serial.println(">> XAVF! Bir nechta ko'rsatkich me'yordan yuqori!");
    digitalWrite(LED, HIGH);
    signal(4, 80);
  }
}
`,
  },
  {
    id: 'serial',
    file: 'nafas_sozlash.ino',
    title: 'Chegarani Serial orqali sozlash',
    note: 'Serial Monitor’ga son yozing — yangi chegara bo‘ladi.',
    code: `// Chegarani Serial Monitor orqali o'zgartirish
// Monitor'ga masalan 300 yozib Enter bosing.

int chegara = 200;

void setup() {
  Serial.begin(9600);
  pinMode({{BUZZER}}, OUTPUT);
  Serial.println("Yangi chegarani yozing:");
}

void loop() {
  if (Serial.available() > 0) {
    int yangi = Serial.parseInt();
    if (yangi > 0) {
      chegara = yangi;
      Serial.print("Chegara o'zgardi: ");
      Serial.println(chegara);
    }
    while (Serial.available()) Serial.read();
  }

  int metan = analogRead({{METAN}});
  Serial.print("Metan: ");
  Serial.print(metan);
  Serial.print(" / ");
  Serial.println(chegara);

  digitalWrite({{BUZZER}}, metan > chegara ? HIGH : LOW);
  delay(700);
}
`,
  },
  {
    id: 'xato',
    file: 'mantiqiy_xato.ino',
    title: 'Mantiqiy xatoni toping',
    note: 'Kod kompilyatsiya bo‘ladi, lekin noto‘g‘ri ishlaydi.',
    code: `// Bu kod kompilyatsiyadan o'tadi, lekin 2 ta mantiqiy xatosi bor.
// Gaz chiqqanda signal chalinishi kerak. Nima noto'g'ri?

int chegara = 200;

void setup() {
  Serial.begin(9600);
  pinMode({{BUZZER}}, OUTPUT);
}

void loop() {
  int gaz = analogRead({{PROPAN}});
  Serial.print("Gaz: ");
  Serial.println(gaz);

  if (gaz = chegara) {
    digitalWrite({{BUZZER}}, HIGH);
  }
  if (gaz < chegara) {
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
