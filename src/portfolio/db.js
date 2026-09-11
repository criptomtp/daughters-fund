import Dexie from "dexie";

const SCHEMA_VERSION = 7;

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

    // v6 — закриття лоту. Без нього погашений папір лишався б у портфелі
    // назавжди: вартість рахується від номіналу, а номінал нікуди не дівається.
    this.version(6).stores({
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, purchaseDate, closedAt, [accountId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
      cashTransactions: "id, accountId, date, kind, currency, [accountId+date], [accountId+currency], [refId+refType]",
      snapshots: "date",
    }).upgrade(async tx => {
      const lots = tx.table("lots");
      for (const lot of await lots.toArray()) {
        if (lot.closedAt === undefined) await lots.put({ ...lot, closedAt: null, closedReason: null });
      }
    });

    // v7 — кишені власників. Досі власність жила на рахунку: beneficiaryIds
    // множили ВСЮ вартість рахунку на частку особи. Сказати «оці п'ять паперів
    // мої, а решта дитячі» не було чим. Тепер власник — властивість лоту й
    // касової операції, а рахунок лишається тим, чим є фізично: рахунком
    // у брокера, на якому можуть лежати гроші обох сторін.
    this.version(7).stores({
      persons:  "id, type, name",
      brokers:  "id, name",
      accounts: "id, kind, brokerId, name",
      pockets:  "id, name",
      bondReferences: "isin, type, currency, maturityDate",
      lots: "id, isin, accountId, pocketId, purchaseDate, closedAt, [accountId+isin], [pocketId+isin]",
      couponPayments: "id, lotId, scheduledDate, status, [lotId+scheduledDate]",
      cashTransactions: "id, accountId, pocketId, date, kind, currency, [accountId+date], [accountId+currency], [pocketId+date], [refId+refType]",
      snapshots: "date",
    }).upgrade(async tx => {
      if ((await tx.table("pockets").count()) > 0) return;   // повтор не псує
      const next = planPockets({
        persons: await tx.table("persons").toArray(),
        accounts: await tx.table("accounts").toArray(),
        lots: await tx.table("lots").toArray(),
        cashTransactions: await tx.table("cashTransactions").toArray(),
      });
      await tx.table("persons").bulkPut(next.persons);
      await tx.table("pockets").bulkPut(next.pockets);
      await tx.table("lots").bulkPut(next.lots);
      await tx.table("cashTransactions").bulkPut(next.cashTransactions);
    });
  }
}

/**
 * Заводить дві кишені й розносить по них усе, що вже є.
 *
 * Чиста і синхронна навмисно: тим самим кодом користуються Dexie-апгрейд
 * (асинхронний, таблиці) і міграція файлу бекапу (синхронна, масиви).
 * Якби логіка була написана двічі, два шляхи розійшлися б — і розбіжність
 * вилізла б рівно при відновленні з бекапу, тобто в найгірший момент.
 *
 * Кишеня «Я» створюється РАЗОМ з особою. Здавалося б, досить завести порожню
 * кишеню й дочекатися, поки користувач додасть себе — але в реальних даних
 * персон лише дві, обидві діти: seedDefaultsIfEmpty заповнює таблицю тільки
 * коли вона порожня, а портфель імпортували поверх. Порожня кишеня дала б
 * частку нуль і тихо ховала б усе, що в неї потрапить.
 */
export function planPockets({ persons = [], accounts = [], lots = [], cashTransactions = [] }) {
  const ts = new Date().toISOString();

  // Діти беруться з наявних рахунків у стабільному порядку — щоб ваги
  // не залежали від того, як база віддала записи цього разу.
  const childIds = [];
  for (const acc of accounts) {
    for (const id of acc.beneficiaryIds || []) {
      if (!childIds.includes(id)) childIds.push(id);
    }
  }
  for (const p of persons) {
    if (p.type === "child" && !childIds.includes(p.id)) childIds.push(p.id);
  }

  const outPersons = [...persons];
  let parent = persons.find(p => p.type === "parent");
  if (!parent) {
    parent = {
      id: "person_self", name: "Я", type: "parent",
      birthDate: null, color: "#2e4c72", emoji: "🧑", createdAt: ts,
    };
    outPersons.push(parent);
  }

  const kidsId = "pocket_kids";
  const pockets = [
    {
      id: kidsId, name: "Доньки",
      memberWeights: Object.fromEntries(childIds.map(id => [id, 1])),
      color: "#1c6b47", emoji: "👧", createdAt: ts,
    },
    {
      id: "pocket_self", name: "Я",
      memberWeights: { [parent.id]: 1 },
      color: "#2e4c72", emoji: "🧑", createdAt: ts,
    },
  ];

  // Усе, що записано досі, велося для доньок — іншої кишені не існувало.
  return {
    persons: outPersons,
    pockets,
    lots: lots.map(l => (l.pocketId ? l : { ...l, pocketId: kidsId })),
    cashTransactions: cashTransactions.map(t => (t.pocketId ? t : { ...t, pocketId: kidsId })),
  };
}

export const db = new PortfolioDB();
export { SCHEMA_VERSION };
