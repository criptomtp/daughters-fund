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
