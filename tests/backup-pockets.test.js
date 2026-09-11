// Окремий файл навмисно: backup.importAll ОЧИЩАЄ всі таблиці. У boot.test.jsx
// застосунок лишається змонтованим до кінця файлу разом із живими підписками
// Dexie, тож очищення бази посеред прогону перерендерює його на порожніх
// даних — і падає щось стороннє, у випадковому місці й не щоразу.
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
describe("бекап переживає кишені", () => {
  it("експорт → імпорт зберігає кишені, ваги й належність лотів", async () => {
    const { backup } = await import("../src/portfolio/repository.js");
    const { db } = await import("../src/portfolio/db.js");

    // Бекап старої версії: кишень у ньому ще немає взагалі.
    const v6 = {
      schemaVersion: 6,
      exportedAt: "2026-09-11T00:00:00.000Z",
      data: {
        persons: [
          { id: "c1", name: "Донька 1", type: "child" },
          { id: "c2", name: "Донька 2", type: "child" },
        ],
        brokers: [{ id: "br1", name: "ICU" }],
        accounts: [{ id: "a1", name: "ICU", kind: "shared", brokerId: "br1", beneficiaryIds: ["c1", "c2"] }],
        bondReferences: [{
          isin: "UA4000009999", ticker: "T", type: "ovdp", currency: "UAH", faceValue: 1000,
          couponRate: 16, couponFrequency: 1, issueDate: "2026-01-01", maturityDate: "2027-01-01",
        }],
        lots: [{ id: "l1", isin: "UA4000009999", accountId: "a1", quantity: 5,
                 purchasePrice: 1000, purchaseDate: "2026-01-10", closedAt: null }],
        couponPayments: [],
        cashTransactions: [{ id: "t1", accountId: "a1", date: "2026-01-02",
                             kind: "deposit", amount: 10000, currency: "UAH" }],
        snapshots: [],
      },
    };

    await backup.importAll(v6);

    const pockets = await db.pockets.toArray();
    expect(pockets.length).toBe(2);
    const kids = pockets.find(p => p.name === "Доньки");
    expect(kids.memberWeights).toEqual({ c1: 1, c2: 1 });
    expect((await db.lots.get("l1")).pocketId).toBe(kids.id);
    expect((await db.cashTransactions.get("t1")).pocketId).toBe(kids.id);

    // А тепер найважливіше: чи виїдуть кишені назад у файл. Раніше
    // exportAll/importAll були двома явними переліками таблиць, тож нова
    // таблиця мовчки випадала б з кожного експорту.
    const out = await backup.exportAll();
    expect(Array.isArray(out.data.pockets)).toBe(true);
    expect(out.data.pockets.length).toBe(2);
    expect(out.data.pockets.find(p => p.name === "Доньки").memberWeights).toEqual({ c1: 1, c2: 1 });

    // Друге коло: імпорт уже мігрованого файлу нічого не ламає і не дублює.
    await backup.importAll(out);
    expect((await db.pockets.toArray()).length).toBe(2);
    expect((await db.lots.get("l1")).pocketId).toBe(kids.id);
  });
});
