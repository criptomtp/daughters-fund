import Dexie from "dexie";

const SCHEMA_VERSION = 5;

class PortfolioDB extends Dexie {
  constructor() {
    super("daughters-fund");

    // v1 (legacy) — kept for migration only
    this.version(1).stores({
      owners: "id, type, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, ownerId, purchaseDate, [ownerId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
    });

    // v2 — Persons + Brokers + Accounts split
    this.version(2).stores({
      owners: null,
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, purchaseDate, [accountId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
    }).upgrade(async tx => {
      const defaultBrokerId = "broker_default";
      const existing = await tx.table("brokers").get(defaultBrokerId).catch(() => null);
      if (!existing) {
        await tx.table("brokers").put({
          id: defaultBrokerId,
          name: "Невідомий брокер",
          color: "#7a7568",
          emoji: "🏦",
          createdAt: new Date().toISOString(),
        });
      }

      const oldOwners = await tx.table("owners").toArray().catch(() => []);
      const persons = [];
      const accounts = [];
      const ownerToAccountId = new Map();

      for (const o of oldOwners) {
        if (o.type === "group") {
          const acc = {
            id: o.id, name: o.name, kind: "shared",
            brokerId: defaultBrokerId,
            beneficiaryIds: Array.isArray(o.members) ? o.members : [],
            color: o.color, emoji: o.emoji,
            primaryCurrency: "UAH",
            createdAt: o.createdAt,
          };
          accounts.push(acc);
          ownerToAccountId.set(o.id, acc.id);
        } else {
          persons.push({
            id: o.id, name: o.name, type: o.type,
            birthDate: o.birthDate, color: o.color, emoji: o.emoji,
            createdAt: o.createdAt,
          });
          const accId = `acc_${o.id}`;
          accounts.push({
            id: accId, name: o.name, kind: "personal",
            brokerId: defaultBrokerId,
            beneficiaryIds: [o.id],
            color: o.color, emoji: o.emoji,
            primaryCurrency: "UAH",
            createdAt: o.createdAt,
          });
          ownerToAccountId.set(o.id, accId);
        }
      }

      if (persons.length)  await tx.table("persons").bulkPut(persons);
      if (accounts.length) await tx.table("accounts").bulkPut(accounts);

      const oldLots = await tx.table("lots").toArray().catch(() => []);
      for (const lot of oldLots) {
        const accountId = ownerToAccountId.get(lot.ownerId) || null;
        await tx.table("lots").update(lot.id, { accountId });
      }
    });

    // v3 — accruedInterestPaid → accruedInterestPerPiece
    this.version(3).stores({
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, purchaseDate, [accountId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
    }).upgrade(async tx => {
      const allLots = await tx.table("lots").toArray();
      for (const lot of allLots) {
        if (lot.accruedInterestPerPiece == null && lot.accruedInterestPaid != null && lot.quantity > 0) {
          await tx.table("lots").update(lot.id, {
            accruedInterestPerPiece: lot.accruedInterestPaid / lot.quantity,
            accruedInterestPaid: undefined,
          });
        } else if (lot.accruedInterestPaid != null && lot.accruedInterestPerPiece != null) {
          await tx.table("lots").update(lot.id, { accruedInterestPaid: undefined });
        }
      }
    });

    // v4 — Cash transactions (Stage 2)
    this.version(4).stores({
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, purchaseDate, [accountId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
      cashTransactions: "id, accountId, date, kind, currency, [accountId+date], [accountId+currency], [refId+refType]",
    }).upgrade(async tx => {
      // Backfill: для існуючих лотів створити lot_purchase tx
      const lotsTable = tx.table("lots");
      const bondsTable = tx.table("bondReferences");
      const txTable = tx.table("cashTransactions");

      const allLots = await lotsTable.toArray();
      const allBonds = await bondsTable.toArray();
      const bondsByIsin = new Map(allBonds.map(b => [b.isin, b]));

      const cashTxs = [];
      for (const lot of allLots) {
        const bond = bondsByIsin.get(lot.isin);
        if (!bond) continue;
        const invested = lot.quantity * lot.purchasePrice
          + (Number(lot.accruedInterestPerPiece) || 0) * lot.quantity
          + (Number(lot.commission) || 0);
        cashTxs.push({
          id: crypto.randomUUID(),
          accountId: lot.accountId,
          date: lot.purchaseDate,
          currency: bond.currency,
          amount: -invested,
          kind: "lot_purchase",
          refId: lot.id,
          refType: "lot",
          notes: "Backfill при міграції v3→v4",
          createdAt: new Date().toISOString(),
        });
      }

      // Backfill received coupons
      const couponsTable = tx.table("couponPayments");
      const allCoupons = await couponsTable.toArray();
      const lotsById = new Map(allLots.map(l => [l.id, l]));

      for (const c of allCoupons) {
        if (c.status !== "received") continue;
        const lot = lotsById.get(c.lotId);
        if (!lot) continue;
        const bond = bondsByIsin.get(lot.isin);
        if (!bond) continue;
        cashTxs.push({
          id: crypto.randomUUID(),
          accountId: lot.accountId,
          date: c.actualDate || c.scheduledDate,
          currency: bond.currency,
          amount: c.actualAmount ?? c.amountNet ?? 0,
          kind: c.kind === "redemption" ? "lot_redemption"
              : c.kind === "coupon+redemption" ? "lot_redemption"
              : "coupon_received",
          refId: c.id,
          refType: "coupon",
          notes: "Backfill при міграції v3→v4",
          createdAt: new Date().toISOString(),
        });
      }

      if (cashTxs.length) await txTable.bulkAdd(cashTxs);
    });

    // v5 — Daily portfolio value snapshots для equity curve
    this.version(5).stores({
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, purchaseDate, [accountId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
      cashTransactions: "id, accountId, date, kind, currency, [accountId+date], [accountId+currency], [refId+refType]",
      snapshots: "date",
    });
  }
}

export const db = new PortfolioDB();
export { SCHEMA_VERSION };
