// Довідник ОВДП з відкритих даних НБУ.
//
// bank.gov.ua/depo_securities віддає повний реєстр цінних паперів в обігу разом
// із графіком виплат по кожному випуску — і робить це з `access-control-allow-origin: *`,
// тож тягнути можна прямо з браузера, без проксі.
//
// Одна відповідь ~580 КБ і містить усі ~200 випусків, фільтра по ISIN у API немає.
// Тому тягнемо ціликом і кешуємо: у пам'яті на час сесії + у sessionStorage,
// щоб перезавантаження вкладки не било по мережі знову.

const REGISTRY_URL = "https://bank.gov.ua/depo_securities?json";
const CACHE_KEY = "nbu-registry-v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // реєстр змінюється при нових розміщеннях, раз на добу вистачає

let inflight = null;   // проміс поточного запиту — щоб паралельні виклики не тягнули двічі
let memo = null;       // розібраний реєстр на час життя вкладки

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (!at || Date.now() - at > CACHE_TTL_MS) return null;
    return Array.isArray(data) ? data : null;
  } catch {
    return null; // приватний режим / переповнений storage — просто йдемо в мережу
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // 580 КБ можуть не влізти в квоту — це не привід ламати завантаження
  }
}

/** Завантажує (або віддає з кешу) весь реєстр ОВДП. Кидає Error з людським текстом. */
export async function fetchRegistry() {
  if (memo) return memo;

  const cached = readCache();
  if (cached) {
    memo = cached;
    return memo;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    let res;
    try {
      res = await fetch(REGISTRY_URL, { credentials: "omit" });
    } catch {
      throw new Error("Не вдалося зʼєднатися з bank.gov.ua. Перевір інтернет.");
    }
    if (!res.ok) throw new Error(`bank.gov.ua відповів ${res.status}. Спробуй пізніше.`);

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Несподіваний формат відповіді НБУ.");

    memo = data;
    writeCache(data);
    return data;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Скидає кеш — щоб підтягнути щойно розміщений випуск, якого ще не було вранці. */
export function clearRegistryCache() {
  memo = null;
  try { sessionStorage.removeItem(CACHE_KEY); } catch { /* нічого страшного */ }
}

const TYPE_1_COUPON = "1";
const TYPE_2_REDEMPTION = "2";

/**
 * Перетворює запис НБУ у графік виплат у форматі застосунку.
 * НБУ тримає купон і погашення окремими рядками з однаковою датою —
 * зводимо їх в один платіж, бо застосунок очікує саме так (kind "coupon+redemption").
 */
function toSchedule(rec) {
  const byDate = new Map();
  for (const p of rec.payments || []) {
    const date = String(p.pay_date || "").slice(0, 10);
    if (!date) continue;
    const entry = byDate.get(date) || { date, coupon: 0, principal: 0 };
    const val = Number(p.pay_val) || 0;
    if (String(p.pay_type) === TYPE_2_REDEMPTION) entry.principal += val;
    else if (String(p.pay_type) === TYPE_1_COUPON) entry.coupon += val;
    byDate.set(date, entry);
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, coupon, principal }) => {
      const kind = principal > 0
        ? (coupon > 0 ? "coupon+redemption" : "redemption")
        : "coupon";
      return {
        date,
        amountPerPiece: Math.round((coupon + principal) * 100) / 100,
        kind,
      };
    });
}

/** Частота купонів на рік з періоду в днях (182 → 2, 91 → 4, 364 → 1). */
function frequencyFromPeriod(days) {
  const n = Number(days);
  if (!n || n <= 0) return 2;
  const perYear = Math.round(365 / n);
  return [1, 2, 4, 12].includes(perYear) ? perYear : 2;
}

/**
 * Знаходить випуск за ISIN і повертає чернетку для довідника облігацій.
 * Повертає null, якщо такого ISIN у реєстрі немає.
 */
export async function lookupBond(isin) {
  const code = String(isin || "").trim().toUpperCase();
  if (code.length !== 12) return null;

  const registry = await fetchRegistry();
  const rec = registry.find(r => String(r.cpcode || "").toUpperCase() === code);
  if (!rec) return null;

  const schedule = toSchedule(rec);

  return {
    isin: code,
    type: "ovdp",                       // усі папери Мінфіну в цьому реєстрі — державні
    currency: rec.val_code || "UAH",
    faceValue: Number(rec.nominal) || 1000,
    // auk_proc у НБУ — саме КУПОННА ставка, а не дохідність до погашення.
    // Дохідність залежить від ціни покупки і рахується окремо (lotYTM).
    couponRate: Number(rec.auk_proc) || 0,
    couponFrequency: frequencyFromPeriod(rec.pay_period),
    issueDate: String(rec.razm_date || "").slice(0, 10),
    maturityDate: String(rec.pgs_date || "").slice(0, 10),
    issuer: rec.emit_name || "Міністерство фінансів України",
    ticker: "",
    notes: `Підтягнуто з реєстру НБУ ${new Date().toISOString().slice(0, 10)}. ${rec.cpdescr || ""}`.trim(),
    customSchedule: schedule.length > 0 ? schedule : null,
  };
}
