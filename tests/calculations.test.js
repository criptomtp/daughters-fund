import { describe, it, expect } from "vitest";
import {
  addMonths,
  lotCurrentValue,
  xirr,
  accountSummary,
  goalProgress,
  convertCurrency,
  pocketShare,
  personShareValue,
  generateCouponSchedule,
  accruedInterest,
  maturityLadder,
  findNextCoupon,
  findOverdueCoupons,
  portfolioXIRR,
  avgMonthlyDeposits,
  accruedFromSchedule,
  requiredMonthlyContribution,
  projectedAtRate,
} from "../src/portfolio/calculations.js";
import { buildSeries, seriesMetrics } from "../src/portfolio/history.js";
import { buildIcs } from "../src/portfolio/icsExport.js";

describe("addMonths (UTC + end-of-month clamp)", () => {
  it("clamps Jan 31 + 1mo to Feb 28 (not Mar)", () => {
    expect(addMonths("2026-01-31", 1).slice(0, 10)).toBe("2026-02-28");
  });
  it("keeps day 31 where valid: Jan 31 + 6mo = Jul 31 (no TZ slip)", () => {
    expect(addMonths("2025-01-31", 6).slice(0, 10)).toBe("2025-07-31");
  });
  it("mid-month dates are stable", () => {
    expect(addMonths("2025-01-15", 1).slice(0, 10)).toBe("2025-02-15");
  });
  it("handles leap-year Feb 29", () => {
    expect(addMonths("2024-01-31", 1).slice(0, 10)).toBe("2024-02-29");
  });
});

describe("lotCurrentValue", () => {
  const zbond = { currency: "UAH", faceValue: 1000, maturityDate: "2027-01-01", couponRate: 0, couponFrequency: 0 };
  const zlot = { quantity: 10, purchasePrice: 800, purchaseDate: "2025-01-01" };

  it("zero-coupon discount bond at purchase = cost, no phantom gain", () => {
    expect(lotCurrentValue(zbond, zlot, "2025-01-01T00:00:00.000Z")).toBeCloseTo(8000, 2);
  });
  it("zero-coupon discount bond accretes ~halfway to par", () => {
    const v = lotCurrentValue(zbond, zlot, "2026-01-01T00:00:00.000Z");
    expect(v).toBeGreaterThan(8800);
    expect(v).toBeLessThan(9100);
  });
  it("zero-coupon at/after maturity = face value", () => {
    expect(lotCurrentValue(zbond, zlot, "2027-06-01T00:00:00.000Z")).toBeCloseTo(10000, 2);
  });
  it("coupon-bearing bond = principal + accrued (>= principal)", () => {
    const cbond = { currency: "UAH", faceValue: 1000, couponRate: 16, couponFrequency: 2, issueDate: "2025-01-01", maturityDate: "2028-01-01" };
    const clot = { quantity: 10, purchasePrice: 1000, purchaseDate: "2025-01-01", accruedInterestPerPiece: 0 };
    const v = lotCurrentValue(cbond, clot, "2026-04-01T00:00:00.000Z");
    expect(v).toBeGreaterThanOrEqual(10000);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe("xirr", () => {
  it("simple 1-year ~10% return", () => {
    const r = xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 1100 }]);
    expect(r).toBeCloseTo(0.0993, 2);
  });
  it("returns null without both positive and negative flows", () => {
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: -50 }])).toBeNull();
  });
  it("solves a coupon-like multi-flow stream", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2025-07-01", amount: 80 },
      { date: "2026-01-01", amount: 1080 },
    ]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe("convertCurrency", () => {
  const rates = { UAH: 50, USD: 1.1, EUR: 1 };
  it("identity for same currency", () => {
    expect(convertCurrency(100, "UAH", "UAH", rates)).toBe(100);
  });
  it("EUR → UAH", () => {
    expect(convertCurrency(10, "EUR", "UAH", rates)).toBeCloseTo(500, 6);
  });
  it("USD → UAH via EUR base (110 USD = 100 EUR = 5000 UAH)", () => {
    expect(convertCurrency(110, "USD", "UAH", rates)).toBeCloseTo(5000, 6);
  });
  it("returns null when rates are unavailable", () => {
    expect(convertCurrency(10, "EUR", "UAH", null)).toBeNull();
  });
});

