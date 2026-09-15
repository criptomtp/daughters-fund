import { lotCurrentValue } from "./calculations.js";

// Відновлення історії портфеля.
//
// Знімки вартості застосунок робить лише коли його відкривають, а відкривають
// його раз на місяць — тому будувати криву зі знімків марно. Натомість історію
// рахуємо заново на будь-яку дату:
//
//   облігації — детерміновані: амортизована вартість + НКД на дату
//   готівка   — сума транзакцій до дати
//   крипта    — монети на дату × ціна BTC × курс долара на ту саму дату
//
// Ціни біткоїна беремо в CoinGecko (щоденні, рік назад), курс — у НБУ
// (щомісячні опорні точки з лінійною інтерполяцією між ними: гривня рухається
// плавно, тому щоденна точність тут нічого не додає, а 250 запитів — додають).

const DAY = 86400000;
const CACHE_KEY = "df_price_history";
const CACHE_TTL = 12 * 60 * 60 * 1000;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ts = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, btc, fx } = JSON.parse(raw);
    if (!at || Date.now() - at > CACHE_TTL) return null;
    return { btc, fx };
  } catch { return null; }
}

/**
 * Тягне історію цін. Повертає { btc: {дата: ціна USD}, fx: {дата: ₴/$} }.
 * Кидає Error з людським текстом — виклик має показати його, а не мовчати.
 */
export async function fetchPriceHistory(fromDate) {
  const cached = readCache();
  if (cached) return cached;

  const btc = {};
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily"
  ).catch(() => null);
  if (!res || !res.ok) throw new Error("Не вдалося завантажити історію ціни біткоїна.");
  const data = await res.json();
  for (const [t, price] of data.prices || []) btc[iso(t)] = price;

  // Опорні точки курсу: перше число кожного місяця від початку історії
  const fx = {};
  const start = ts(fromDate);
  const anchors = [];
  const d = new Date(start);
  d.setUTCDate(1);
  while (d.getTime() <= Date.now() + DAY) {
    anchors.push(iso(d.getTime()));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  anchors.push(iso(Date.now()));

  await Promise.all(anchors.map(async (day) => {
    const r = await fetch(
      `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&date=${day.replace(/-/g, "")}&json`
    ).catch(() => null);
    if (!r || !r.ok) return;
    const arr = await r.json().catch(() => null);
    const rate = Number(arr?.[0]?.rate);
    if (Number.isFinite(rate) && rate > 0) fx[day] = rate;
  }));

  if (Object.keys(fx).length === 0) throw new Error("Не вдалося завантажити історію курсу НБУ.");

  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), btc, fx })); }
  catch { /* квота — переживемо, просто тягнутимемо щоразу */ }

  return { btc, fx };
}

/** Значення з розрідженої серії на дату: остання відома, інакше найближча пізніша. */
function lookup(series, day) {
  if (series[day] != null) return series[day];
  const keys = Object.keys(series).sort();
  if (keys.length === 0) return null;
  let prev = null;
  for (const k of keys) {
    if (k <= day) prev = k; else break;
  }
  if (prev) return series[prev];
  return series[keys[0]];
}

/** Лінійна інтерполяція між опорними точками — для курсу. */
function interp(series, day) {
  if (series[day] != null) return series[day];
  const keys = Object.keys(series).sort();
  if (keys.length === 0) return null;
  let lo = null, hi = null;
  for (const k of keys) {
    if (k <= day) lo = k;
    if (k >= day && hi == null) hi = k;
  }
  if (lo && hi && lo !== hi) {
    const f = (ts(day) - ts(lo)) / (ts(hi) - ts(lo));
    return series[lo] + (series[hi] - series[lo]) * f;
  }
  return series[lo || hi];
}

/**
 * Скільки монет було на біржі на кожну дату.
 *
 * Якщо в транзакції збережена кількість монет — беремо її. Для старих записів,
 * де є лише гривнева сума, кількість оцінюємо за ціною того дня, а потім усю
 * серію масштабуємо так, щоб кінець збігся з фактичним залишком: залишок —
 * це факт, а відновлена форма кривої — оцінка.
 */
function coinLedger(txs, exchangeIds, holdingsTotal, btc, fx) {
  const buys = txs
    .filter(t => t.kind === "crypto_buy" && exchangeIds.has(t.accountId))
    .map(t => ({ day: String(t.date).slice(0, 10), uah: Math.abs(Number(t.amount) || 0), coins: Number(t.coinAmount) || 0 }))
    .sort((a, b) => a.day.localeCompare(b.day));

  let estimated = 0;
  const steps = buys.map(b => {
    let coins = b.coins;
    if (!coins) {
      const price = lookup(btc, b.day);
      const rate = interp(fx, b.day);
      coins = price && rate ? b.uah / (price * rate) : 0;
    }
    estimated += coins;
    return { day: b.day, coins };
  });

  const scale = estimated > 0 && holdingsTotal > 0 ? holdingsTotal / estimated : 1;
  let running = 0;
  const byDay = new Map();
  for (const s of steps) {
    running += s.coins * scale;
    byDay.set(s.day, running);
  }
  return { byDay, days: steps.map(s => s.day) };
}

