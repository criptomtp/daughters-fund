import { describe, it, expect, vi } from "vitest";

// Stub db.js so migrations.js doesn't pull in Dexie/IndexedDB during tests.
vi.mock("../src/portfolio/db.js", () => ({ SCHEMA_VERSION: 5, db: {} }));

const { migrateBackup } = await import("../src/portfolio/migrations.js");

describe("migrateBackup", () => {
  it("migrates a v4 backup up to v5 (the previously-broken step)", () => {
    const v4 = { schemaVersion: 4, data: { persons: [], accounts: [], lots: [], cashTransactions: [] } };
    const out = migrateBackup(v4);
    expect(out.schemaVersion).toBe(5);
    expect(Array.isArray(out.data.snapshots)).toBe(true);
  });

  it("passes a current v5 backup through unchanged, preserving snapshots", () => {
    const v5 = { schemaVersion: 5, data: { persons: [], snapshots: [{ date: "2026-01-01", totals: { UAH: 1 } }] } };
    const out = migrateBackup(v5);
    expect(out.schemaVersion).toBe(5);
    expect(out.data.snapshots.length).toBe(1);
  });

  it("migrates a v1 owners backup through the full chain to v5", () => {
    const v1 = {
      schemaVersion: 1,
      data: { owners: [{ id: "o1", type: "person", name: "Tato" }], lots: [], bondReferences: [], couponPayments: [] },
    };
    const out = migrateBackup(v1);
    expect(out.schemaVersion).toBe(5);
    expect(out.data.persons.length).toBe(1);
    expect(out.data.accounts.length).toBe(1);
  });

  it("rejects a backup newer than the current schema", () => {
    expect(() => migrateBackup({ schemaVersion: 99, data: {} })).toThrow();
  });

  it("rejects a non-object payload", () => {
    expect(() => migrateBackup(null)).toThrow();
  });
});
