import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MIGRATIONS, migrateBackup } from "../src/portfolio/migrations.js";

// Окремий файл БЕЗ мока db.js. У migrations.test.js SCHEMA_VERSION замоканий
// на 5 — саме через це розрив у ланцюзі (5→6 не існувало) не було видно, і
// бекап v5 переставав відновлюватись непомітно.
function realSchemaVersion() {
  const src = readFileSync(new URL("../src/portfolio/db.js", import.meta.url), "utf8");
  return Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(src)[1]);
}

describe("ланцюг міграцій", () => {
  it("має крок для кожної версії від 1 до поточної", () => {
    const real = realSchemaVersion();
    const missing = [];
    for (let v = 1; v < real; v++) if (typeof MIGRATIONS[v] !== "function") missing.push(v);
    expect(missing).toEqual([]);
  });

  it("бекап v5 відновлюється — саме цей крок і був загублений", () => {
    const out = migrateBackup({
      schemaVersion: 5,
      data: {
        persons: [], brokers: [], accounts: [], bondReferences: [],
        lots: [{ id: "l1", isin: "UA4000000001", accountId: "a1",
                 purchaseDate: "2026-01-01", quantity: 1, purchasePrice: 1000 }],
        couponPayments: [], cashTransactions: [], snapshots: [],
      },
    });
    expect(out.data.lots[0].closedAt).toBeNull();
    expect(out.data.lots[0].quantity).toBe(1);
  });

  it("вже закритий лот не перезаписується міграцією", () => {
    const out = MIGRATIONS[5]({
      schemaVersion: 5,
      data: { lots: [{ id: "l1", closedAt: "2026-05-01", closedReason: "sale" }] },
    });
    expect(out.data.lots[0].closedAt).toBe("2026-05-01");
  });
});

describe("кишені власників (v6 → v7)", () => {
  const v6 = () => ({
    schemaVersion: 6,
    data: {
      persons: [
        { id: "c1", name: "Донька 1", type: "child" },
        { id: "c2", name: "Донька 2", type: "child" },
      ],
      brokers: [], bondReferences: [], couponPayments: [], snapshots: [],
      accounts: [{ id: "a1", name: "ICU", kind: "shared", beneficiaryIds: ["c1", "c2"] }],
      lots: [{ id: "l1", isin: "UA4000000001", accountId: "a1", quantity: 5,
               purchasePrice: 1000, purchaseDate: "2026-01-01", closedAt: null }],
      cashTransactions: [{ id: "t1", accountId: "a1", date: "2026-01-01",
                           kind: "deposit", amount: 5000, currency: "UAH" }],
    },
  });

  it("жоден лот і жодна транзакція не лишаються без кишені", () => {
    const out = migrateBackup(v6());
    expect(out.data.lots.every(l => l.pocketId)).toBe(true);
    expect(out.data.cashTransactions.every(t => t.pocketId)).toBe(true);
  });

  it("порожніх кишень не існує — інакше частка дорівнювала б нулю", () => {
    const out = migrateBackup(v6());
    expect(out.data.pockets.length).toBe(2);
    for (const pk of out.data.pockets) {
      const total = Object.values(pk.memberWeights).reduce((s, w) => s + w, 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it("персона-батько створюється, бо в реальних даних її немає", () => {
    const out = migrateBackup(v6());
    const parents = out.data.persons.filter(p => p.type === "parent");
    expect(parents.length).toBe(1);
    const self = out.data.pockets.find(pk => pk.name === "Я");
    expect(Object.keys(self.memberWeights)).toEqual([parents[0].id]);
  });

  it("наявна персона-батько не дублюється", () => {
    const payload = v6();
    payload.data.persons.push({ id: "dad", name: "Тато", type: "parent" });
    const out = migrateBackup(payload);
    expect(out.data.persons.filter(p => p.type === "parent").length).toBe(1);
    expect(out.data.pockets.find(pk => pk.name === "Я").memberWeights).toEqual({ dad: 1 });
  });

  it("обидві доньки потрапляють у дитячу кишеню з рівними вагами", () => {
    const out = migrateBackup(v6());
    const kids = out.data.pockets.find(pk => pk.name === "Доньки");
    expect(kids.memberWeights).toEqual({ c1: 1, c2: 1 });
  });

  it("уже проставлена кишеня не перезаписується", () => {
    const payload = v6();
    payload.data.lots[0].pocketId = "pocket_self";
    const out = migrateBackup(payload);
    expect(out.data.lots[0].pocketId).toBe("pocket_self");
  });
});
