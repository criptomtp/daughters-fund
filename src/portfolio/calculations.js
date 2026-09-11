import { applyTax } from "./taxRules.js";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_YEAR = 365.25 * MS_PER_DAY;

function toDate(iso) { return new Date(iso); }
function isoFromDate(d) { return d.toISOString(); }

export function addMonths(iso, months) {
  const d = toDate(iso);
  // Do month arithmetic in UTC and clamp to the last valid day of the target
  // month, so e.g. Jan 31 + 1mo → Feb 28/29 (not Mar 2/3) and no local-timezone
  // offset shifts a coupon onto the wrong calendar day.
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return isoFromDate(d);
}

function yearsBetween(fromIso, toIso) {
  return (toDate(toIso) - toDate(fromIso)) / MS_PER_YEAR;
}

// ── Coupon schedule ─────────────────────────────────────────────────────────

export function generateCouponSchedule(bond, lot) {
  if (!bond || !lot) return [];

  // Custom schedule overrides auto-generation
  if (Array.isArray(bond.customSchedule) && bond.customSchedule.length > 0) {
    const purchase = toDate(lot.purchaseDate);
    return bond.customSchedule
      .filter(item => item.date && toDate(item.date) > purchase)
      .map(item => {
        const perPiece = Number(item.amountPerPiece) || 0;
        const gross = perPiece * lot.quantity;
        const kind = item.kind || "coupon";
        const includesPrincipal = kind === "redemption" || kind === "coupon+redemption";
        const principal = includesPrincipal ? bond.faceValue * lot.quantity : 0;
        const couponPortion = Math.max(0, gross - principal);
        const net = applyTax(couponPortion, bond.type, "coupon") + principal;
        return {
          scheduledDate: item.date,
          amountGross: gross,
          amountNet: net,
          kind,
          status: "scheduled",
        };
      })
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  }

  if (!bond.issueDate || !bond.maturityDate) return [];

  const principal = bond.faceValue * lot.quantity;
  const purchase = toDate(lot.purchaseDate);
  const maturity = toDate(bond.maturityDate);

  // No coupon → discount/zero-coupon → single redemption at maturity
  if (!bond.couponRate || bond.couponRate <= 0) {
    if (maturity <= purchase) return [];
    return [{
      scheduledDate: bond.maturityDate,
      amountGross: principal,
      amountNet: principal,
      kind: "redemption",
      status: "scheduled",
    }];
  }

  const freq = bond.couponFrequency || 0;

  // Bullet (one payment at maturity = full coupon for entire term + principal)
  if (freq === 0) {
    if (maturity <= purchase) return [];
    const annualCoupon = bond.faceValue * bond.couponRate / 100;
    const termYears = yearsBetween(bond.issueDate, bond.maturityDate);
    const totalCoupon = annualCoupon * termYears * lot.quantity;
    return [{
      scheduledDate: bond.maturityDate,
      amountGross: totalCoupon + principal,
      amountNet:   applyTax(totalCoupon, bond.type, "coupon") + principal,
      kind: "coupon+redemption",
      status: "scheduled",
    }];
  }

  const monthsPerPeriod = 12 / freq;
  const periodGross = (bond.faceValue * bond.couponRate / 100) / freq * lot.quantity;
  const periodNet   = applyTax(periodGross, bond.type, "coupon");

  // Bounded loop — compute expected periods + buffer
  const termYears = yearsBetween(bond.issueDate, bond.maturityDate);
  const expectedPeriods = Math.max(1, Math.ceil(termYears * freq) + 2);

  const allDates = [];
  for (let i = 1; i <= expectedPeriods; i++) {
    const nextIso = addMonths(bond.issueDate, monthsPerPeriod * i);
    const nextDate = toDate(nextIso);
    if (nextDate > new Date(maturity.getTime() + 7 * MS_PER_DAY)) break;
    allDates.push(nextIso);
  }

  if (allDates.length === 0) {
    if (maturity <= purchase) return [];
    return [{
      scheduledDate: bond.maturityDate,
      amountGross: principal,
      amountNet: principal,
      kind: "redemption",
      status: "scheduled",
    }];
  }

  const lastDate = toDate(allDates[allDates.length - 1]);
  const lastIsRedemption = Math.abs(lastDate - maturity) < 7 * MS_PER_DAY;

  const payments = [];
  for (let i = 0; i < allDates.length; i++) {
    const dIso = allDates[i];
    const d = toDate(dIso);
    if (d <= purchase) continue;

    const isLast = (i === allDates.length - 1);
    if (isLast && lastIsRedemption) {
      payments.push({
        scheduledDate: dIso,
        amountGross: periodGross + principal,
        amountNet:   periodNet + principal,
        kind: "coupon+redemption",
        status: "scheduled",
      });
    } else {
      payments.push({
        scheduledDate: dIso,
        amountGross: periodGross,
        amountNet:   periodNet,
        kind: "coupon",
        status: "scheduled",
      });
    }
  }

  if (!lastIsRedemption && maturity > purchase) {
    payments.push({
      scheduledDate: bond.maturityDate,
      amountGross: principal,
      amountNet: principal,
      kind: "redemption",
      status: "scheduled",
    });
  }

  return payments;
}