describe("pocketShare", () => {
  it("рівні ваги — рівні частки", () => {
    expect(pocketShare({ memberWeights: { a: 1, b: 1 } }, "a")).toBeCloseTo(0.5, 10);
  });
  it("явні ваги 60/40", () => {
    const pk = { memberWeights: { a: 60, b: 40 } };
    expect(pocketShare(pk, "a")).toBeCloseTo(0.6, 10);
    expect(pocketShare(pk, "b")).toBeCloseTo(0.4, 10);
  });
  it("чужа особа отримує нуль", () => {
    expect(pocketShare({ memberWeights: { a: 1 } }, "b")).toBe(0);
  });
  it("порожня кишеня не ділить на нуль", () => {
    expect(pocketShare({ memberWeights: {} }, "a")).toBe(0);
    expect(pocketShare({ memberWeights: { a: 0 } }, "a")).toBe(0);
    expect(pocketShare(null, "a")).toBe(0);
    expect(pocketShare(undefined, "a")).toBe(0);
  });
});

describe("подвійне ділення — помилка, що виглядає правдоподібно", () => {
  // Один рахунок, дві кишені по лоту на 10 000 ₴. Донька — єдина учасниця
  // своєї кишені, тож її частка 10 000. Якщо десь лишиться множення на
  // частку РАХУНКУ (де вона одна з двох), вийде 5 000 — число, схоже на
  // правду, і саме тому помилку не помітили б на екрані.
  const bondsByIsin = new Map([["X", { currency: "UAH", faceValue: 1000 }]]);
  const lots = [
    { id: "l1", isin: "X", accountId: "a1", pocketId: "kids", quantity: 10, purchasePrice: 1000 },
    { id: "l2", isin: "X", accountId: "a1", pocketId: "mine", quantity: 10, purchasePrice: 1000 },
  ];
  const pockets = [
    { id: "kids", memberWeights: { kid: 1 } },
    { id: "mine", memberWeights: { dad: 1 } },
  ];
  const asOfDate = "2026-01-01T00:00:00.000Z";

  it("personShareValue не ділить удруге", () => {
    const v = personShareValue({ person: { id: "kid" }, pockets, lots, bondsByIsin, asOfDate });
    expect(v).toBeCloseTo(10000, 2);
  });

  it("goalProgress не ділить удруге", () => {
    const g = goalProgress({
      person: { id: "kid", birthDate: "2020-01-01", targetAmount: 100000, targetCurrency: "UAH" },
      pockets, lots, bondsByIsin, asOfDate,
    });
    expect(g.currentValue).toBeCloseTo(10000, 2);
  });

  it("дві доньки в одній кишені ділять її навпіл", () => {
    const shared = [{ id: "kids", memberWeights: { kid: 1, kid2: 1 } }, pockets[1]];
    const v = personShareValue({ person: { id: "kid" }, pockets: shared, lots, bondsByIsin, asOfDate });
    expect(v).toBeCloseTo(5000, 2);
  });
});

describe("accountSummary", () => {
  it("counts a coupon dated today in scheduledNext12m (date-only vs datetime)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const s = accountSummary({
      lots: [{ id: "l1", isin: "X", quantity: 1, purchasePrice: 1000 }],
      bondsByIsin: new Map([["X", { currency: "UAH", faceValue: 1000 }]]),
      coupons: [{ lotId: "l1", status: "scheduled", scheduledDate: today, amountNet: 50 }],
      asOfDate: new Date().toISOString(),
    });
    expect(s.scheduledNext12m).toBe(50);
  });
});