/**
 * Щоденна серія вартості фонду.
 * Повертає [{ day, bonds, cash, crypto, total, contributed }].
 */
/**
 * Відновлює вартість портфеля по днях.
 *
 * Крок навмисно не параметризується: раніше довгі періоди будувались через
 * день-два, і дохідність залежала від кроку більше, ніж від ринку — те саме
 * портфоліо давало від −0,4% до +7,5% лише через частоту вибірки. Причина в
 * тому, що метод умовного паю бере вартість «перед внеском» як total мінус
 * сам внесок: на кроці в кілька днів у цю різницю потрапляє ще й рух ринку,
 * і помилка накопичується через кількість паїв. Для графіка серію проріджує
 * той, хто малює, — на підсумки це вже не впливає.
 */
export function buildSeries({
  lots = [], bondsByIsin = new Map(), transactions = [], accounts = [],
  btc = {}, fx = {}, from, to = iso(Date.now()), pocketId = null,
}) {
  const stepDays = 1;
  const exchangeIds = new Set(accounts.filter(a => a.kind === "exchange").map(a => a.id));

  // Монети мають власника прямо в даних, тож беремо частку кишені, а не
  // вгадуємо її пропорцією витрат: сторони заходили за різною ціною, і
  // гривня, поділена навпіл, монети навпіл не ділить.
  const coinsOf = (acc) => {
    const byPocket = acc.holdingsByPocket || {};
    if (pocketId) return Number(byPocket[pocketId]?.BTC) || 0;
    let s = 0;
    for (const coins of Object.values(byPocket)) s += Number(coins?.BTC) || 0;
    return s;
  };

  const holdingsTotal = accounts
    .filter(a => a.kind === "exchange")
    .reduce((s, a) => s + coinsOf(a), 0);

  if (pocketId) {
    lots = lots.filter(l => l.pocketId === pocketId);
    transactions = transactions.filter(t => t.pocketId === pocketId);
  }

  const { byDay: coinsByDay, days: buyDays } = coinLedger(transactions, exchangeIds, holdingsTotal, btc, fx);

  const sortedTx = [...transactions].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // Починаємо за день до першої операції, щоб базою був нуль: інакше перший
  // внесок опиняється всередині стартової точки й випадає з «внесено за період».
  const firstTxDay = sortedTx[0] ? String(sortedTx[0].date).slice(0, 10) : to;
  const firstDay = from || iso(ts(firstTxDay) - DAY);

  const points = [];
  for (let t = ts(firstDay); t <= ts(to); t += stepDays * DAY) {
    const day = iso(t);

    let bonds = 0;
    for (const lot of lots) {
      if (String(lot.purchaseDate).slice(0, 10) > day) continue;
      const bond = bondsByIsin.get(lot.isin);
      if (bond) bonds += lotCurrentValue(bond, lot, day);
    }

    let cash = 0, contributed = 0;
    for (const tx of sortedTx) {
      const d = String(tx.date).slice(0, 10);
      if (d > day) break;
      const amt = Number(tx.amount) || 0;
      // Гроші на біржі теж лежать у фонді, поки не перетворились на монети.
      // Раніше біржові рахунки випадали з готівки цілком: у день поповнення
      // вартість не росла, зате росла сума внесків — і метод паю приписував
      // цю розбіжність збитку.
      cash += amt;
      if (tx.kind === "deposit") contributed += amt;
    }

    // Монети на дату: остання купівля, що вже відбулась
    let coins = 0;
    for (const bd of buyDays) { if (bd <= day) coins = coinsByDay.get(bd) || coins; else break; }
    const price = lookup(btc, day);
    const rate = interp(fx, day);
    const crypto = coins && price && rate ? coins * price * rate : 0;

    points.push({ day, bonds, cash, crypto, total: bonds + cash + crypto, contributed });
  }
  return points;
}

/**
 * Показники за період.
 *
 * Просадку рахуємо не по загальній сумі, а по вартості умовного паю: інакше
 * кожне поповнення виглядало б як зростання, а виведення — як просадка.
 * Пай додається на кожен внесок за ціною того дня — це стандартний спосіб
 * відокремити результат вкладень від руху грошей.
 */
