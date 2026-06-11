import { SCHEMA_VERSION } from "./db.js";

const MIGRATIONS = {
  // v1 → v2: Owner розщеплено на Person + Account, додано Broker
  1: (payload) => {
    const oldOwners = payload.data.owners || [];
    const persons = [];
    const accounts = [];
    const ownerToAccountId = new Map();

    const defaultBrokerId = "broker_default";
    const brokers = [{
      id: defaultBrokerId, name: "Невідомий брокер",
      color: "#7a7568", emoji: "🏦",
      createdAt: payload.exportedAt || new Date().toISOString(),
    }];

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

    const oldLots = payload.data.lots || [];
    const newLots = oldLots.map(lot => ({
      ...lot,
      accountId: ownerToAccountId.get(lot.ownerId) || null,
      ownerId: undefined,
    }));

    return {
      schemaVersion: 2,
      exportedAt: payload.exportedAt,
      data: {
        persons, brokers, accounts,
        bondReferences: payload.data.bondReferences || [],
        lots: newLots,
        couponPayments: payload.data.couponPayments || [],
      },
    };
  },

  // v2 → v3: accruedInterestPaid (total) → accruedInterestPerPiece
  2: (payload) => {
    const oldLots = payload.data.lots || [];
    const newLots = oldLots.map(lot => {
      const out = { ...lot };
      if (out.accruedInterestPerPiece == null
          && out.accruedInterestPaid != null
          && out.quantity > 0) {
        out.accruedInterestPerPiece = out.accruedInterestPaid / out.quantity;
      }
      delete out.accruedInterestPaid;
      return out;
    });
    return {
      ...payload,
      schemaVersion: 3,
      data: { ...payload.data, lots: newLots },
    };
  },

  // v3 → v4: backfill cash transactions з лотів і отриманих купонів
  3: (payload) => {
    const lots = payload.data.lots || [];
    const bonds = payload.data.bondReferences || [];
    const cp = payload.data.couponPayments || [];
    const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));
    const lotsById = new Map(lots.map(l => [l.id, l]));

    const cashTransactions = [];
    const nowIso = new Date().toISOString();
    const uid = () => crypto.randomUUID();

    for (const lot of lots) {
      const bond = bondsByIsin.get(lot.isin);
      if (!bond) continue;
      const invested = lot.quantity * lot.purchasePrice
        + (Number(lot.accruedInterestPerPiece) || 0) * lot.quantity
        + (Number(lot.commission) || 0);
      cashTransactions.push({
        id: uid(),
        accountId: lot.accountId,
        date: lot.purchaseDate,
        currency: bond.currency,
        amount: -invested,
        kind: "lot_purchase",
        refId: lot.id,
        refType: "lot",
        notes: "Backfill при міграції v3→v4",
        createdAt: nowIso,
      });
    }

    for (const c of cp) {
      if (c.status !== "received") continue;
      const lot = lotsById.get(c.lotId);
      if (!lot) continue;
      const bond = bondsByIsin.get(lot.isin);
      if (!bond) continue;
      cashTransactions.push({
        id: uid(),
        accountId: lot.accountId,
        date: c.actualDate || c.scheduledDate,
        currency: bond.currency,
        amount: c.actualAmount ?? c.amountNet ?? 0,
        kind: (c.kind === "redemption" || c.kind === "coupon+redemption")
          ? "lot_redemption" : "coupon_received",
        refId: c.id,
        refType: "coupon",
        notes: "Backfill при міграції v3→v4",
        createdAt: nowIso,
      });
    }

    return {
      ...payload,
      schemaVersion: 4,
      data: { ...payload.data, cashTransactions },
    };
  },

  // v4 → v5: snapshots table added. No data transform — just bump the version
  // and carry any snapshots through so a v4 backup becomes restorable.
  4: (payload) => ({
    ...payload,
    schemaVersion: 5,
    data: { ...payload.data, snapshots: payload.data.snapshots || [] },
  }),
};

function isObject(x) { return x && typeof x === "object" && !Array.isArray(x); }

function validateString(s, field, max = 1000) {
  if (s == null) return;
  if (typeof s !== "string") throw new Error(`Поле ${field} має бути рядком`);
  if (s.length > max)        throw new Error(`Поле ${field} перевищує ${max} символів`);
  if (s === "__proto__" || s === "constructor" || s === "prototype") {
    throw new Error(`Заборонене значення в полі ${field}`);
  }
}

function validatePayload(payload) {
  if (!isObject(payload))       throw new Error("Бекап має бути JSON-об'єктом");
  if (!isObject(payload.data))  throw new Error("Бекап не містить поля data");
  if (typeof payload.schemaVersion !== "number") throw new Error("Бекап не містить schemaVersion");

  const arrays = ["persons", "brokers", "accounts", "bondReferences", "lots", "couponPayments", "cashTransactions", "snapshots", "owners"];
  for (const field of arrays) {
    const arr = payload.data[field];
    if (arr != null && !Array.isArray(arr)) {
      throw new Error(`Поле data.${field} має бути масивом`);
    }
  }

  for (const p of payload.data.persons  || []) { validateString(p.id, "person.id"); validateString(p.name, "person.name", 200); }
  for (const a of payload.data.accounts || []) { validateString(a.id, "account.id"); validateString(a.name, "account.name", 200); }
  for (const b of payload.data.bondReferences || []) { validateString(b.isin, "bond.isin", 16); }
  for (const l of payload.data.lots || []) {
    validateString(l.id, "lot.id");
    if (l.quantity != null && (!Number.isFinite(Number(l.quantity)) || l.quantity < 0)) {
      throw new Error("lot.quantity має бути невід'ємним числом");
    }
  }
  for (const t of payload.data.cashTransactions || []) {
    validateString(t.id, "tx.id");
    if (t.amount != null && !Number.isFinite(Number(t.amount))) throw new Error("tx.amount має бути числом");
  }
}

export function migrateBackup(payload) {
  validatePayload(payload);

  let current = payload;
  if (current.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Бекап версії ${current.schemaVersion} новіший за поточну схему ${SCHEMA_VERSION}. ` +
      `Оновіть додаток.`
    );
  }

  while (current.schemaVersion < SCHEMA_VERSION) {
    const migration = MIGRATIONS[current.schemaVersion];
    if (!migration) throw new Error(`Немає міграції з версії ${current.schemaVersion}`);
    current = migration(current);
    validatePayload(current);
  }

  return current;
}