// ── Accrued interest (НКД) ──────────────────────────────────────────────────
// O(1) — закрита формула, не цикл

export function accruedInterest(bond, lot, asOfDate = new Date().toISOString()) {
  if (!bond?.couponFrequency || !bond?.couponRate || !bond.issueDate) return 0;
  const asOf = toDate(asOfDate);
  const issue = toDate(bond.issueDate);
  if (asOf <= issue) return 0;

  const monthsPerPeriod = 12 / bond.couponFrequency;
  const elapsedYears = (asOf - issue) / MS_PER_YEAR;
  const periodIndex = Math.max(0, Math.floor(elapsedYears * bond.couponFrequency));

  const prevIso = addMonths(bond.issueDate, monthsPerPeriod * periodIndex);
  const nextIso = addMonths(bond.issueDate, monthsPerPeriod * (periodIndex + 1));
  const prev = toDate(prevIso);
  const next = toDate(nextIso);

  const periodDays = (next - prev) / MS_PER_DAY;
  if (periodDays <= 0) return 0;

  const sincePrev = (asOf - prev) / MS_PER_DAY;
  if (sincePrev <= 0) return 0;

  const periodGross = (bond.faceValue * bond.couponRate / 100) / bond.couponFrequency * lot.quantity;
  return (sincePrev / periodDays) * periodGross;
}

/**
 * НКД на 1 штуку, порахований із фактичного графіка виплат.
 *
 * accruedInterest() вище відлічує купонні періоди від issueDate — це вірно лише
 * для паперів, куплених на первинному розміщенні. Для дорозміщень (а це майже всі
 * папери, підтягнуті з реєстру НБУ) issueDate — дата траншу, а купонний період
 * почався раніше, тож відлік від неї дає завищений НКД.
 *
 * Тут період беремо з самого графіка: попередня виплата → наступна.
 * Повертає 0, якщо графіка немає або всі виплати вже позаду.
 */