describe("goalProgress", () => {
  const base = {
    person: { id: "p1", birthDate: "2020-01-01", targetAmount: 100000, targetCurrency: "UAH" },
    pockets: [{ id: "pk1", memberWeights: { p1: 1 } }],
    lots: [],
    bondsByIsin: new Map(),
    cashByPocket: new Map([["pk1", { UAH: 40000 }]]),
  };

  it("counts same-currency cash toward the goal", () => {
    expect(goalProgress(base).currentValue).toBeCloseTo(40000, 2);
  });
  it("converts other-currency cash when fxRates are supplied", () => {
    const g = goalProgress({ ...base, cashByPocket: new Map([["pk1", { USD: 100 }]]), fxRates: { UAH: 50, USD: 1.1, EUR: 1 } });
    expect(g.currentValue).toBeCloseTo(4545.45, 1); // 100 USD = 90.91 EUR = 4545.45 UAH
  });
  it("drops other-currency cash without rates (backward compatible)", () => {
    const g = goalProgress({ ...base, cashByPocket: new Map([["pk1", { USD: 100 }]]) });
    expect(g.currentValue).toBe(0);
  });
  it("ділить кишеню за явними вагами", () => {
    const g = goalProgress({
      person: { id: "p1", birthDate: "2020-01-01", targetAmount: 100000, targetCurrency: "UAH" },
      pockets: [{ id: "pk1", memberWeights: { p1: 70, p2: 30 } }],
      lots: [],
      bondsByIsin: new Map(),
      cashByPocket: new Map([["pk1", { UAH: 10000 }]]),
    });
    expect(g.currentValue).toBeCloseTo(7000, 2);
  });
  it("flags deadlineReached past 18 with a remaining gap", () => {
    const g = goalProgress({ ...base, person: { ...base.person, birthDate: "2000-01-01" }, cashByPocket: new Map() });
    expect(g.deadlineReached).toBe(true);
    expect(g.requiredMonthly).toBe(0);
  });
});

describe("generateCouponSchedule (semiannual OVDP)", () => {
  it("generates >=6 coupons + a final redemption, tax-free net == gross", () => {
    const bond = { type: "ovdp", faceValue: 1000, couponRate: 16, couponFrequency: 2, issueDate: "2025-01-15", maturityDate: "2028-01-15" };
    const lot = { quantity: 10, purchaseDate: "2025-01-15" };
    const sched = generateCouponSchedule(bond, lot);
    expect(sched.length).toBeGreaterThanOrEqual(6);
    expect(["redemption", "coupon+redemption"]).toContain(sched[sched.length - 1].kind);
    const coupon = sched.find(p => p.kind === "coupon");
    expect(coupon.amountGross).toBeCloseTo(800, 6); // 1000 * 16% / 2 * 10
    expect(coupon.amountNet).toBeCloseTo(coupon.amountGross, 6); // OVDP tax-free
  });
});

describe("accruedInterest", () => {
  it("is 0 at issue, positive but < one period partway through", () => {
    const bond = { faceValue: 1000, couponRate: 16, couponFrequency: 2, issueDate: "2025-01-01" };
    const lot = { quantity: 10 };
    expect(accruedInterest(bond, lot, "2025-01-01T00:00:00.000Z")).toBe(0);
    const ai = accruedInterest(bond, lot, "2025-04-01T00:00:00.000Z");
    const periodGross = (1000 * 16 / 100) / 2 * 10; // 800
    expect(ai).toBeGreaterThan(0);
    expect(ai).toBeLessThan(periodGross);
  });
});

describe("findNextCoupon / findOverdueCoupons (date-only vs datetime)", () => {
  const lots = [{ id: "l1", accountId: "a1" }];
  const accounts = [{ id: "a1", name: "Test" }];

  it("a coupon due TODAY is still the next coupon (not dropped)", () => {
    const today = "2026-06-11";
    const coupons = [{ lotId: "l1", status: "scheduled", scheduledDate: today, amountNet: 50 }];
    const next = findNextCoupon(coupons, lots, accounts, "2026-06-11T14:30:00.000Z");
    expect(next).not.toBeNull();
    expect(next.daysAway).toBe(0);
  });

  it("tomorrow's coupon has daysAway = 1", () => {
    const coupons = [{ lotId: "l1", status: "scheduled", scheduledDate: "2026-06-12T00:00:00.000Z", amountNet: 50 }];
    const next = findNextCoupon(coupons, lots, accounts, "2026-06-11T23:00:00.000Z");
    expect(next.daysAway).toBe(1);
  });

  it("overdue only after the grace period, on date granularity", () => {
    const asOf = "2026-06-11T10:00:00.000Z";
    const coupons = [
      { id: "old", status: "scheduled", scheduledDate: "2026-06-03" },  // 8 днів тому → overdue
      { id: "in-grace", status: "scheduled", scheduledDate: "2026-06-05" }, // 6 днів тому → ще ні
    ];
    const overdue = findOverdueCoupons(coupons, asOf, 7);
    expect(overdue.map(c => c.id)).toEqual(["old"]);
  });
});

