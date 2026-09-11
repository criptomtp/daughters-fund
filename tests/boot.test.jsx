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
    const { accounts, brokers, persons, pockets, transactions } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "WhiteBit" });
    const p1 = await persons.add({ name: "A" });
    const p2 = await persons.add({ name: "B" });
    const acc = await accounts.add({
      name: "WhiteBit", brokerId: br.id, kind: "exchange",
      beneficiaryIds: [p1.id, p2.id],
    });
    const pk = await pockets.add({ name: "Доньки", memberWeights: { [p1.id]: 1, [p2.id]: 1 } });

    await transactions.deposit({ accountId: acc.id, pocketId: pk.id, amount: 5000, currency: "UAH", date: "2026-09-05" });
    await transactions.cryptoBuy({
      accountId: acc.id, pocketId: pk.id, amount: 5000, ticker: "BTC",
      coinAmount: 0.00185, currency: "UAH", date: "2026-09-05",
    });

    const after = await accounts.get(acc.id);
    // Монети лягають у кишеню платника, а не в спільне число на рахунку.
    expect(after.holdingsByPocket[pk.id].BTC).toBeCloseTo(0.00185, 8);

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
      transactions.cryptoBuy({ accountId: acc.id, amount: 100, ticker: "BTC", coinAmount: 0.001, pocketId: "any" })
    ).rejects.toThrow("Це не біржовий рахунок");
  });
});

