// Експорт купонних виплат у календар iPhone (.ics).
//
// Чому саме так, а не Telegram-бот: дані портфеля живуть лише в браузері на
// телефоні. Щоб бот міг нагадувати, суми й дати довелося б покласти на сервер —
// тобто зламати головну властивість застосунку. Календар дає той самий
// результат (нагадування за три дні), але без сервера й без виходу даних
// за межі пристрою.

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}`;
};
// Екранування за RFC 5545: кома, крапка з комою й зворотний слеш — службові
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\n/g, "\\n");

/** Один VEVENT на подію виплати, з нагадуванням за `alarmDays` днів. */
export function buildIcs(events, { alarmDays = 3, title = "Daughters Fund" } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daughters Fund//UA//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(title)}`,
  ];

  for (const e of events) {
    const d = stamp(e.date);
    lines.push(
      "BEGIN:VEVENT",
      // Стабільний UID: повторний імпорт оновить подію, а не створить дубль
      `UID:${e.key}@daughters-fund`,
      `DTSTAMP:${stamp(new Date())}T000000Z`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(e.summary)}`,
      `DESCRIPTION:${esc(e.description || "")}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      `TRIGGER:-P${alarmDays}D`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(e.summary)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 вимагає CRLF
  return lines.join("\r\n") + "\r\n";
}

/** Завантажити .ics файл у «Файли» / календар. */
export function downloadIcs(text, filename = "daughters-fund.ics") {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