export function seriesMetrics(points) {
  if (!points || points.length < 2) return null;

  // Вартість паю можна рахувати лише з моменту, коли в фонді щось з'явилось.
  // До того будь-яке ділення на кількість паїв безглузде.
  const startIdx = points.findIndex(p => p.total > 0);
  if (startIdx === -1) return null;
  const live = points.slice(startIdx);

  let units = 1;
  let nav = live[0].total;
  let prevContrib = live[0].contributed;
  const navSeries = [];

  for (const p of live) {
    const inflow = p.contributed - prevContrib;
    prevContrib = p.contributed;
    const before = p.total - inflow;
    if (inflow > 0 && units > 0 && before > 0) {
      const navBefore = before / units;
      units += inflow / navBefore;
    }
    nav = units > 0 ? p.total / units : nav;
    navSeries.push({ day: p.day, nav });
  }

  let peak = navSeries[0].nav, maxDD = 0, ddFrom = null, ddTo = null, curPeakDay = navSeries[0].day;
  for (const n of navSeries) {
    if (n.nav > peak) { peak = n.nav; curPeakDay = n.day; }
    const dd = peak > 0 ? (n.nav - peak) / peak : 0;
    if (dd < maxDD) { maxDD = dd; ddFrom = curPeakDay; ddTo = n.day; }
  }

  const first = points[0], last = points[points.length - 1];   // «внесено» — за весь обраний період
  const contributedInPeriod = last.contributed - first.contributed;
  const gain = last.total - first.total - contributedInPeriod;
  const twr = navSeries[0].nav > 0 ? (navSeries[navSeries.length - 1].nav / navSeries[0].nav - 1) : null;
  const years = (ts(last.day) - ts(first.day)) / (365.25 * DAY);
  const annualized = twr != null && years > 0.08 ? Math.pow(1 + twr, 1 / years) - 1 : null;

  const currentNav = navSeries[navSeries.length - 1].nav;
  const fromPeak = peak > 0 ? currentNav / peak - 1 : 0;

  return {
    startValue: first.total, endValue: last.total,
    contributed: contributedInPeriod, gain,
    twr, annualized,
    maxDrawdown: maxDD, drawdownFrom: ddFrom, drawdownTo: ddTo,
    fromPeak,
    navSeries,
  };
}

/** Помісячна розбивка: скільки внесено і скільки зароблено за кожен місяць. */
export function monthlyBreakdown(points) {
  if (!points || points.length < 2) return [];
  const byMonth = new Map();
  for (const p of points) byMonth.set(p.day.slice(0, 7), p);   // останній день місяця
  const months = [...byMonth.keys()].sort();
  const out = [];
  let prev = points[0];
  for (const m of months) {
    const end = byMonth.get(m);
    const contributed = end.contributed - prev.contributed;
    out.push({
      month: m,
      endValue: end.total,
      contributed,
      gain: end.total - prev.total - contributed,
    });
    prev = end;
  }
  return out;
}

/**
 * Та сама серія, перерахована в долари за курсом кожного дня.
 *
 * Гривнева дохідність 18% і доларова — це той самий портфель; різницю з'їдає
 * девальвація. На горизонті 12 років саме доларова цифра відповідає на питання
 * «ми справді багатіємо чи наздоганяємо курс».
 *
 * Рахуємо саме так, а не через XIRR у доларах: на 8-місячній історії з
 * нерівномірними внесками XIRR стрибає на 15 пунктів від зміни вартості на
 * чотири відсотки — таке число показувати не можна.
 */
export function toUSD(points, fx) {
  const out = [];
  for (const p of points) {
    const rate = interp(fx, p.day);
    if (!rate) continue;
    out.push({
      day: p.day,
      bonds: p.bonds / rate,
      cash: p.cash / rate,
      crypto: p.crypto / rate,
      total: p.total / rate,
      contributed: p.contributed / rate,
    });
  }
  return out;
}

/** Скільки ще надійде: купони й погашення тіла окремо. */
export function futurePayments(coupons, lots, bondsByIsin, asOfDate) {
  const today = String(asOfDate).slice(0, 10);
  const lotById = new Map(lots.map(l => [l.id, l]));
  let couponsAhead = 0, redemptionsAhead = 0;
  for (const c of coupons) {
    if (c.status === "received") continue;
    if (String(c.scheduledDate).slice(0, 10) < today) continue;
    const lot = lotById.get(c.lotId);
    const bond = lot && bondsByIsin.get(lot.isin);
    if (!bond) continue;
    const principal = (c.kind === "redemption" || c.kind === "coupon+redemption")
      ? (bond.faceValue || 0) * lot.quantity : 0;
    redemptionsAhead += principal;
    couponsAhead += Math.max(0, (Number(c.amountNet) || 0) - principal);
  }
  return { couponsAhead, redemptionsAhead };
}
