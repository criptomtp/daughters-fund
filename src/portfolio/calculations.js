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
  if (!bond) return lot.quantity * lot.purchasePrice;
  // Zero-coupon / discount bond: it pays no coupons, so its value accretes
  // linearly from purchase price toward face over purchase→maturity instead of
  // jumping to par on day 1 (which produced a phantom unrealized gain).
  if ((!bond.couponRate || !bond.couponFrequency) && bond.maturityDate) {
    const principal = lotPrincipal(bond, lot);
    const cost = lot.quantity * lot.purchasePrice;
    const start = toDate(lot.purchaseDate).getTime();
    const end = toDate(bond.maturityDate).getTime();
    const asOf = toDate(asOfDate).getTime();
    if (end <= start) return principal;
    const frac = Math.min(1, Math.max(0, (asOf - start) / (end - start)));
    return cost + (principal - cost) * frac;
  }
  return lotPrincipal(bond, lot) + accruedInterest(bond, lot, asOfDate);
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

export function goalProgress({
  person, accounts, lots, bondsByIsin, cashByAccount = new Map(),
  fxRates = null,
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
    const accTotal = accAssets + accCash;
    currentValue += accTotal * beneficiaryShare(acc, person.id);
  }

  const progress = person.targetAmount > 0 ? currentValue / person.targetAmount : 0;
  const remaining = Math.max(0, person.targetAmount - currentValue);
  // When the 18th birthday has arrived but the goal isn't met, requiredMonthly
  // collapses to 0 — that reads as "nothing more needed", which is wrong. Flag it
  // so the UI can show the shortfall as a lump sum due instead.
  const deadlineReached = yearsLeft <= 0 && remaining > 0;
  const requiredMonthly = yearsLeft > 0 && remaining > 0
    ? remaining / (yearsLeft * 12)
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
  const upcoming = coupons
    .filter(c => c.status === "scheduled" && c.scheduledDate >= asOfDate)
    .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  const lot = lots.find(l => l.id === next.lotId);
  const account = lot && accounts.find(a => a.id === lot.accountId);
  const daysAway = Math.ceil((new Date(next.scheduledDate) - new Date(asOfDate)) / MS_PER_DAY);
  return { coupon: next, lot, account, daysAway };
}

export function findOverdueCoupons(coupons, asOfDate = new Date().toISOString(), graceDays = 7) {
  const cutoff = new Date(new Date(asOfDate).getTime() - graceDays * MS_PER_DAY).toISOString();
  return coupons.filter(c => c.status === "scheduled" && c.scheduledDate < cutoff);
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