describe("portfolioXIRR (owner external flows)", () => {
  it("single deposit growing for a year ≈ matching return", () => {
    const r = portfolioXIRR({
      transactions: [{ kind: "deposit", currency: "UAH", date: "2025-01-01", amount: 10000 }],
      currency: "UAH",
      terminalValue: 11000,
      asOfDate: "2026-01-01T00:00:00.000Z",
    });
    expect(r).toBeCloseTo(9.93, 0);
  });

  it("ignores internal flows (lot_purchase, coupon_received, transfers)", () => {
    const r = portfolioXIRR({
      transactions: [
        { kind: "deposit", currency: "UAH", date: "2025-01-01", amount: 10000 },
        { kind: "lot_purchase", currency: "UAH", date: "2025-01-02", amount: -9000 },
        { kind: "coupon_received", currency: "UAH", date: "2025-07-01", amount: 700 },
        { kind: "transfer_out", currency: "UAH", date: "2025-08-01", amount: -500 },
        { kind: "transfer_in", currency: "UAH", date: "2025-08-01", amount: 500 },
      ],
      currency: "UAH",
      terminalValue: 11000,
      asOfDate: "2026-01-01T00:00:00.000Z",
    });
    expect(r).toBeCloseTo(9.93, 0); // ті самі ~10%, внутрішні рухи не впливають
  });

  it("withdrawal counts as owner inflow", () => {
    const r = portfolioXIRR({
      transactions: [
        { kind: "deposit", currency: "UAH", date: "2025-01-01", amount: 10000 },
        { kind: "withdrawal", currency: "UAH", date: "2025-07-01", amount: -5000 },
      ],
      currency: "UAH",
      terminalValue: 5800,
      asOfDate: "2026-01-01T00:00:00.000Z",
    });
    expect(r).toBeGreaterThan(10); // забрали половину, решта виросла
  });

  it("returns null with no external flows or no terminal value", () => {
    expect(portfolioXIRR({ transactions: [], currency: "UAH", terminalValue: 100 })).toBeNull();
    expect(portfolioXIRR({
      transactions: [{ kind: "deposit", currency: "UAH", date: "2025-01-01", amount: 100 }],
      currency: "UAH", terminalValue: 0,
    })).toBeNull();
  });
});

describe("avgMonthlyDeposits", () => {
  const asOf = "2026-06-11T00:00:00.000Z";
  it("averages deposits inside the window", () => {
    const txs = [
      { kind: "deposit", currency: "UAH", date: "2026-05-01", amount: 3000 },
      { kind: "deposit", currency: "UAH", date: "2026-04-01", amount: 3000 },
      { kind: "deposit", currency: "UAH", date: "2024-01-01", amount: 99999 }, // поза вікном
      { kind: "withdrawal", currency: "UAH", date: "2026-05-15", amount: -500 }, // не внесок
      { kind: "deposit", currency: "USD", date: "2026-05-20", amount: 100 },     // інша валюта
    ];
    expect(avgMonthlyDeposits({ transactions: txs, currency: "UAH", months: 6, asOfDate: asOf }))
      .toBeCloseTo(1000, 6);
  });
  it("zero when nothing in window", () => {
    expect(avgMonthlyDeposits({ transactions: [], currency: "UAH", months: 6, asOfDate: asOf })).toBe(0);
  });
});

describe("maturityLadder", () => {
  it("buckets lots by maturity year and sums principal", () => {
    const lots = [{ isin: "A", quantity: 5 }, { isin: "B", quantity: 3 }];
    const bondsByIsin = new Map([
      ["A", { faceValue: 1000, maturityDate: "2027-05-01", currency: "UAH" }],
      ["B", { faceValue: 1000, maturityDate: "2027-09-01", currency: "UAH" }],
    ]);
    const ladder = maturityLadder(lots, bondsByIsin);
    expect(ladder.length).toBe(1);
    expect(ladder[0].year).toBe(2027);
    expect(ladder[0].totalPrincipal).toBe(8000);
  });
});