describe("закриття лоту", () => {
  async function setup() {
    const { accounts, brokers, persons, pockets, bonds, lots, transactions } = await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "B" + Math.random() });
    const p = await persons.add({ name: "P" + Math.random() });
    const acc = await accounts.add({ name: "A" + Math.random(), brokerId: br.id, kind: "personal", beneficiaryIds: [p.id] });
    const pocket = await pockets.add({ name: "P" + Math.random(), memberWeights: { [p.id]: 1 } });
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
    await transactions.deposit({ accountId: acc.id, pocketId: pocket.id, amount: 20000, currency: "UAH", date: "2026-01-10" });
    const lot = await lots.add({
      isin, accountId: acc.id, pocketId: pocket.id,
      purchaseDate: "2026-01-10", quantity: 10,
      purchasePrice: 1000, accruedInterestPerPiece: 0, commission: 0,
    });
    return { acc, lot, isin, pocket };
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

describe("кишені власників на одному рахунку", () => {
  async function twoPockets() {
    const { accounts, brokers, persons, pockets, bonds, lots, transactions } =
      await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "ICU" + Math.random() });
    const kid = await persons.add({ name: "K" + Math.random(), type: "child" });
    const dad = await persons.add({ name: "D" + Math.random(), type: "parent" });
    const acc = await accounts.add({
      name: "ICU" + Math.random(), brokerId: br.id, kind: "personal",
      beneficiaryIds: [kid.id],
    });
    const kids = await pockets.add({ name: "Доньки" + Math.random(), memberWeights: { [kid.id]: 1 } });
    const mine = await pockets.add({ name: "Я" + Math.random(), memberWeights: { [dad.id]: 1 } });

    const isin = "UA400001" + String(Math.floor(Math.random() * 9000) + 1000);
    await bonds.add({
      isin, ticker: "T", type: "ovdp", currency: "UAH", faceValue: 1000,
      couponRate: 16, couponFrequency: 1,
      issueDate: "2026-01-01", maturityDate: "2027-01-01",
      customSchedule: [{ date: "2027-01-01", amountPerPiece: 1080, kind: "coupon+redemption" }],
    });

    await transactions.deposit({ accountId: acc.id, pocketId: kids.id, amount: 50000, currency: "UAH", date: "2026-01-02" });
    await transactions.deposit({ accountId: acc.id, pocketId: mine.id, amount: 50000, currency: "UAH", date: "2026-01-02" });

    const base = { isin, accountId: acc.id, purchaseDate: "2026-01-10", purchasePrice: 1000, accruedInterestPerPiece: 0, commission: 0 };
    const kidLot  = await lots.add({ ...base, pocketId: kids.id, quantity: 6 });
    const myLot   = await lots.add({ ...base, pocketId: mine.id, quantity: 4 });
    return { acc, kids, mine, kidLot, myLot, isin };
  }

  it("погашення в один день ділиться між кишенями за кількістю", async () => {
    const { coupons } = await import("../src/portfolio/repository.js");
    const { db } = await import("../src/portfolio/db.js");
    const { acc, kids, mine, kidLot, myLot } = await twoPockets();

    const forLot = async (id) =>
      (await db.couponPayments.where("lotId").equals(id).toArray())
        .find(c => c.kind === "coupon+redemption");
    const a = await forLot(kidLot.id);
    const b = await forLot(myLot.id);
    expect(a.scheduledDate).toBe(b.scheduledDate);   // один день — одна подія

    await coupons.markGroupReceived([a.id, b.id], {
      actualDate: "2027-01-01", actualAmount: 10800, accountId: acc.id,
    });

    const cash = await db.cashTransactions.where("accountId").equals(acc.id).toArray();
    const red = cash.filter(t => t.kind === "lot_redemption");
    const byPocket = (id) => red.filter(t => t.pocketId === id).reduce((s, t) => s + t.amount, 0);

    expect(byPocket(kids.id)).toBeCloseTo(6480, 2);   // 6 з 10 шт
    expect(byPocket(mine.id)).toBeCloseTo(4320, 2);   // 4 з 10 шт
    expect(byPocket(kids.id) + byPocket(mine.id)).toBeCloseTo(10800, 2);
  });

  it("копійки округлення не губляться між кишенями", async () => {
    const { coupons } = await import("../src/portfolio/repository.js");
    const { db } = await import("../src/portfolio/db.js");
    const { acc, kidLot, myLot } = await twoPockets();
    const forLot = async (id) =>
      (await db.couponPayments.where("lotId").equals(id).toArray())
        .find(c => c.kind === "coupon+redemption");

    // Сума, що не ділиться націло у пропорції 6:4
    await coupons.markGroupReceived([(await forLot(kidLot.id)).id, (await forLot(myLot.id)).id], {
      actualDate: "2027-01-01", actualAmount: 10800.01, accountId: acc.id,
    });

    const red = (await db.cashTransactions.where("accountId").equals(acc.id).toArray())
      .filter(t => t.kind === "lot_redemption");
    const total = red.reduce((s, t) => s + t.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(10800.01);
  });

  it("баланс рахунку рахується окремо по кишенях", async () => {
    const { transactions } = await import("../src/portfolio/repository.js");
    const { acc, kids, mine } = await twoPockets();

    const kidsBal = await transactions.balanceByCurrency(acc.id, null, kids.id);
    const mineBal = await transactions.balanceByCurrency(acc.id, null, mine.id);
    const total   = await transactions.balanceByCurrency(acc.id);

    expect(kidsBal.UAH).toBeCloseTo(50000 - 6000, 2);
    expect(mineBal.UAH).toBeCloseTo(50000 - 4000, 2);
    expect(total.UAH).toBeCloseTo(kidsBal.UAH + mineBal.UAH, 2);
  });

  it("переказ між кишенями не змінює загальний залишок рахунку", async () => {
    const { transactions } = await import("../src/portfolio/repository.js");
    const { acc, kids, mine } = await twoPockets();
    const before = (await transactions.balanceByCurrency(acc.id)).UAH;

    await transactions.pocketTransfer({
      accountId: acc.id, fromPocketId: kids.id, toPocketId: mine.id,
      amount: 1133.84, currency: "UAH", date: "2026-09-18",
    });

    const kidsBal = (await transactions.balanceByCurrency(acc.id, null, kids.id)).UAH;
    const mineBal = (await transactions.balanceByCurrency(acc.id, null, mine.id)).UAH;
    const after   = (await transactions.balanceByCurrency(acc.id)).UAH;

    expect(after).toBeCloseTo(before, 2);
    expect(kidsBal).toBeCloseTo(50000 - 6000 - 1133.84, 2);
    expect(mineBal).toBeCloseTo(50000 - 4000 + 1133.84, 2);
  });

  it("кишеня без учасників не створюється", async () => {
    const { pockets } = await import("../src/portfolio/repository.js");
    await expect(pockets.add({ name: "Порожня", memberWeights: {} }))
      .rejects.toThrow("щонайменше одного учасника");
    await expect(pockets.add({ name: "Нулі", memberWeights: { x: 0 } }))
      .rejects.toThrow("щонайменше одного учасника");
  });

  it("кишеню, на яку є посилання, видалити не можна", async () => {
    const { pockets } = await import("../src/portfolio/repository.js");
    const { kids } = await twoPockets();
    await expect(pockets.remove(kids.id)).rejects.toThrow("використовується");
  });
});

