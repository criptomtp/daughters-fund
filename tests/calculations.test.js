import { describe, it, expect } from "vitest";
import {
  addMonths,
  lotCurrentValue,
  xirr,
  accountSummary,
  goalProgress,
  convertCurrency,
  beneficiaryShare,
  generateCouponSchedule,
  accruedInterest,
  maturityLadder,
} from "../src/portfolio/calculations.js";

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

describe("beneficiaryShare", () => {
  it("equal split with no weights", () => {
    expect(beneficiaryShare({ beneficiaryIds: ["a", "b"] }, "a")).toBeCloseTo(0.5, 10);
  });
  it("explicit 60/40 weights", () => {
    const acc = { beneficiaryIds: ["a", "b"], beneficiaryWeights: { a: 60, b: 40 } };
    expect(beneficiaryShare(acc, "a")).toBeCloseTo(0.6, 10);
    expect(beneficiaryShare(acc, "b")).toBeCloseTo(0.4, 10);
  });
  it("falls back to equal when weights sum to zero", () => {
    expect(beneficiaryShare({ beneficiaryIds: ["a", "b"], beneficiaryWeights: { a: 0, b: 0 } }, "a")).toBeCloseTo(0.5, 10);
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
    accounts: [{ id: "a1", beneficiaryIds: ["p1"] }],
    lots: [],
    bondsByIsin: new Map(),
    cashByAccount: new Map([["a1", { UAH: 40000 }]]),
  };

  it("counts same-currency cash toward the goal", () => {
    expect(goalProgress(base).currentValue).toBeCloseTo(40000, 2);
  });
  it("converts other-currency cash when fxRates are supplied", () => {
    const g = goalProgress({ ...base, cashByAccount: new Map([["a1", { USD: 100 }]]), fxRates: { UAH: 50, USD: 1.1, EUR: 1 } });
    expect(g.currentValue).toBeCloseTo(4545.45, 1); // 100 USD = 90.91 EUR = 4545.45 UAH
  });
  it("drops other-currency cash without rates (backward compatible)", () => {
    const g = goalProgress({ ...base, cashByAccount: new Map([["a1", { USD: 100 }]]) });
    expect(g.currentValue).toBe(0);
  });
  it("splits a shared account by explicit weights", () => {
    const g = goalProgress({
      person: { id: "p1", birthDate: "2020-01-01", targetAmount: 100000, targetCurrency: "UAH" },
      accounts: [{ id: "a1", beneficiaryIds: ["p1", "p2"], beneficiaryWeights: { p1: 70, p2: 30 } }],
      lots: [],
      bondsByIsin: new Map(),
      cashByAccount: new Map([["a1", { UAH: 10000 }]]),
    });
    expect(g.currentValue).toBeCloseTo(7000, 2);
  });
  it("flags deadlineReached past 18 with a remaining gap", () => {
    const g = goalProgress({ ...base, person: { ...base.person, birthDate: "2000-01-01" }, cashByAccount: new Map() });
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