describe("accruedFromSchedule (НКД з фактичного графіка)", () => {
  // UA4000239081: транш 28.07.2026, але купонний період почався 24.02.2026 —
  // саме той випадок, де відлік від issueDate дає завищений НКД.
  const BOND = {
    faceValue: 1000,
    couponFrequency: 2,
    issueDate: "2026-07-28",
    customSchedule: [
      { date: "2026-08-26", amountPerPiece: 82.2, kind: "coupon" },
      { date: "2027-02-24", amountPerPiece: 82.2, kind: "coupon" },
      { date: "2030-02-20", amountPerPiece: 1082.2, kind: "coupon+redemption" },
    ],
  };

  it("одразу після виплати НКД майже нульовий", () => {
    expect(accruedFromSchedule(BOND, "2026-08-27")).toBeCloseTo(82.2 / 182, 1);
  });

  it("у середині періоду — приблизно половина купона", () => {
    // 26.08.2026 → 24.02.2027 це 182 дні; середина ≈ 25.11.2026
    expect(accruedFromSchedule(BOND, "2026-11-25")).toBeCloseTo(41.1, 0);
  });

  it("напередодні виплати — майже весь купон", () => {
    expect(accruedFromSchedule(BOND, "2027-02-23")).toBeGreaterThan(81);
  });

  it("на виплаті з погашенням тіло не входить у НКД", () => {
    // за день до 20.02.2030 накопичено майже весь купон, але не 1082
    const a = accruedFromSchedule(BOND, "2030-02-19");
    expect(a).toBeGreaterThan(80);
    expect(a).toBeLessThan(83);
  });

  it("після останньої виплати — нуль", () => {
    expect(accruedFromSchedule(BOND, "2030-03-01")).toBe(0);
  });

  it("без графіка повертає 0, а не падає", () => {
    expect(accruedFromSchedule({ faceValue: 1000 }, "2026-09-04")).toBe(0);
  });
});

describe("lotCurrentValue — амортизація премії замість стрибка до номіналу", () => {
  const BOND = {
    faceValue: 1000, couponRate: 16.44, couponFrequency: 2,
    issueDate: "2026-02-24", maturityDate: "2030-02-20",
    customSchedule: [
      { date: "2026-08-26", amountPerPiece: 82.2, kind: "coupon" },
      { date: "2027-02-24", amountPerPiece: 82.2, kind: "coupon" },
      { date: "2030-02-20", amountPerPiece: 1082.2, kind: "coupon+redemption" },
    ],
  };
  // Куплено з премією: чиста 1080, номінал 1000
  // Купівля рівно в день купона → НКД нульовий, видно чисту амортизацію
  const LOT = { purchaseDate: "2026-08-26", quantity: 10, purchasePrice: 1080, accruedInterestPerPiece: 0, commission: 0 };

  it("у день покупки вартість дорівнює вартості покупки, а не номіналу", () => {
    const v = lotCurrentValue(BOND, LOT, "2026-08-26");
    expect(v).toBeCloseTo(10800, 0);          // не 10 000 + НКД
  });

  it("на дату погашення сходиться до номіналу", () => {
    const v = lotCurrentValue(BOND, LOT, "2030-02-20");
    expect(v).toBeCloseTo(10000, 0);
  });

  it("посередині строку премія амортизована частково", () => {
    const v = lotCurrentValue(BOND, LOT, "2028-05-25");
    expect(v).toBeGreaterThan(10000);
    expect(v).toBeLessThan(10800);
  });

  it("папір, куплений з дисконтом, не показує миттєвого прибутку", () => {
    const cheap = { ...LOT, purchasePrice: 920 };
    expect(lotCurrentValue(BOND, cheap, "2026-08-26")).toBeCloseTo(9200, 0);
  });

  it("НКД береться з графіка, а не від дати випуску", () => {
    // 25.11.2026 — приблизно середина періоду 26.08 → 24.02, НКД ≈ пів купона
    const v = lotCurrentValue(BOND, LOT, "2026-11-25");
    const body = 10800 + (10000 - 10800) * ((Date.parse("2026-11-25") - Date.parse("2026-08-26")) / (Date.parse("2030-02-20") - Date.parse("2026-08-26")));
    expect(v - body).toBeCloseTo(41.1 * 10 / 100 * 100, -1);   // ≈411 грн НКД на 10 шт
  });
});

