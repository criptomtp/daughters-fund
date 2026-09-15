import { describe, it, expect } from "vitest";
import { buildSeries, seriesMetrics } from "../src/portfolio/history.js";

// Дохідність тут рахується методом умовного паю: внески купують паї за
// вартістю, яка була безпосередньо перед надходженням грошей. Метод чутливий
// до того, як часто ми беремо точки — і саме через це підсумок колись залежав
// від густоти вибірки більше, ніж від ринку.

describe("дохідність за методом паю", () => {
  it("внесок посеред періоду не впливає на відсоток", () => {
    // +10%, потім внесок 100 без руху ринку, потім ще +10%.
    // Правильна відповідь — 1,1 × 1,1 − 1 = 21%, скільки б грошей не додали.
    const m = seriesMetrics([
      { day: "2026-01-01", total: 100, contributed: 100 },
      { day: "2026-01-02", total: 110, contributed: 100 },
      { day: "2026-01-03", total: 210, contributed: 200 },
      { day: "2026-01-04", total: 231, contributed: 200 },
    ]);
    expect(m.twr).toBeCloseTo(0.21, 6);
  });

  it("подвоєння вкладу без прибутку дає нуль", () => {
    const m = seriesMetrics([
      { day: "2026-01-01", total: 1000, contributed: 1000 },
      { day: "2026-01-02", total: 2000, contributed: 2000 },
    ]);
    expect(m.twr).toBeCloseTo(0, 9);
    expect(m.gain).toBeCloseTo(0, 9);
  });

  it("приріст = кінець мінус початок мінус внески", () => {
    const m = seriesMetrics([
      { day: "2026-01-01", total: 0, contributed: 0 },
      { day: "2026-01-02", total: 1000, contributed: 1000 },
      { day: "2026-01-03", total: 1150, contributed: 1000 },
    ]);
    expect(m.contributed).toBeCloseTo(1000, 6);
    expect(m.gain).toBeCloseTo(150, 6);
  });
});

describe("серія будується по днях незалежно від того, як її малюють", () => {
  const accounts = [{ id: "a1", kind: "personal" }];
  const transactions = [
    { id: "t1", accountId: "a1", pocketId: "p1", date: "2026-01-02", kind: "deposit", amount: 1000, currency: "UAH" },
  ];

  it("одна точка на день", () => {
    const pts = buildSeries({
      lots: [], bondsByIsin: new Map(), transactions, accounts,
      from: "2026-01-01", to: "2026-01-10", pocketId: "p1",
    });
    expect(pts.length).toBe(10);
    expect(pts[0].day).toBe("2026-01-01");
    expect(pts[pts.length - 1].day).toBe("2026-01-10");
  });

  it("stepDays більше нічого не змінює — його просто немає", () => {
    const args = {
      lots: [], bondsByIsin: new Map(), transactions, accounts,
      from: "2026-01-01", to: "2026-01-10", pocketId: "p1",
    };
    const a = buildSeries(args);
    const b = buildSeries({ ...args, stepDays: 5 });
    expect(b.length).toBe(a.length);
    expect(b.map(p => p.total)).toEqual(a.map(p => p.total));
  });

  it("гроші, заведені на біржу, не зникають до купівлі монет", () => {
    // Поповнення 05-го, купівля монет тільки 09-го. Усі чотири дні між ними
    // гроші лежать на біржі — і мають бути видні у вартості фонду.
    const ex = [{ id: "wb", kind: "exchange", holdingsByPocket: {} }];
    const pts = buildSeries({
      lots: [], bondsByIsin: new Map(), accounts: ex, pocketId: "p1",
      transactions: [
        { id: "t1", accountId: "wb", pocketId: "p1", date: "2026-01-05", kind: "deposit", amount: 5000, currency: "UAH" },
      ],
      from: "2026-01-01", to: "2026-01-10",
    });
    const at = (day) => pts.find(p => p.day === day).total;
    expect(at("2026-01-04")).toBeCloseTo(0, 6);
    expect(at("2026-01-06")).toBeCloseTo(5000, 6);
    expect(at("2026-01-10")).toBeCloseTo(5000, 6);
  });
});

describe("дохідність окремо по класах активів", () => {
  const accounts = [{ id: "icu", kind: "personal" }, { id: "wb", kind: "exchange", holdingsByPocket: { p1: { BTC: 1 } } }];
  const bondsByIsin = new Map([["X", { isin: "X", currency: "UAH", faceValue: 1000, couponRate: 0, couponFrequency: 1 }]]);

  it("купон зараховується як дохід паперів, а не як їх падіння", () => {
    // Купівля на 1000, потім купон 100 виходить у готівку. Вартість паперу
    // не змінилась, тож сотня — це чистий дохід: +10%. Якби відплив не
    // рухав паї, та сама сотня прочиталась би як −10% вартості паперів.
    const pts = buildSeries({
      lots: [{ id: "l1", isin: "X", accountId: "icu", pocketId: "p1", quantity: 1, purchasePrice: 1000, purchaseDate: "2026-01-02" }],
      bondsByIsin, accounts, pocketId: "p1",
      transactions: [
        { id: "d", accountId: "icu", pocketId: "p1", date: "2026-01-01", kind: "deposit", amount: 1000, currency: "UAH" },
        { id: "b", accountId: "icu", pocketId: "p1", date: "2026-01-02", kind: "lot_purchase", amount: -1000, currency: "UAH" },
        { id: "c", accountId: "icu", pocketId: "p1", date: "2026-01-05", kind: "coupon_received", amount: 100, currency: "UAH" },
      ],
      from: "2026-01-01", to: "2026-01-08",
    });
    const m = seriesMetrics(pts, "bonds", "contributedBonds");
    expect(m.twr).toBeCloseTo(0.10, 6);
    // Гроші від купона з паперів вийшли, тому «вкладено в облігації» зменшилось.
    expect(m.contributed).toBeCloseTo(900, 6);
    expect(m.gain).toBeCloseTo(100, 6);
  });

  it("клас активів рахується окремо від решти портфеля", () => {
    const pts = buildSeries({
      lots: [{ id: "l1", isin: "X", accountId: "icu", pocketId: "p1", quantity: 1, purchasePrice: 1000, purchaseDate: "2026-01-02" }],
      bondsByIsin, accounts, pocketId: "p1",
      transactions: [
        { id: "d", accountId: "icu", pocketId: "p1", date: "2026-01-01", kind: "deposit", amount: 1000, currency: "UAH" },
        { id: "b", accountId: "icu", pocketId: "p1", date: "2026-01-02", kind: "lot_purchase", amount: -1000, currency: "UAH" },
        { id: "d2", accountId: "wb", pocketId: "p1", date: "2026-01-03", kind: "deposit", amount: 500, currency: "UAH" },
      ],
      from: "2026-01-01", to: "2026-01-08",
    });
    const bonds = seriesMetrics(pts, "bonds", "contributedBonds");
    expect(bonds.contributed).toBeCloseTo(1000, 6);   // поповнення біржі сюди не входить
    expect(bonds.endValue).toBeCloseTo(1000, 6);
  });
});
