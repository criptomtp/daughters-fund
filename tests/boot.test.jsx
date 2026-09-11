// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";

// jsdom + fake-indexeddb не дають робочого localStorage — підставляємо свій.
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: k => m.delete(String(k)),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
Object.defineProperty(window, "localStorage", { value: memStore(), configurable: true });
Object.defineProperty(window, "sessionStorage", { value: memStore(), configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: window.sessionStorage, configurable: true });
globalThis.fetch = globalThis.fetch || (() => Promise.reject(new Error("offline")));
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const App = (await import("../src/App.jsx")).default;

describe("застосунок монтується", () => {
  it("рендерить хоч щось у #root", async () => {
    const el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<StrictMode><App /></StrictMode>); });
    console.log("=== HTML ===", el.innerHTML.slice(0, 600));
    expect(el.innerHTML.length).toBeGreaterThan(0);
  });
});

// Регресія: біржовий рахунок не має тягнути облігації.
describe("біржовий рахунок ведеться монетами, не облігаціями", () => {
  it("cryptoBuy додає монети до залишку і списує гривню", async () => {
    const { accounts, brokers, persons, transactions } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "WhiteBit" });
    const p1 = await persons.add({ name: "A" });
    const p2 = await persons.add({ name: "B" });
    const acc = await accounts.add({
      name: "WhiteBit", brokerId: br.id, kind: "exchange",
      beneficiaryIds: [p1.id, p2.id],
    });

    await transactions.deposit({ accountId: acc.id, amount: 5000, currency: "UAH", date: "2026-09-05" });
    await transactions.cryptoBuy({
      accountId: acc.id, amount: 5000, ticker: "BTC",
      coinAmount: 0.00185, currency: "UAH", date: "2026-09-05",
    });

    const after = await accounts.get(acc.id);
    expect(after.holdings.BTC).toBeCloseTo(0.00185, 8);

    const bal = await transactions.balanceByCurrency(acc.id);
    expect(bal.UAH ?? 0).toBeCloseTo(0, 2);   // завели й одразу перевели в монети
  });

  it("біржовий рахунок без бенефіціарів не створюється", async () => {
    // Раніше обидві перевірки бенефіціарів були прив'язані до kind "shared"
    // і "personal", тож "exchange" проходив повз них. Рахунок створювався
    // з порожнім списком, частка кожного дорівнювала нулю, і крипта зникала
    // з підрахунку мовчки.
    const { accounts, brokers } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "WB" + Math.random() });
    await expect(
      accounts.add({ name: "WB" + Math.random(), brokerId: br.id, kind: "exchange", beneficiaryIds: [] })
    ).rejects.toThrow("щонайменше 1 бенефіціара");
    await expect(
      accounts.add({ name: "WB" + Math.random(), brokerId: br.id, kind: "exchange" })
    ).rejects.toThrow("щонайменше 1 бенефіціара");
  });

  it("cryptoBuy не працює на брокерському рахунку", async () => {
    const { accounts, brokers, persons, transactions } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "ICU-тест" });
    const p1 = await persons.add({ name: "C" });
    const acc = await accounts.add({
      name: "ICU-тест", brokerId: br.id, kind: "personal", beneficiaryIds: [p1.id],
    });
    await expect(
      transactions.cryptoBuy({ accountId: acc.id, amount: 100, ticker: "BTC", coinAmount: 0.001 })
    ).rejects.toThrow("Це не біржовий рахунок");
  });
});

describe("закриття лоту", () => {
  async function setup() {
    const { accounts, brokers, persons, bonds, lots, transactions } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "B" + Math.random() });
    const p = await persons.add({ name: "P" + Math.random() });
    const acc = await accounts.add({ name: "A" + Math.random(), brokerId: br.id, kind: "personal", beneficiaryIds: [p.id] });
    const isin = "UA400000" + String(Math.floor(Math.random() * 9000) + 1000);
    await bonds.add({
      isin, ticker: "T", type: "ovdp", currency: "UAH", faceValue: 1000,
      couponRate: 16, couponFrequency: 2,
      issueDate: "2026-01-01", maturityDate: "2027-01-01",
      customSchedule: [
        { date: "2026-07-01", amountPerPiece: 80, kind: "coupon" },
        { date: "2027-01-01", amountPerPiece: 1080, kind: "coupon+redemption" },
      ],
    });
    await transactions.deposit({ accountId: acc.id, amount: 20000, currency: "UAH", date: "2026-01-10" });
    const lot = await lots.add({
      isin, accountId: acc.id, purchaseDate: "2026-01-10", quantity: 10,
      purchasePrice: 1000, accruedInterestPerPiece: 0, commission: 0,
    });
    return { acc, lot, isin };
  }

  it("підтвердження погашення закриває лот і прибирає його з вартості", async () => {
    const { coupons, lots } = await import("../src/portfolio/repository.js");
    const { accountSummary } = await import("../src/portfolio/calculations.js");
    const { db } = await import("../src/portfolio/db.js");
    const { lot, isin } = await setup();

    const red = (await db.couponPayments.where("lotId").equals(lot.id).toArray())
      .find(c => c.kind === "coupon+redemption");
    await coupons.markReceived(red.id, { actualDate: "2027-01-01" });

    const after = await lots.get ? await db.lots.get(lot.id) : null;
    expect(after.closedAt).toBeTruthy();
    expect(after.closedReason).toBe("redemption");

    const bond = await db.bondReferences.get(isin);
    const s = accountSummary({
      lots: [after], bondsByIsin: new Map([[isin, bond]]), coupons: [],
      asOfDate: "2027-02-01T00:00:00.000Z",
    });
    expect(s.currentValue).toBe(0);          // папера більше немає
  });

  it("скасування підтвердження повертає лот у портфель", async () => {
    const { coupons } = await import("../src/portfolio/repository.js");
    const { db } = await import("../src/portfolio/db.js");
    const { lot } = await setup();
    const red = (await db.couponPayments.where("lotId").equals(lot.id).toArray())
      .find(c => c.kind === "coupon+redemption");
    await coupons.markReceived(red.id, { actualDate: "2027-01-01" });
    await coupons.markScheduled(red.id);
    const after = await db.lots.get(lot.id);
    expect(after.closedAt).toBeNull();
  });

  it("продаж закриває лот, зараховує виручку і знімає майбутні купони", async () => {
    const { lots, transactions } = await import("../src/portfolio/repository.js");
    const { db } = await import("../src/portfolio/db.js");
    const { acc, lot } = await setup();

    await lots.sell(lot.id, { date: "2026-03-01", amount: 10500 });
    const after = await db.lots.get(lot.id);
    expect(after.closedReason).toBe("sale");

    const txs = await transactions.list({ accountId: acc.id, kind: "lot_sale" });
    expect(txs[0].amount).toBe(10500);

    const left = await db.couponPayments.where("lotId").equals(lot.id).toArray();
    expect(left.filter(c => c.scheduledDate.slice(0, 10) > "2026-03-01")).toHaveLength(0);
  });

  it("двічі продати не можна", async () => {
    const { lots } = await import("../src/portfolio/repository.js");
    const { lot } = await setup();
    await lots.sell(lot.id, { date: "2026-03-01", amount: 10500 });
    await expect(lots.sell(lot.id, { date: "2026-04-01", amount: 1 })).rejects.toThrow("уже закритий");
  });
});