describe("requiredMonthlyContribution — складний відсоток, а не ділення", () => {
  it("під 0% дорівнює простому діленню залишку на місяці", () => {
    const v = requiredMonthlyContribution({ target: 120000, current: 0, years: 10, annualReturnPct: 0 });
    expect(v).toBeCloseTo(1000, 2);
  });

  it("під 17% потрібно втричі менше, ніж під 0%", () => {
    const zero = requiredMonthlyContribution({ target: 5_000_000, current: 22_126, years: 12.04, annualReturnPct: 0 });
    const real = requiredMonthlyContribution({ target: 5_000_000, current: 22_126, years: 12.04, annualReturnPct: 17 });
    expect(zero).toBeGreaterThan(34_000);
    expect(real).toBeGreaterThan(11_000);
    expect(real).toBeLessThan(12_000);
    expect(zero / real).toBeGreaterThan(2.8);
  });

  it("якщо наявне вже переростає ціль — внесок нульовий", () => {
    const v = requiredMonthlyContribution({ target: 100_000, current: 90_000, years: 10, annualReturnPct: 17 });
    expect(v).toBe(0);
  });

  it("projectedAtRate — дзеркальна до неї: внесок з неї дає рівно ціль", () => {
    const pmt = requiredMonthlyContribution({ target: 1_000_000, current: 50_000, years: 8, annualReturnPct: 15 });
    const fv = projectedAtRate({ current: 50_000, monthly: pmt, years: 8, annualReturnPct: 15 });
    expect(fv).toBeCloseTo(1_000_000, -1);
  });

  it("нульовий горизонт не ділить на нуль", () => {
    expect(requiredMonthlyContribution({ target: 100, current: 0, years: 0, annualReturnPct: 10 })).toBeNull();
  });
});

describe("історія портфеля", () => {
  const BOND = {
    isin: "UA0000000001", faceValue: 1000, couponRate: 16, couponFrequency: 2,
    issueDate: "2026-01-01", maturityDate: "2029-01-01", currency: "UAH",
    customSchedule: [
      { date: "2026-07-01", amountPerPiece: 80, kind: "coupon" },
      { date: "2029-01-01", amountPerPiece: 1080, kind: "coupon+redemption" },
    ],
  };
  const lots = [{ id: "l1", isin: "UA0000000001", accountId: "a1", purchaseDate: "2026-01-10",
                  quantity: 10, purchasePrice: 1000, accruedInterestPerPiece: 0, commission: 0 }];
  const accounts = [{ id: "a1", kind: "shared" }];
  const txs = [
    { id: "t1", accountId: "a1", date: "2026-01-10", currency: "UAH", amount: 10000, kind: "deposit" },
    { id: "t2", accountId: "a1", date: "2026-01-10", currency: "UAH", amount: -10000, kind: "lot_purchase" },
  ];

  it("перший внесок потрапляє в «внесено за період», а не в базу", () => {
    const pts = buildSeries({
      lots, bondsByIsin: new Map([[BOND.isin, BOND]]), transactions: txs, accounts,
      btc: {}, fx: {}, to: "2026-03-01", stepDays: 1,
    });
    expect(pts[0].total).toBe(0);                    // база — нуль
    const m = seriesMetrics(pts);
    expect(m.contributed).toBe(10000);               // а не 0
  });

  it("просадка не з'являється від самого лише поповнення", () => {
    const withTop = [...txs,
      { id: "t3", accountId: "a1", date: "2026-02-01", currency: "UAH", amount: 5000, kind: "deposit" }];
    const pts = buildSeries({
      lots, bondsByIsin: new Map([[BOND.isin, BOND]]), transactions: withTop, accounts,
      btc: {}, fx: {}, to: "2026-03-01", stepDays: 1,
    });
    const m = seriesMetrics(pts);
    expect(m.maxDrawdown).toBeGreaterThanOrEqual(-0.0001);
  });
});

describe("експорт виплат у календар", () => {
  const events = [
    { key: "UA1|acc|2026-09-18", date: "2026-09-18", summary: "Купон ₴1 134 · УЛФ-ФІНАНС", description: "31 шт" },
    { key: "UA2|acc|2026-10-28", date: "2026-10-28", summary: "Купон ₴485, і кома", description: "6 шт" },
  ];

  it("формує валідний VCALENDAR з подіями і нагадуваннями", () => {
    const ics = buildIcs(events);
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260918");
    expect(ics).toContain("TRIGGER:-P3D");
  });

  it("екранує коми — інакше календар зламає рядок на дві властивості", () => {
    const ics = buildIcs(events);
    expect(ics).toContain("Купон ₴485\\, і кома");
  });

  it("рядки розділені CRLF, як вимагає RFC 5545", () => {
    expect(buildIcs(events).includes("\r\n")).toBe(true);
  });

  it("UID стабільний — повторний імпорт оновлює подію, а не дублює", () => {
    expect(buildIcs(events)).toContain("UID:UA1|acc|2026-09-18@daughters-fund");
  });
});