export function accruedFromSchedule(bond, asOfDate = new Date().toISOString()) {
  const schedule = bond?.customSchedule;
  if (!Array.isArray(schedule) || schedule.length === 0) return 0;

  const rows = schedule
    .filter(r => r?.date)
    .map(r => ({ date: r.date.slice(0, 10), amount: Number(r.amountPerPiece) || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return 0;

  const today = String(asOfDate).slice(0, 10);
  const nextIdx = rows.findIndex(r => r.date > today);
  if (nextIdx === -1) return 0;                 // усе вже погашено
  const next = rows[nextIdx];

  // Купонна частина наступної виплати: якщо це погашення, тіло не входить у НКД.
  const face = Number(bond.faceValue) || 0;
  const couponPart = next.amount > face ? next.amount - face : next.amount;
  if (couponPart <= 0) return 0;

  const prevDate = nextIdx > 0
    ? rows[nextIdx - 1].date
    : addMonths(next.date, -12 / (bond.couponFrequency || 2)).slice(0, 10);

  const prev = toDate(prevDate);
  const nxt = toDate(next.date);
  const periodDays = (nxt - prev) / MS_PER_DAY;
  if (periodDays <= 0) return 0;

  const elapsed = (toDate(today) - prev) / MS_PER_DAY;
  if (elapsed <= 0) return 0;

  return couponPart * Math.min(elapsed / periodDays, 1);
}

// ── Per-lot ─────────────────────────────────────────────────────────────────

export function lotAccruedTotal(lot) {
  return (Number(lot.accruedInterestPerPiece) || 0) * lot.quantity;
}

export function lotInvested(lot) {
  return lot.quantity * lot.purchasePrice
       + lotAccruedTotal(lot)
       + (lot.commission || 0);
}

export function lotPrincipal(bond, lot) {
  return lot.quantity * bond.faceValue;
}

export function lotCurrentValue(bond, lot, asOfDate = new Date().toISOString()) {
  // Закритий лот (погашений або проданий) з цієї дати в портфелі не рахується —
  // гроші за нього вже лежать у готівці як окрема транзакція.
  if (lot.closedAt && String(lot.closedAt).slice(0, 10) <= String(asOfDate).slice(0, 10)) return 0;
  if (!bond) return lot.quantity * lot.purchasePrice;

  const principal = lotPrincipal(bond, lot);
  const cost = lot.quantity * lot.purchasePrice;     // чиста ціна × кількість
  const isZeroCoupon = !bond.couponRate || !bond.couponFrequency;

  // Амортизація премії/дисконту: вартість тіла йде лінійно від ціни покупки до
  // номіналу за період покупка→погашення. Без цього папір, куплений за 108%
  // номіналу, у день покупки показував би збиток 8% — фантомний, бо премію
  // компенсує підвищений купон. Так само працює і для дисконтних паперів.
  let body = principal;
  if (bond.maturityDate) {
    const start = toDate(lot.purchaseDate).getTime();
    const end = toDate(bond.maturityDate).getTime();
    const asOf = toDate(asOfDate).getTime();
    if (end > start) {
      const frac = Math.min(1, Math.max(0, (asOf - start) / (end - start)));
      body = cost + (principal - cost) * frac;
    }
  } else if (isZeroCoupon) {
    body = cost;
  }

  if (isZeroCoupon) return body;                     // купонів немає — НКД теж
  return body + lotAccrued(bond, lot, asOfDate);
}

/**
 * НКД по лоту. Якщо у випуску є фактичний графік виплат (наприклад підтягнутий
 * з реєстру НБУ) — рахуємо з нього, бо для дорозміщень відлік від issueDate
 * завищує НКД. Інакше — стара формула від дати випуску.
 */
function lotAccrued(bond, lot, asOfDate) {
  if (Array.isArray(bond.customSchedule) && bond.customSchedule.length > 0) {
    return accruedFromSchedule(bond, asOfDate) * lot.quantity;
  }
  return accruedInterest(bond, lot, asOfDate);
}

export function lotYTM(bond, lot) {
  if (!bond?.couponRate || !bond?.maturityDate) return null;
  const years = yearsBetween(lot.purchaseDate, bond.maturityDate);
  if (years <= 0) return null;
  const annualCoupon = bond.faceValue * bond.couponRate / 100;
  // Approximate YTM (current yield + capital adjustment)
  return ((annualCoupon + (bond.faceValue - lot.purchasePrice) / years) /
          ((bond.faceValue + lot.purchasePrice) / 2)) * 100;
}

// ── Aggregations ────────────────────────────────────────────────────────────

export function accountSummary({
  lots = [],
  bondsByIsin = new Map(),
  coupons = [],
  asOfDate = new Date().toISOString(),
}) {
  const yearStart = isoFromDate(new Date(toDate(asOfDate).getFullYear(), 0, 1));
  const yearAhead = isoFromDate(new Date(toDate(asOfDate).getTime() + MS_PER_YEAR));

  let invested = 0;
  let currentValue = 0;
  let receivedYTD = 0;
  let scheduledNext12m = 0;
  const byCurrency = {};

  const lotCurrency = new Map();
  for (const lot of lots) {
    if (lot.closedAt && String(lot.closedAt).slice(0, 10) <= String(asOfDate).slice(0, 10)) continue;
    const inv = lotInvested(lot);
    invested += inv;
    const bond = bondsByIsin.get(lot.isin);
    const cur = bond?.currency || "UAH";
    lotCurrency.set(lot.id, cur);
    if (bond) {
      const cv = lotCurrentValue(bond, lot, asOfDate);
      currentValue += cv;
      if (!byCurrency[cur]) byCurrency[cur] = { invested: 0, currentValue: 0, receivedYTD: 0, scheduledNext12m: 0 };
      byCurrency[cur].invested += inv;
      byCurrency[cur].currentValue += cv;
    }
  }

  // Compare on date granularity (YYYY-MM-DD): scheduledDate may be date-only
  // while asOfDate/yearStart/yearAhead are full datetimes, so a coupon due today
  // would otherwise be lexicographically excluded from the totals.
  const today = asOfDate.slice(0, 10);
  const yearStartDay = yearStart.slice(0, 10);
  const yearAheadDay = yearAhead.slice(0, 10);
  for (const c of coupons) {
    const cur = lotCurrency.get(c.lotId) || "UAH";
    if (c.status === "received" && c.actualDate && c.actualDate.slice(0, 10) >= yearStartDay) {
      const amt = c.actualAmount ?? c.amountNet ?? 0;
      receivedYTD += amt;
      if (byCurrency[cur]) byCurrency[cur].receivedYTD += amt;
    }
    if (c.status === "scheduled" && c.scheduledDate.slice(0, 10) >= today && c.scheduledDate.slice(0, 10) <= yearAheadDay) {
      const amt = c.amountNet ?? 0;
      scheduledNext12m += amt;
      if (byCurrency[cur]) byCurrency[cur].scheduledNext12m += amt;
    }
  }

  return {
    invested,
    currentValue,
    receivedYTD,
    scheduledNext12m,
    lotCount: lots.length,
    byCurrency,
  };
}

// ── XIRR (real IRR via Newton-Raphson) ─────────────────────────────────────

export function xirr(cashflows, guess = 0.1) {
  if (!cashflows || cashflows.length < 2) return null;
  const flows = cashflows
    .map(cf => ({ date: new Date(cf.date), amount: Number(cf.amount) }))
    .filter(cf => !isNaN(cf.date.getTime()) && Number.isFinite(cf.amount))
    .sort((a, b) => a.date - b.date);
  if (flows.length < 2) return null;

  // Need both positive and negative cash flows
  const hasPos = flows.some(f => f.amount > 0);
  const hasNeg = flows.some(f => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const d0 = flows[0].date;
  const npv = (rate) => {
    let sum = 0;
    for (const cf of flows) {
      const years = (cf.date - d0) / MS_PER_YEAR;
      sum += cf.amount / Math.pow(1 + rate, years);
    }
    return sum;
  };
  const dnpv = (rate) => {
    let sum = 0;
    for (const cf of flows) {
      const years = (cf.date - d0) / MS_PER_YEAR;
      sum += -years * cf.amount / Math.pow(1 + rate, years + 1);
    }
    return sum;
  };

  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const fp = dnpv(rate);
    if (Math.abs(fp) < 1e-12) break;
    const next = rate - f / fp;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = Math.max(-0.999, next);
  }

  // Bisection fallback when Newton–Raphson stalls or diverges, so a valid but
  // awkward cashflow set still yields a rate instead of a blank (null).
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi < 0) {
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (!Number.isFinite(fm)) break;
      if (Math.abs(fm) < 1e-7 || (hi - lo) < 1e-9) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }
  return null;
}

export function lotXIRR(bond, lot) {
  if (!bond?.maturityDate || !lot?.purchaseDate) return null;
  const invested = lotInvested(lot);
  if (invested <= 0) return null;
  const flows = [{ date: lot.purchaseDate, amount: -invested }];
  const schedule = generateCouponSchedule(bond, lot);
  for (const p of schedule) {
    flows.push({ date: p.scheduledDate, amount: p.amountNet });
  }
  const rate = xirr(flows);
  return rate != null ? rate * 100 : null;
}

// ── Goal tracking ──────────────────────────────────────────────────────────

export function ageInYears(birthDateIso, asOf = new Date()) {
  if (!birthDateIso) return null;
  const birth = new Date(birthDateIso);
  const a = (new Date(asOf) - birth) / MS_PER_YEAR;
  return a;
}

// Convert `amount` from one currency to another using EUR-based rates
// (rates = { UAH, USD, EUR } as units per 1 EUR). Returns null when conversion
// is impossible (cross-currency with no rates) so callers can skip safely.
export function convertCurrency(amount, from, to, rates) {
  if (from === to) return amount;
  if (!rates || !(rates[from] > 0) || !(rates[to] > 0)) return null;
  return (amount / rates[from]) * rates[to];
}

// Fraction of a (possibly shared) account that belongs to a beneficiary. Uses
// explicit beneficiaryWeights when present, otherwise an equal 1/N split.
export function beneficiaryShare(account, personId) {
  const ids = account.beneficiaryIds || [];
  if (ids.length === 0) return 0;
  const weights = account.beneficiaryWeights;
  if (weights && typeof weights === "object") {
    const total = ids.reduce((s, id) => s + (Number(weights[id]) || 0), 0);
    if (total > 0) return (Number(weights[personId]) || 0) / total;
  }
  return 1 / ids.length;
}

/**
 * Скільки з портфеля припадає на конкретну особу.
 *
 * Одне джерело для головного екрана і для екрана цілей — інакше на «Фонді»
 * і в «Доньках» під однаковим підписом стояли б різні числа (так і було:
 * головний рахував по номіналу, цілі — по поточній вартості з готівкою).
 */
export function personShareValue({
  person, accounts, lots, bondsByIsin,
  cashByAccount = new Map(),
  extraByAccount = new Map(),        // біржові рахунки: оцінка монет у гривні
  asOfDate = new Date().toISOString(),
}) {
  if (!person) return 0;
  let total = 0;
  for (const acc of accounts) {
    const share = beneficiaryShare(acc, person.id);
    if (!share) continue;
    let accTotal = 0;
    for (const lot of lots) {
      if (lot.accountId !== acc.id) continue;
      const bond = bondsByIsin.get(lot.isin);
      if (bond) accTotal += lotCurrentValue(bond, lot, asOfDate);
    }
    const cashObj = cashByAccount.get?.(acc.id) || cashByAccount[acc.id] || {};
    for (const cur of Object.keys(cashObj)) accTotal += Number(cashObj[cur]) || 0;
    accTotal += Number(extraByAccount.get?.(acc.id) ?? extraByAccount[acc.id] ?? 0) || 0;
    total += accTotal * share;
  }
  return total;
}

/**
 * Скільки треба відкладати щомісяця, щоб дійти до цілі.
 *
 * Раніше рахувалось простим діленням залишку на кількість місяців — тобто з
 * припущенням, що гроші лежать під 0%. Для 12-річного горизонту під 17% це
 * завищує потрібний внесок утричі й перетворює будь-яку ціль на «не встигаєш».
 * Тут враховано і зростання вже накопиченого, і складний відсоток на внески.
 */
export function requiredMonthlyContribution({ target, current, years, annualReturnPct = 0 }) {
  const n = Math.round(years * 12);
  if (n <= 0) return null;
  const r = (Number(annualReturnPct) || 0) / 100;
  if (r <= 0) return Math.max(0, target - current) / n;

  const monthly = Math.pow(1 + r, 1 / 12) - 1;
  const grownCurrent = current * Math.pow(1 + r, years);
  const need = Math.max(0, target - grownCurrent);
  if (need === 0) return 0;
  return need * monthly / (Math.pow(1 + monthly, n) - 1);
}

/** Скільки вийде за поточного темпу внесків — дзеркало до попередньої функції. */
export function projectedAtRate({ current, monthly, years, annualReturnPct = 0 }) {
  const n = Math.round(years * 12);
  const r = (Number(annualReturnPct) || 0) / 100;
  if (n <= 0) return current;
  if (r <= 0) return current + monthly * n;
  const m = Math.pow(1 + r, 1 / 12) - 1;
  return current * Math.pow(1 + r, years) + monthly * ((Math.pow(1 + m, n) - 1) / m);
}

export function goalProgress({
  person, accounts, lots, bondsByIsin, cashByAccount = new Map(),
  extraByAccount = new Map(),
  fxRates = null,
  annualReturnPct = 0,
  asOfDate = new Date().toISOString(),
}) {
  if (!person.targetAmount || !person.birthDate) return null;
  const currency = person.targetCurrency || "UAH";

  const birth = new Date(person.birthDate);
  const eighteen = new Date(birth);
  eighteen.setFullYear(eighteen.getFullYear() + 18);
  const now = new Date(asOfDate);
  const daysLeft  = Math.max(0, Math.floor((eighteen - now) / MS_PER_DAY));
  const yearsLeft = daysLeft / 365.25;

  const myAccounts = accounts.filter(a => (a.beneficiaryIds || []).includes(person.id));

  let currentValue = 0;
  for (const acc of myAccounts) {
    const accLots = lots.filter(l => l.accountId === acc.id);
    let accAssets = 0;
    for (const lot of accLots) {
      const bond = bondsByIsin.get(lot.isin);
      if (!bond) continue;
      // Convert each holding into the goal currency (skip if no FX rate available).
      const conv = convertCurrency(lotCurrentValue(bond, lot, asOfDate), bond.currency, currency, fxRates);
      if (conv != null) accAssets += conv;
    }
    const cashObj = (cashByAccount.get?.(acc.id) || cashByAccount[acc.id] || {});
    let accCash = 0;
    for (const cur of Object.keys(cashObj)) {
      const conv = convertCurrency(cashObj[cur] || 0, cur, currency, fxRates);
      if (conv != null) accCash += conv;
    }
    const accExtra = Number(extraByAccount.get?.(acc.id) ?? extraByAccount[acc.id] ?? 0) || 0;
    const accTotal = accAssets + accCash + accExtra;
    currentValue += accTotal * beneficiaryShare(acc, person.id);
  }

  const progress = person.targetAmount > 0 ? currentValue / person.targetAmount : 0;
  const remaining = Math.max(0, person.targetAmount - currentValue);
  // When the 18th birthday has arrived but the goal isn't met, requiredMonthly
  // collapses to 0 — that reads as "nothing more needed", which is wrong. Flag it
  // so the UI can show the shortfall as a lump sum due instead.
  const deadlineReached = yearsLeft <= 0 && remaining > 0;
  const requiredMonthly = yearsLeft > 0 && remaining > 0
    ? requiredMonthlyContribution({ target: person.targetAmount, current: currentValue, years: yearsLeft, annualReturnPct })
    : 0;

  return {
    targetAmount: person.targetAmount,
    currency,
    currentValue,
    progress,
    remaining,
    daysLeft,
    yearsLeft,
    requiredMonthly,
    deadlineReached,
    isComplete: currentValue >= person.targetAmount,
  };
}

// ── Maturity ladder ────────────────────────────────────────────────────────

export function maturityLadder(lots, bondsByIsin) {
  const buckets = new Map();
  for (const lot of lots) {
    const bond = bondsByIsin.get(lot.isin);
    if (!bond?.maturityDate) continue;
    const year = new Date(bond.maturityDate).getFullYear();
    if (!buckets.has(year)) buckets.set(year, { year, totalPrincipal: 0, lotCount: 0, byCurrency: {}, items: [] });
    const b = buckets.get(year);
    const principal = bond.faceValue * lot.quantity;
    b.totalPrincipal += principal;
    b.lotCount += 1;
    const cur = bond.currency || "UAH";
    b.byCurrency[cur] = (b.byCurrency[cur] || 0) + principal;
    b.items.push({ lot, bond, principal });
  }
  return Array.from(buckets.values()).sort((a, b) => a.year - b.year);
}

// ── Next coupon helper ─────────────────────────────────────────────────────

export function findNextCoupon(coupons, lots, accounts, asOfDate = new Date().toISOString()) {
  // Compare on date granularity: scheduledDate may be date-only while asOfDate is
  // a full datetime — a coupon due TODAY must still count as upcoming (see the
  // matching fix in accountSummary).
  const today = asOfDate.slice(0, 10);
  const upcoming = coupons
    .filter(c => c.status === "scheduled" && c.scheduledDate.slice(0, 10) >= today)
    .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  const lot = lots.find(l => l.id === next.lotId);
  const account = lot && accounts.find(a => a.id === lot.accountId);
  const daysAway = Math.round(
    (toDate(next.scheduledDate.slice(0, 10)) - toDate(today)) / MS_PER_DAY
  );
  return { coupon: next, lot, account, daysAway };
}

export function findOverdueCoupons(coupons, asOfDate = new Date().toISOString(), graceDays = 7) {
  const cutoffDay = new Date(new Date(asOfDate).getTime() - graceDays * MS_PER_DAY)
    .toISOString().slice(0, 10);
  return coupons.filter(c => c.status === "scheduled" && c.scheduledDate.slice(0, 10) < cutoffDay);
}

// ── Portfolio-level return & contribution pace ─────────────────────────────

// XIRR усього портфеля по ЗОВНІШНІХ потоках власника (deposit/withdrawal),
// з поточною вартістю як термінальним потоком. Внутрішні рухи (купівлі лотів,
// купони, перекази між власними рахунками) — не потоки власника, вони вже
// відображені в terminalValue.
export function portfolioXIRR({
  transactions = [],
  currency = "UAH",
  terminalValue = 0,
  asOfDate = new Date().toISOString(),
}) {
  const flows = [];
  for (const t of transactions) {
    if ((t.currency || "UAH") !== currency) continue;
    if (t.kind === "deposit" || t.kind === "withdrawal") {
      // Конвенція потоків власника: внесок = відтік від власника (−),
      // зняття = притік (+). Суми в БД підписані (deposit +, withdrawal −).
      flows.push({ date: t.date, amount: -(Number(t.amount) || 0) });
    }
  }
  if (flows.length === 0 || !(terminalValue > 0)) return null;
  flows.push({ date: asOfDate, amount: terminalValue });
  const rate = xirr(flows);
  return rate != null ? rate * 100 : null;
}

// Фактичний середній внесок на місяць за останні `months` місяців —
// для порівняння з requiredMonthly із цілей (план/факт).
export function avgMonthlyDeposits({
  transactions = [],
  currency = "UAH",
  months = 6,
  asOfDate = new Date().toISOString(),
}) {
  if (!(months > 0)) return 0;
  const cutoff = new Date(new Date(asOfDate).getTime() - months * 30.44 * MS_PER_DAY).toISOString();
  let sum = 0;
  for (const t of transactions) {
    if (t.kind !== "deposit") continue;
    if ((t.currency || "UAH") !== currency) continue;
    if ((t.date || "") < cutoff) continue;
    sum += Number(t.amount) || 0;
  }
  return sum / months;
}

/**
 * Купонні виплати згруповані в ПОДІЇ так, як їх бачить власник.
 *
 * У базі купон зберігається по-лотово: купуєш 5 шт щомісяця одного випуску —
 * через рік у ту саму купонну дату лежить 12 окремих записів, через три роки — 36.
 * Емітент же платить одним переказом. Тому для UI зводимо їх у одну подію
 * по ключу isin + accountId + дата, зберігаючи id всіх лотових записів,
 * щоб підтвердження застосувалося одразу до групи.
 */
export function groupCouponEvents(coupons, lots) {
  const lotById = new Map((lots || []).map(l => [l.id, l]));
  const byKey = new Map();

  for (const c of coupons || []) {
    const lot = lotById.get(c.lotId);
    if (!lot) continue;
    const date = String(c.scheduledDate || "").slice(0, 10);
    if (!date) continue;
    const key = `${lot.isin}|${lot.accountId}|${date}`;

    const acc = byKey.get(key) || {
      key,
      isin: lot.isin,
      accountId: lot.accountId,
      scheduledDate: date,
      kind: c.kind || "coupon",
      amountGross: 0,
      amountNet: 0,
      quantity: 0,
      couponIds: [],
      lotIds: [],
      receivedCount: 0,
      actualAmount: 0,
      actualDate: null,
    };

    acc.amountGross += Number(c.amountGross) || 0;
    acc.amountNet += Number(c.amountNet) || 0;
    acc.quantity += Number(lot.quantity) || 0;
    acc.couponIds.push(c.id);
    acc.lotIds.push(lot.id);
    // Погашення "сильніше" за купон: якщо хоч один запис несе тіло, подія теж
    if (c.kind === "coupon+redemption" || c.kind === "redemption") acc.kind = c.kind;
    if (c.status === "received") {
      acc.receivedCount += 1;
      acc.actualAmount += Number(c.actualAmount ?? c.amountNet) || 0;
      acc.actualDate = acc.actualDate || (c.actualDate ? String(c.actualDate).slice(0, 10) : null);
    }
    byKey.set(key, acc);
  }

  return [...byKey.values()]
    .map(e => ({
      ...e,
      status: e.receivedCount === 0
        ? "scheduled"
        : e.receivedCount === e.couponIds.length ? "received" : "partial",
    }))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

/** Найближча незакрита подія виплати (та, яку варто показати на головному). */
export function nextCouponEvent(events, asOfDate = new Date().toISOString()) {
  const today = String(asOfDate).slice(0, 10);
  const pending = events.filter(e => e.status !== "received");
  // Прострочене важливіше за майбутнє: спершу те, що мало прийти і не позначене
  const overdue = pending.filter(e => e.scheduledDate <= today);
  if (overdue.length) return { ...overdue[overdue.length - 1], overdue: true };
  const upcoming = pending.find(e => e.scheduledDate > today);
  return upcoming ? { ...upcoming, overdue: false } : null;
}

// ── Group coupons by month ─────────────────────────────────────────────────

export function groupCouponsByMonth(coupons) {
  const groups = new Map();
  for (const c of coupons) {
    const d = toDate(c.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, { key, year: d.getFullYear(), month: d.getMonth(), items: [] });
    groups.get(key).items.push(c);
  }
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Позиція = випуск, а не лот.
 *
 * Купуючи щомісяця один папір, за рік маєш дванадцять лотів одного ISIN.
 * Для власника це одна позиція; окремі покупки цікаві лише коли розгорнути.
 * Дохідність рахуємо по всіх грошових потоках позиції разом (XIRR), а не
 * як середнє з лотових — середнє з відсотків не має фінансового сенсу.
 */
export function groupPositions({ lots = [], bondsByIsin = new Map(), coupons = [], asOfDate = new Date().toISOString() }) {
  const today = String(asOfDate).slice(0, 10);
  const open = lots.filter(l => !l.closedAt || String(l.closedAt).slice(0, 10) > today);
  const byIsin = new Map();

  for (const lot of open) {
    const bond = bondsByIsin.get(lot.isin);
    if (!bond) continue;
    const p = byIsin.get(lot.isin) || {
      isin: lot.isin, bond, lots: [], quantity: 0, invested: 0, value: 0,
      receivedCoupons: 0, accountIds: new Set(),
    };
    p.lots.push(lot);
    p.quantity += lot.quantity;
    p.invested += lotInvested(lot);
    p.value += lotCurrentValue(bond, lot, asOfDate);
    p.accountIds.add(lot.accountId);
    byIsin.set(lot.isin, p);
  }

  const lotIds = new Map(open.map(l => [l.id, l.isin]));
  for (const c of coupons) {
    if (c.status !== "received") continue;
    const isin = lotIds.get(c.lotId);
    const p = isin && byIsin.get(isin);
    if (p) p.receivedCoupons += Number(c.actualAmount ?? c.amountNet) || 0;
  }

  return [...byIsin.values()].map(p => {
    // Дохідність позиції — це зафіксована при купівлі YTM, зважена за сумами
    // вкладень, а НЕ реалізований XIRR за фактом. Реалізований на короткому
    // вікні вибухає: папір, куплений місяць тому і встигший заплатити купон,
    // давав «109% річних». Зафіксована YTM стабільна й порівнянна з ринком —
    // саме те, що треба знати: під скільки я зайшов проти того, що дають зараз.
    let weighted = 0, weight = 0;
    for (const l of p.lots) {
      const y = lotXIRR(p.bond, l) ?? lotYTM(p.bond, l);
      const inv = lotInvested(l);
      if (y != null && inv > 0) { weighted += y * inv; weight += inv; }
    }
    return {
      ...p,
      accountIds: [...p.accountIds],
      gain: p.value + p.receivedCoupons - p.invested,
      ytm: weight > 0 ? weighted / weight : null,
    };
  }).sort((a, b) => b.value - a.value);
}