describe("поділ лоту між кишенями", () => {
  async function oneLot(commission = 0) {
    const { accounts, brokers, persons, pockets, bonds, lots, transactions } =
      await import("../src/portfolio/repository.js");
    const br = await brokers.add({ name: "B" + Math.random() });
    const kid = await persons.add({ name: "K" + Math.random(), type: "child" });
    const dad = await persons.add({ name: "D" + Math.random(), type: "parent" });
    const acc = await accounts.add({
      name: "A" + Math.random(), brokerId: br.id, kind: "personal", beneficiaryIds: [kid.id],
    });
    const kids = await pockets.add({ name: "K" + Math.random(), memberWeights: { [kid.id]: 1 } });
    const mine = await pockets.add({ name: "M" + Math.random(), memberWeights: { [dad.id]: 1 } });

    const isin = "UA400002" + String(Math.floor(Math.random() * 9000) + 1000);
    await bonds.add({
      isin, ticker: "T", type: "ovdp", currency: "UAH", faceValue: 1000,
      couponRate: 16, couponFrequency: 1,
      issueDate: "2026-01-01", maturityDate: "2027-01-01",
      customSchedule: [{ date: "2027-01-01", amountPerPiece: 1080, kind: "coupon+redemption" }],
    });
    await transactions.deposit({ accountId: acc.id, pocketId: kids.id, amount: 20000, currency: "UAH", date: "2026-01-02" });
    const lot = await lots.add({
      isin, accountId: acc.id, pocketId: kids.id, purchaseDate: "2026-01-10",
      quantity: 10, purchasePrice: 1000, accruedInterestPerPiece: 5, commission,
    });
    return { acc, kids, mine, lot, isin };
  }

  it("ділить у межах одного рахунку — раніше це було заборонено", async () => {
    const { lots } = await import("../src/portfolio/repository.js");
    const { acc, kids, mine, lot } = await oneLot();

    const { newLot } = await lots.split({ lotId: lot.id, quantityForNew: 4, newPocketId: mine.id });

    expect(newLot.accountId).toBe(acc.id);          // рахунок той самий
    expect(newLot.pocketId).toBe(mine.id);
    expect(newLot.quantity).toBe(4);
    const old = await lots.get(lot.id);
    expect(old.quantity).toBe(6);
    expect(old.pocketId).toBe(kids.id);
  });

  it("поділ без зміни рахунку й кишені не має сенсу і не проходить", async () => {
    const { lots } = await import("../src/portfolio/repository.js");
    const { lot } = await oneLot();
    await expect(lots.split({ lotId: lot.id, quantityForNew: 4 }))
      .rejects.toThrow("Має змінитися рахунок або кишеня");
  });

  it("баланс не змінюється ні при поділі, ні при редагуванні половин", async () => {
    const { lots, transactions } = await import("../src/portfolio/repository.js");
    const { acc, mine, lot } = await oneLot(37.5);

    const before = (await transactions.balanceByCurrency(acc.id)).UAH;
    const { newLot } = await lots.split({ lotId: lot.id, quantityForNew: 4, newPocketId: mine.id });

    const afterSplit = (await transactions.balanceByCurrency(acc.id)).UAH;
    expect(afterSplit).toBeCloseTo(before, 2);

    // Саме тут ламалось раніше: у нового лоту транзакція мала суму 0, і перше
    // ж редагування переписувало її на повну — з рахунку списувалось те,
    // чого ніколи не витрачали.
    await lots.update(newLot.id, { notes: "правка" });
    expect((await transactions.balanceByCurrency(acc.id)).UAH).toBeCloseTo(before, 2);

    await lots.update(lot.id, { notes: "правка" });
    expect((await transactions.balanceByCurrency(acc.id)).UAH).toBeCloseTo(before, 2);
  });

  it("сума вкладеного в дві половини дорівнює вкладеному в цілий лот", async () => {
    const { lots } = await import("../src/portfolio/repository.js");
    const { lotInvested } = await import("../src/portfolio/calculations.js");
    const { mine, lot } = await oneLot(37.5);

    const wholeInvested = lotInvested(lot);
    const { newLot } = await lots.split({ lotId: lot.id, quantityForNew: 4, newPocketId: mine.id });
    const old = await lots.get(lot.id);

    expect(lotInvested(old) + lotInvested(newLot)).toBeCloseTo(wholeInvested, 2);
  });
});

