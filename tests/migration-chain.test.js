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
