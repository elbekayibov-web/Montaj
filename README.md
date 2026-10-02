# NAFAS — virtual Arduino laboratoriyasi

**Sayt:** https://montaj-pi.vercel.app/ (Vercel — har bir push’dan keyin avtomatik yangilanadi)

Talaba Arduino kodini yozadi, **Verify** bilan tekshiradi, **Upload** bilan virtual
qurilmaga yuklaydi va 3D xonada qurilma aynan shu kod bo‘yicha qanday ishlashini
kuzatadi. Sayt TZ (texnik topshiriq) asosida qurilgan.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ — statik sayt, istalgan hostingga qo‘yiladi
npm test         # kompilyator va simulyator testlari
```

## Nima qilingan (TZ bo‘yicha)

| TZ bandi | Holat |
|---|---|
| 4–5. Kirish sahifasi | Olib tashlandi (so‘rov bo‘yicha): sayt to‘g‘ridan-to‘g‘ri xona bilan ochiladi. Interfeys tili — ingliz |
| 6. Virtual xona | ✅ Eshik, divan, televizor, isitkich (radiator), deraza, gaz quvuri; qurilma eshik yonida, devorning yuqorisida |
| 7. Sensor paneli | ✅ Harorat (°C), propan, metan — jonli qiymat, ADC qiymati, grafik |
| 8–9. Arduino IDE ko‘rinishidagi muharrir | ✅ To‘q tema, rangli kod, qator raqamlari, `.ino` yorlig‘i, Verify / Upload, plata tanlash |
| 10. Output + Serial Monitor | ✅ Matn yuborish, New Line, baud, autoscroll, vaqt belgisi, tozalash |
| 11. Uch holat (sintaksis xato / mantiqiy xato / to‘g‘ri) | ✅ Pastga qarang |
| 12–14. Equipments | ✅ Isitkich, propan sizishi, metan sizishi (+ deraza, qayta boshlash) |
| 15. Rasmdagi kod | ✅ “Misollar → Gaz sensori” — 3 marta signal, `Gaz darajasi:`, 200 dan oshsa xavf |

### Kod qanday bajariladi

Kod serverga yuborilmaydi — brauzerning o‘zida ishlaydi:

1. `src/sim/lexer.js`, `parser.js` — Arduino C++ kodini tahlil qiladi.
2. `src/sim/compiler.js` — xatolarni **gcc (Arduino IDE) so‘zlari bilan** chiqaradi
   (`expected ';' before '}' token`, `'serial' was not declared in this scope; did you mean 'Serial'?`)
   va har biriga o‘zbekcha izoh qo‘shadi. Keyin kodni JavaScript’ga o‘giradi.
3. `src/sim/runtime.js` — virtual platani ishga tushiradi: pinlar, `delay`, `millis`,
   `Serial` (baud tezligi bilan), `analogRead`, `tone`, DHT kutubxonasi.

Haqiqiy Arduino xatti-harakatlari saqlangan, chunki talaba aynan shularda xato qiladi:

- Uno/Nano’da `int` 16-bit: `300 * 300` → `24464`; ESP32’da 32-bit.
- `7 / 2` → `3`; `Serial.println(23.456)` → `23.46`.
- `"Gaz: " + gaz` — matn qo‘shilmaydi, ko‘rsatkich siljiydi (ogohlantirish chiqadi).
- `pinMode(…, OUTPUT)` unutilsa buzzer chalinmaydi; `Serial.begin` bo‘lmasa monitor bo‘sh.
- Monitor baud tezligi `Serial.begin` bilan mos kelmasa matn buzilib chiqadi.
- `if (x = 5)` va `if (...);` uchun ogohlantirish.
- Sensor ulanmagan pindan `analogRead` “suzuvchi” qiymat qaytaradi.

### Virtual ulanish (qurilmaning ichki sxemasi)

| Qism | Uno / Nano | ESP32 |
|---|---|---|
| MQ-2 propan | A0 | GPIO34 |
| MQ-4 metan | A1 | GPIO35 |
| DHT22 | A2 | GPIO4 |
| Buzzer (faol) | D8 | GPIO25 |
| Signal LED | D13 | GPIO2 |
| PIR (HC-SR501) | D10 | GPIO27 |
| Tugma → GND | D4 | GPIO0 |
| ESP32 Wi-Fi modul | TX (D1) | — |

Sxema Workbench’da jonli ko‘rsatiladi (Wokwi uslubida): LED yonadi, buzzer “chalinadi”,
tugmani sichqoncha bilan bosish mumkin, sensor qiymatlari ko‘rinadi.

### Xona

Kechki yoritish (CC0 “apartment” HDRI — `@pmndrs/assets`), ambient occlusion (N8AO),
Van Gog rasmlari (internet bo‘lsa Wikimedia’dan asl rasm, bo‘lmasa generativ nusxa),
oshxona burchagida propan ballon va sariq metan quvuri yonma-yon. Propan polga cho‘kadi,
metan shipga ko‘tariladi.

## Hali kelishilmagan (TZ 16–19)

- Yakuniy plata va sensorlar (hozir Uno, Nano va ESP32 tanlanadi; ulanish yuqorida).
- Gaz o‘lchov birligi va chegaralar: panelda virtual ppm, kod esa xom ADC qiymatini oladi.
- Uy egasiga ogohlantirish yuborish usuli, 10 metr radius, ChatGPT/AI yordamchi — qo‘shilmagan.
- Qo‘shilgan takliflar: grafiklar, qayta boshlash tugmasi, tayyor misollar, deraza, exploded 3D ko‘rinish.

## AI yordamchi (Gemini)

Sahifaning eng pastida **Assistant** bo‘limi bor. U saytning serveri (`api/chat.js`) orqali ishlaydi,
API kalit faqat Vercel’da saqlanadi va brauzerga yuborilmaydi:

1. aistudio.google.com → **Get API key** → **Create API key** (bepul limit bor).
2. Vercel → loyiha → **Settings → Environment Variables** → nomi `GEMINI_API_KEY`, qiymati — kalit → **Save**.
3. **Deployments** → oxirgi deploy → **⋯ → Redeploy**.

Yordamchining ko‘rsatmalari `api/_prompt.js` faylida — ularni shu yerda o‘zgartirish mumkin.
Saytni ochgan har kim (masalan, ustoz) shu server kaliti orqali yordamchidan foydalanadi, o‘z kaliti kerak emas.

Ixtiyoriy: `GEMINI_MODEL` (standart `gemini-flash-latest`). `GEMINI_API_KEY` bo‘lmasa, `OPENAI_API_KEY` ishlatiladi.

Har bir savol bilan avtomatik yuboriladi: sketch (qator raqamlari bilan), ulanish sxemasi, kompilyator xatolari,
Serial Monitor’ning oxirgi qatorlari, sensor qiymatlari va xona holati. Model va API manzilini ham o‘zgartirish mumkin
(OpenAI bilan mos har qanday Chat Completions API).