describe("простори не бачать чужого", () => {
  it("купони чужої кишені не потрапляють у підсумок", async () => {
    const { accountSummary } = await import("../src/portfolio/calculations.js");
    // Лоти порожні — це простір, де своїх паперів ще немає. Купони по чужих
    // лотах передані повним списком, як їх і віддає база.
    const s = accountSummary({
      lots: [],
      bondsByIsin: new Map([["X", { currency: "UAH", faceValue: 1000 }]]),
      coupons: [
        { lotId: "чужий", status: "received", actualDate: "2026-06-18", actualAmount: 3313.71 },
        { lotId: "чужий", status: "scheduled", scheduledDate: "2026-12-18", amountNet: 500 },
      ],
      asOfDate: "2026-09-11T00:00:00.000Z",
    });
    expect(s.receivedYTD).toBe(0);
    expect(s.scheduledNext12m).toBe(0);
  });

  it("купони закритого лоту лишаються в підсумку", async () => {
    const { accountSummary } = await import("../src/portfolio/calculations.js");
    const s = accountSummary({
      lots: [{ id: "l1", isin: "X", quantity: 5, purchasePrice: 1000, closedAt: "2026-07-01" }],
      bondsByIsin: new Map([["X", { currency: "UAH", faceValue: 1000 }]]),
      coupons: [{ lotId: "l1", status: "received", actualDate: "2026-06-18", actualAmount: 437 }],
      asOfDate: "2026-09-11T00:00:00.000Z",
    });
    expect(s.receivedYTD).toBeCloseTo(437, 2);   // папір погашено, гроші отримані
  });

  it("монети рахуються тій кишені, що їх купила", async () => {
    const { extraByPocketFrom, pocketCoins, accountCoins } =
      await import("../src/portfolio/calculations.js");
    const acc = {
      id: "wb", kind: "exchange",
      holdingsByPocket: { kids: { BTC: 0.02 }, mine: { BTC: 0.005 } },
    };
    expect(pocketCoins(acc, "kids").BTC).toBe(0.02);
    expect(accountCoins(acc).BTC).toBeCloseTo(0.025, 8);

    const v = extraByPocketFrom({ accounts: [acc], priceOf: () => 4000000 });
    expect(v.get("kids")).toBeCloseTo(80000, 2);
    expect(v.get("mine")).toBeCloseTo(20000, 2);
  });
});
