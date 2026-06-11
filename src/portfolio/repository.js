import { db, SCHEMA_VERSION } from "./db.js";
import { generateCouponSchedule, lotInvested } from "./calculations.js";

// ── Utils ───────────────────────────────────────────────────────────────────

function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function isoDate(d) {
  if (!d) return null;
  if (typeof d === "string") return d;
  return new Date(d).toISOString();
}

function couponPaymentDoc(lotId, p) {
  return {
    id: uid(),
    lotId,
    scheduledDate: isoDate(p.scheduledDate),
    amountGross: Number(p.amountGross) || 0,
    amountNet:   Number(p.amountNet)   || 0,
    kind: p.kind || "coupon",
    status: p.status || "scheduled",
    actualDate: p.actualDate ? isoDate(p.actualDate) : null,
    actualAmount: p.actualAmount != null ? Number(p.actualAmount) : null,
  };
}

// ── Brokers ─────────────────────────────────────────────────────────────────

export const brokers = {
  list: () => db.brokers.orderBy("name").toArray(),
  get:  (id) => db.brokers.get(id),

  async add({ name, color = "#c9a96a", emoji = "🏦" }) {
    if (!name?.trim()) throw new Error("Назва брокера обов'язкова");
    const id = uid();
    const broker = { id, name: name.trim(), color, emoji, createdAt: now() };
    await db.brokers.add(broker);
    return broker;
  },

  async update(id, patch) {
    const existing = await db.brokers.get(id);
    if (!existing) throw new Error("Брокера не знайдено");
    const updated = { ...existing, ...patch };
    await db.brokers.put(updated);
    return updated;
  },

  async remove(id) {
    const accountCount = await db.accounts.where("brokerId").equals(id).count();
    if (accountCount > 0) {
      throw new Error(`Не можна видалити: у брокера ${accountCount} рахунок(ів).`);
    }
    await db.brokers.delete(id);
  },
};

export async function seedDefaultBrokers() {
  const count = await db.brokers.count();
  if (count > 0) return false;
  await db.brokers.bulkAdd([
    { id: "broker_icu",    name: "ICU",      color: "#c9a96a", emoji: "🏛", createdAt: now() },
    { id: "broker_mono",   name: "Monobank", color: "#000000", emoji: "🖤", createdAt: now() },
    { id: "broker_sense",  name: "Sense",    color: "#8fae7a", emoji: "🌿", createdAt: now() },
    { id: "broker_privat", name: "Приват",   color: "#6f86c4", emoji: "💚", createdAt: now() },
  ]);
  return true;
}

// ── Persons ─────────────────────────────────────────────────────────────────

export const persons = {
  list: () => db.persons.orderBy("name").toArray(),
  get:  (id) => db.persons.get(id),

  async add({ name, type = "child", birthDate = null, color = "#a78bfa", emoji = "👤", targetAmount = null, targetCurrency = "UAH" }) {
    if (!name?.trim()) throw new Error("Ім'я обов'язкове");
    const id = uid();
    const person = {
      id, name: name.trim(), type,
      birthDate: isoDate(birthDate),
      color, emoji,
      targetAmount: targetAmount != null ? Number(targetAmount) : null,
      targetCurrency,
      createdAt: now(),
    };
    await db.persons.add(person);
    return person;
  },

  async update(id, patch) {
    const existing = await db.persons.get(id);
    if (!existing) throw new Error("Особу не знайдено");
    const updated = { ...existing, ...patch };
    if (patch.birthDate !== undefined) updated.birthDate = isoDate(patch.birthDate);
    await db.persons.put(updated);
    return updated;
  },

  async remove(id) {
    const allAccounts = await db.accounts.toArray();
    const beneficiary = allAccounts.filter(a => (a.beneficiaryIds || []).includes(id));
    if (beneficiary.length > 0) {
      const names = beneficiary.map(a => a.name).join(", ");
      throw new Error(`Не можна видалити: особа є бенефіціаром у рахунках: ${names}`);
    }
    await db.persons.delete(id);
  },
};

// ── Accounts ────────────────────────────────────────────────────────────────

export const accounts = {
  list: () => db.accounts.orderBy("name").toArray(),
  get:  (id) => db.accounts.get(id),

  async add(data) {
    if (!data.name?.trim()) throw new Error("Назва рахунку обов'язкова");
    if (!data.brokerId) throw new Error("Брокер обов'язковий");

    const kind = data.kind || "shared";
    if (kind === "shared" && (!data.beneficiaryIds || data.beneficiaryIds.length < 2)) {
      throw new Error("Спільний рахунок потребує щонайменше 2 бенефіціарів");
    }
    if (kind === "personal" && (!data.beneficiaryIds || data.beneficiaryIds.length !== 1)) {
      throw new Error("Персональний рахунок має рівно 1 бенефіціара");
    }

    const id = data.id || uid();
    const account = {
      id,
      name: data.name.trim(),
      kind,
      brokerId: data.brokerId,
      beneficiaryIds: Array.isArray(data.beneficiaryIds) ? [...data.beneficiaryIds] : [],
      beneficiaryWeights: data.beneficiaryWeights && typeof data.beneficiaryWeights === "object"
        ? { ...data.beneficiaryWeights } : null,
      color: data.color || "#c9a96a",
      emoji: data.emoji || (kind === "shared" ? "👨‍👩‍👧" : "👤"),
      primaryCurrency: data.primaryCurrency || "UAH",
      closedAt: null,
      createdAt: data.createdAt || now(),
    };
    await db.accounts.add(account);
    return account;
  },

  async update(id, patch) {
    const existing = await db.accounts.get(id);
    if (!existing) throw new Error("Рахунок не знайдено");
    if (existing.kind === "personal" && patch.kind && patch.kind !== "personal") {
      throw new Error("Тип персонального рахунку не можна змінити");
    }
    if (patch.beneficiaryIds && existing.kind === "shared" && patch.beneficiaryIds.length < 2) {
      throw new Error("Спільний рахунок потребує щонайменше 2 бенефіціарів");
    }
    if (patch.beneficiaryIds && existing.kind === "personal" && patch.beneficiaryIds.length !== 1) {
      throw new Error("Персональний рахунок має рівно 1 бенефіціара");
    }
    const updated = { ...existing, ...patch };
    await db.accounts.put(updated);
    return updated;
  },

  async remove(id) {
    const acc = await db.accounts.get(id);
    if (!acc) throw new Error("Рахунок не знайдено");
    const lotCount = await db.lots.where("accountId").equals(id).count();
    if (lotCount > 0) {
      throw new Error(`Не можна видалити: на рахунку ${lotCount} лот(ів).`);
    }
    const txCount = await db.cashTransactions.where("accountId").equals(id).count();
    if (txCount > 0) {
      throw new Error(`Не можна видалити: рахунок має ${txCount} транзакц(ію/ій).`);
    }
    await db.accounts.delete(id);
  },
};

// ── Bond References ─────────────────────────────────────────────────────────

const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export const bonds = {
  list: () => db.bondReferences.orderBy("maturityDate").toArray(),
  get:  (isin) => db.bondReferences.get(isin),

  async add(data) {
    const isin = data.isin?.trim().toUpperCase();
    if (!isin) throw new Error("ISIN обов'язковий");
    if (isin.length !== 12) throw new Error("ISIN має бути 12 символів");
    if (!ISIN_REGEX.test(isin)) throw new Error("ISIN має формат: 2 літери країни + 9 alphanumeric + 1 цифра");

    const existing = await db.bondReferences.get(isin);
    if (existing) throw new Error(`ISIN ${isin} вже існує в довіднику`);

    const customSchedule = Array.isArray(data.customSchedule)
      ? data.customSchedule
          .filter(r => r.date && Number.isFinite(Number(r.amountPerPiece)))
          .map(r => ({
            date: isoDate(r.date),
            amountPerPiece: Number(r.amountPerPiece),
            kind: r.kind || "coupon",
          }))
      : null;

    const bond = {
      isin,
      ticker: data.ticker?.trim() || isin,
      type: data.type || "ovdp",
      currency: data.currency || "UAH",
      faceValue: Number(data.faceValue) || 1000,
      couponRate: Number(data.couponRate) || 0,
      couponFrequency: Number(data.couponFrequency) || 2,
      issueDate: isoDate(data.issueDate),
      maturityDate: isoDate(data.maturityDate),
      issuer: data.issuer?.trim() || (data.type === "corporate" ? "" : "Мінфін України"),
      notes: data.notes?.trim() || "",
      customSchedule,
      createdAt: now(),
    };
    await db.bondReferences.add(bond);
    return bond;
  },

  async update(isin, patch) {
    const existing = await db.bondReferences.get(isin);
    if (!existing) throw new Error("ISIN не знайдено");
    const updated = { ...existing, ...patch };
    if (patch.issueDate !== undefined) updated.issueDate = isoDate(patch.issueDate);
    if (patch.maturityDate !== undefined) updated.maturityDate = isoDate(patch.maturityDate);
    if (patch.customSchedule !== undefined) {
      updated.customSchedule = Array.isArray(patch.customSchedule)
        ? patch.customSchedule
            .filter(r => r.date && Number.isFinite(Number(r.amountPerPiece)))
            .map(r => ({
              date: isoDate(r.date),
              amountPerPiece: Number(r.amountPerPiece),
              kind: r.kind || "coupon",
            }))
        : null;
    }

    // Regenerate coupon schedules для всіх лотів цього ISIN — в одній транзакції
    const affectedLots = await db.lots.where("isin").equals(isin).toArray();
    await db.transaction("rw", [db.bondReferences, db.couponPayments], async () => {
      await db.bondReferences.put(updated);
      for (const lot of affectedLots) {
        const schedule = generateCouponSchedule(updated, lot);
        await db.couponPayments.where("lotId").equals(lot.id).delete();
        if (schedule.length) {
          await db.couponPayments.bulkAdd(schedule.map(p => couponPaymentDoc(lot.id, p)));
        }
      }
    });
    return updated;
  },

  async remove(isin) {
    const lotCount = await db.lots.where("isin").equals(isin).count();
    if (lotCount > 0) {
      throw new Error(`Не можна видалити ISIN: є ${lotCount} лот(ів) з цим ISIN.`);
    }
    await db.bondReferences.delete(isin);
  },
};

// ── Cash Transactions ──────────────────────────────────────────────────────

export const CASH_KINDS = {
  deposit:         { label: "Поповнення",        sign: +1 },
  withdrawal:      { label: "Зняття",            sign: -1 },
  lot_purchase:    { label: "Купівля облігації", sign: -1 },
  lot_redemption:  { label: "Погашення",         sign: +1 },
  coupon_received: { label: "Купон",             sign: +1 },
  transfer_out:    { label: "Переказ (вихід)",   sign: -1 },
  transfer_in:     { label: "Переказ (вхід)",    sign: +1 },
  fee:             { label: "Комісія",           sign: -1 },
  manual:          { label: "Корекція",          sign:  0 },
};

export const transactions = {
  async list({ accountId, kind, currency, from, to, refId, refType } = {}) {
    let q = accountId
      ? db.cashTransactions.where("accountId").equals(accountId)
      : db.cashTransactions.orderBy("date");
    let all = await q.toArray();

    if (kind)      all = all.filter(t => t.kind === kind);
    if (currency)  all = all.filter(t => t.currency === currency);
    if (from)      all = all.filter(t => t.date >= isoDate(from));
    if (to)        all = all.filter(t => t.date <= isoDate(to));
    if (refId)     all = all.filter(t => t.refId === refId);
    if (refType)   all = all.filter(t => t.refType === refType);

    return all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },

  get: (id) => db.cashTransactions.get(id),

  async balanceByCurrency(accountId, asOf = null) {
    let all;
    if (accountId) {
      all = await db.cashTransactions.where("accountId").equals(accountId).toArray();
    } else {
      all = await db.cashTransactions.toArray();
    }
    if (asOf) {
      const asOfIso = isoDate(asOf);
      all = all.filter(t => t.date <= asOfIso);
    }
    const result = {};
    for (const t of all) {
      const cur = t.currency || "UAH";
      result[cur] = (result[cur] || 0) + (Number(t.amount) || 0);
    }
    return result;
  },

  async deposit({ accountId, amount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    return await transactions._addRaw({
      accountId, date, currency: currency || acc.primaryCurrency,
      amount: amt, kind: "deposit", notes,
    });
  },

  async withdraw({ accountId, amount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    return await transactions._addRaw({
      accountId, date, currency: currency || acc.primaryCurrency,
      amount: -amt, kind: "withdrawal", notes,
    });
  },

  async transfer({ fromAccountId, toAccountId, amount, currency, date, notes }) {
    if (!fromAccountId || !toAccountId) throw new Error("Обидва рахунки обов'язкові");
    if (fromAccountId === toAccountId)   throw new Error("Рахунки мають бути різні");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");

    const [fromAcc, toAcc] = await Promise.all([
      db.accounts.get(fromAccountId), db.accounts.get(toAccountId)
    ]);
    if (!fromAcc) throw new Error("Рахунок-джерело не знайдено");
    if (!toAcc)   throw new Error("Рахунок-отримувач не знайдено");

    const curr = currency || fromAcc.primaryCurrency || "UAH";
    const dateIso = isoDate(date) || now();
    const outId = uid();
    const inId = uid();

    await db.transaction("rw", db.cashTransactions, async () => {
      await db.cashTransactions.bulkAdd([
        {
          id: outId, accountId: fromAccountId, date: dateIso, currency: curr,
          amount: -amt, kind: "transfer_out",
          counterTxId: inId, counterAccountId: toAccountId,
          notes: notes || `→ ${toAcc.name}`, createdAt: now(),
        },
        {
          id: inId, accountId: toAccountId, date: dateIso, currency: curr,
          amount: +amt, kind: "transfer_in",
          counterTxId: outId, counterAccountId: fromAccountId,
          notes: notes || `← ${fromAcc.name}`, createdAt: now(),
        },
      ]);
    });

    return { outId, inId };
  },

  async _addRaw(data) {
    const tx = {
      id: data.id || uid(),
      accountId: data.accountId,
      date: isoDate(data.date) || now(),
      currency: data.currency || "UAH",
      amount: Number(data.amount) || 0,
      kind: data.kind,
      refId: data.refId || null,
      refType: data.refType || null,
      counterTxId: data.counterTxId || null,
      counterAccountId: data.counterAccountId || null,
      notes: data.notes || "",
      createdAt: now(),
    };
    await db.cashTransactions.add(tx);
    return tx;
  },

  async remove(id) {
    const tx = await db.cashTransactions.get(id);
    if (!tx) return;
    // Для transfer — видалити обидві сторони
    if (tx.counterTxId) {
      await db.transaction("rw", db.cashTransactions, async () => {
        await db.cashTransactions.delete(tx.id);
        await db.cashTransactions.delete(tx.counterTxId);
      });
    } else {
      await db.cashTransactions.delete(id);
    }
  },
};

// ── Lots (with auto cash transactions) ─────────────────────────────────────

function validateLotPayload(data, { partial = false } = {}) {
  if (!partial || data.quantity !== undefined) {
    const q = Number(data.quantity);
    if (!Number.isFinite(q) || q <= 0) throw new Error("Кількість має бути > 0");
    if (q !== Math.floor(q))             throw new Error("Кількість має бути цілим числом");
  }
  if (!partial || data.purchasePrice !== undefined) {
    const p = Number(data.purchasePrice);
    if (!Number.isFinite(p) || p < 0) throw new Error("Ціна не може бути від'ємною");
  }
  if (data.accruedInterestPerPiece !== undefined) {
    const a = Number(data.accruedInterestPerPiece);
    if (!Number.isFinite(a) || a < 0) throw new Error("НКД не може бути від'ємним");
  }
}

function buildLotPurchaseTx(lot, bond) {
  return {
    id: uid(),
    accountId: lot.accountId,
    date: lot.purchaseDate,
    currency: bond.currency,
    amount: -lotInvested(lot),
    kind: "lot_purchase",
    refId: lot.id,
    refType: "lot",
    notes: `Купівля ${lot.quantity} × ${bond.ticker || lot.isin}`,
    createdAt: now(),
  };
}

export const lots = {
  async list({ accountId, isin } = {}) {
    let q;
    if (accountId)      q = db.lots.where("accountId").equals(accountId);
    else if (isin)      q = db.lots.where("isin").equals(isin);
    else                q = db.lots.orderBy("purchaseDate");
    const all = await q.toArray();
    if (accountId && isin) return all.filter(l => l.isin === isin);
    return all.sort((a, b) => (a.purchaseDate || "").localeCompare(b.purchaseDate || ""));
  },

  get: (id) => db.lots.get(id),

  async add(data) {
    if (!data.isin)      throw new Error("ISIN обов'язковий");
    if (!data.accountId) throw new Error("Рахунок обов'язковий");
    validateLotPayload(data);

    const bond = await db.bondReferences.get(data.isin);
    if (!bond) throw new Error(`ISIN ${data.isin} не знайдено в довіднику.`);
    const acc = await db.accounts.get(data.accountId);
    if (!acc) throw new Error("Рахунок не знайдено");

    const qty = Math.floor(Number(data.quantity));
    let accruedPerPiece;
    if (data.accruedInterestPerPiece != null) {
      accruedPerPiece = Number(data.accruedInterestPerPiece);
    } else if (data.accruedInterestPaid != null && qty > 0) {
      accruedPerPiece = Number(data.accruedInterestPaid) / qty;
    } else {
      accruedPerPiece = 0;
    }

    const lot = {
      id: uid(),
      isin: data.isin,
      accountId: data.accountId,
      purchaseDate: isoDate(data.purchaseDate) || now(),
      quantity: qty,
      purchasePrice: Number(data.purchasePrice) || bond.faceValue,
      accruedInterestPerPiece: accruedPerPiece,
      commission: Number(data.commission) || 0,
      notes: data.notes?.trim() || "",
      createdAt: now(),
    };

    await db.transaction("rw", [db.lots, db.cashTransactions, db.couponPayments], async () => {
      await db.lots.add(lot);
      const purchaseTx = buildLotPurchaseTx(lot, bond);
      await db.cashTransactions.add(purchaseTx);

      // Generate coupon schedule
      const schedule = generateCouponSchedule(bond, lot);
      if (schedule.length) {
        await db.couponPayments.bulkAdd(schedule.map(p => couponPaymentDoc(lot.id, p)));
      }
    });

    return lot;
  },

  async update(id, patch) {
    const existing = await db.lots.get(id);
    if (!existing) throw new Error("Лот не знайдено");
    validateLotPayload(patch, { partial: true });

    if (patch.isin && patch.isin !== existing.isin) {
      const b = await db.bondReferences.get(patch.isin);
      if (!b) throw new Error(`ISIN ${patch.isin} не знайдено в довіднику.`);
    }
    if (patch.accountId && patch.accountId !== existing.accountId) {
      const acc = await db.accounts.get(patch.accountId);
      if (!acc) throw new Error("Рахунок не знайдено");
    }

    const updated = { ...existing, ...patch };
    if (patch.purchaseDate !== undefined) updated.purchaseDate = isoDate(patch.purchaseDate);
    if (patch.quantity !== undefined)     updated.quantity = Math.floor(Number(patch.quantity));

    const bond = await db.bondReferences.get(updated.isin);

    await db.transaction("rw", [db.lots, db.cashTransactions, db.couponPayments], async () => {
      await db.lots.put(updated);

      // Update or recreate lot_purchase transaction
      if (bond) {
        const existingTxs = await db.cashTransactions
          .where("[refId+refType]").equals([id, "lot"]).toArray();
        const newTx = buildLotPurchaseTx(updated, bond);
        if (existingTxs.length) {
          // Update the first one, delete extras
          await db.cashTransactions.put({ ...existingTxs[0], ...newTx, id: existingTxs[0].id });
          for (let i = 1; i < existingTxs.length; i++) {
            await db.cashTransactions.delete(existingTxs[i].id);
          }
        } else {
          await db.cashTransactions.add(newTx);
        }

        // Regenerate coupon schedule
        await db.couponPayments.where("lotId").equals(id).delete();
        const schedule = generateCouponSchedule(bond, updated);
        if (schedule.length) {
          await db.couponPayments.bulkAdd(schedule.map(p => couponPaymentDoc(id, p)));
        }
      }
    });

    return updated;
  },

  async remove(id) {
    await db.transaction("rw", [db.lots, db.couponPayments, db.cashTransactions], async () => {
      // Collect this lot's coupons BEFORE deleting them so we can also remove
      // their derived cash transactions (refType "coupon", refId = coupon id).
      const lotCoupons = await db.couponPayments.where("lotId").equals(id).toArray();
      await db.couponPayments.where("lotId").equals(id).delete();

      // Remove lot_purchase / redemption tx (refType "lot") for this lot...
      const txs = await db.cashTransactions.where("refId").equals(id).toArray();
      for (const t of txs) {
        if (t.refType === "lot") await db.cashTransactions.delete(t.id);
      }
      // ...and the coupon-derived tx (refType "coupon") so no phantom cash
      // inflow is left behind overstating the account balance after deletion.
      for (const c of lotCoupons) {
        const ctxs = await db.cashTransactions.where("[refId+refType]").equals([c.id, "coupon"]).toArray();
        for (const t of ctxs) await db.cashTransactions.delete(t.id);
      }
      await db.lots.delete(id);
    });
  },

  async split({ lotId, quantityForNew, newAccountId, notes }) {
    const qNew = Math.floor(Number(quantityForNew));
    if (!Number.isFinite(qNew) || qNew <= 0) throw new Error("Кількість має бути > 0");

    const old = await db.lots.get(lotId);
    if (!old) throw new Error("Лот не знайдено");
    if (qNew >= old.quantity) throw new Error("Не можна винести всі або більше штук");
    if (!newAccountId) throw new Error("Цільовий рахунок обов'язковий");
    if (newAccountId === old.accountId) throw new Error("Новий рахунок має бути іншим");

    const newAcc = await db.accounts.get(newAccountId);
    if (!newAcc) throw new Error("Цільовий рахунок не знайдено");
    const bond = await db.bondReferences.get(old.isin);
    if (!bond) throw new Error("Облігація не знайдена в довіднику");

    return await db.transaction("rw", [db.lots, db.couponPayments, db.cashTransactions], async () => {
      const remaining = old.quantity - qNew;
      const newLot = {
        id: uid(),
        isin: old.isin,
        accountId: newAccountId,
        purchaseDate: old.purchaseDate,
        quantity: qNew,
        purchasePrice: old.purchasePrice,
        accruedInterestPerPiece: Number(old.accruedInterestPerPiece) || 0,
        commission: 0,
        notes: notes || `Виділено з лоту ${old.id.slice(0, 8)}`,
        createdAt: now(),
      };
      const oldUpdated = { ...old, quantity: remaining };

      await db.lots.add(newLot);
      await db.lots.put(oldUpdated);

      // Cash transactions: split не міняє баланси готівки — це переміщення власності,
      // а не нова покупка. Оригінальна purchase транзакція стара лот не зачіпається.
      // Створимо новий lot_purchase для новoгo лоту з сумою 0 і поміткою — щоб
      // лот мав свою trace-tx (для refType=lot lookup при future update/remove).
      const traceTx = {
        id: uid(),
        accountId: newAccountId,
        date: now(),
        currency: bond.currency,
        amount: 0,                          // 0 — це trace, не реальне списання
        kind: "lot_purchase",
        refId: newLot.id,
        refType: "lot",
        notes: `Виділено з лоту ${old.id.slice(0, 8)} (split, без списання)`,
        createdAt: now(),
      };
      await db.cashTransactions.add(traceTx);

      // Update old lot's purchase tx amount proportionally? Залишаємо як було —
      // інакше історія "скільки реально витратили на купівлю" втратиться.
      // У старому лоті: amount tx — повна сума оригінальної покупки за всі quantity штук.
      // Це фінансово коректно: гроші реально були витрачені колись.

      // Regenerate coupon schedules
      const newSchedule = generateCouponSchedule(bond, newLot);
      await db.couponPayments.where("lotId").equals(newLot.id).delete();
      if (newSchedule.length) {
        await db.couponPayments.bulkAdd(newSchedule.map(p => couponPaymentDoc(newLot.id, p)));
      }
      const oldSchedule = generateCouponSchedule(bond, oldUpdated);
      await db.couponPayments.where("lotId").equals(lotId).delete();
      if (oldSchedule.length) {
        await db.couponPayments.bulkAdd(oldSchedule.map(p => couponPaymentDoc(lotId, p)));
      }

      return { newLot, oldLotId: lotId, remaining };
    });
  },
};

// ── Coupon Payments (with auto cash on markReceived) ───────────────────────

export const coupons = {
  async list({ lotId, accountId, from, to, status } = {}) {
    let all = await db.couponPayments.orderBy("scheduledDate").toArray();
    if (lotId)  all = all.filter(c => c.lotId === lotId);
    if (status) all = all.filter(c => c.status === status);
    if (from)   all = all.filter(c => c.scheduledDate >= isoDate(from));
    if (to)     all = all.filter(c => c.scheduledDate <= isoDate(to));

    if (accountId) {
      const accLots = await db.lots.where("accountId").equals(accountId).toArray();
      const accLotIds = new Set(accLots.map(l => l.id));
      all = all.filter(c => accLotIds.has(c.lotId));
    }
    return all;
  },

  async replaceForLot(lotId, payments) {
    await db.transaction("rw", db.couponPayments, async () => {
      await db.couponPayments.where("lotId").equals(lotId).delete();
      if (payments?.length) {
        await db.couponPayments.bulkAdd(payments.map(p => couponPaymentDoc(lotId, p)));
      }
    });
  },

  async markReceived(id, { actualDate, actualAmount, notes } = {}) {
    const c = await db.couponPayments.get(id);
    if (!c) throw new Error("Виплату не знайдено");

    const lot = await db.lots.get(c.lotId);
    if (!lot) throw new Error("Лот не знайдено");
    const bond = await db.bondReferences.get(lot.isin);

    const amt = actualAmount != null ? Number(actualAmount) : c.amountNet;
    const date = isoDate(actualDate) || now();

    await db.transaction("rw", [db.couponPayments, db.cashTransactions], async () => {
      await db.couponPayments.put({
        ...c,
        status: "received",
        actualDate: date,
        actualAmount: amt,
      });

      // Видалити old tx якщо була (на випадок повторного marking)
      const oldTxs = await db.cashTransactions
        .where("[refId+refType]").equals([id, "coupon"]).toArray();
      for (const t of oldTxs) await db.cashTransactions.delete(t.id);

      // Створити нову tx
      if (bond) {
        const kind = c.kind === "redemption" || c.kind === "coupon+redemption"
          ? "lot_redemption"
          : "coupon_received";
        await db.cashTransactions.add({
          id: uid(),
          accountId: lot.accountId,
          date,
          currency: bond.currency,
          amount: amt,
          kind,
          refId: id,
          refType: "coupon",
          notes: notes || `${c.kind === "redemption" ? "Погашення" : "Купон"} ${lot.quantity} × ${bond.ticker || lot.isin}`,
          createdAt: now(),
        });
      }
    });
  },

  async markScheduled(id) {
    const c = await db.couponPayments.get(id);
    if (!c) throw new Error("Виплату не знайдено");
    await db.transaction("rw", [db.couponPayments, db.cashTransactions], async () => {
      await db.couponPayments.put({ ...c, status: "scheduled", actualDate: null, actualAmount: null });
      const oldTxs = await db.cashTransactions
        .where("[refId+refType]").equals([id, "coupon"]).toArray();
      for (const t of oldTxs) await db.cashTransactions.delete(t.id);
    });
  },
};

// ── Backup / Restore ────────────────────────────────────────────────────────

export const backup = {
  async exportAll() {
    const [personsData, brokersData, accountsData, bondsData, lotsData, couponsData, txData, snapshotsData] = await Promise.all([
      db.persons.toArray(),
      db.brokers.toArray(),
      db.accounts.toArray(),
      db.bondReferences.toArray(),
      db.lots.toArray(),
      db.couponPayments.toArray(),
      db.cashTransactions.toArray(),
      db.snapshots.toArray(),
    ]);
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now(),
      data: {
        persons: personsData,
        brokers: brokersData,
        accounts: accountsData,
        bondReferences: bondsData,
        lots: lotsData,
        couponPayments: couponsData,
        cashTransactions: txData,
        snapshots: snapshotsData,
      },
    };
  },

  async importAll(payload, { merge = false } = {}) {
    if (!payload?.data) throw new Error("Невалідний файл бекапу");
    const { migrateBackup } = await import("./migrations.js");
    const migrated = migrateBackup(payload);
    const { persons: p, brokers: br, accounts: a, bondReferences: b, lots: l, couponPayments: c, cashTransactions: t, snapshots: s } = migrated.data;

    await db.transaction("rw",
      [db.persons, db.brokers, db.accounts, db.bondReferences, db.lots, db.couponPayments, db.cashTransactions, db.snapshots],
      async () => {
        if (!merge) {
          await Promise.all([
            db.persons.clear(), db.brokers.clear(), db.accounts.clear(),
            db.bondReferences.clear(), db.lots.clear(),
            db.couponPayments.clear(), db.cashTransactions.clear(), db.snapshots.clear(),
          ]);
        }
        if (p?.length)  await db.persons.bulkPut(p);
        if (br?.length) await db.brokers.bulkPut(br);
        if (a?.length)  await db.accounts.bulkPut(a);
        if (b?.length)  await db.bondReferences.bulkPut(b);
        if (l?.length)  await db.lots.bulkPut(l);
        if (c?.length)  await db.couponPayments.bulkPut(c);
        if (t?.length)  await db.cashTransactions.bulkPut(t);
        if (s?.length)  await db.snapshots.bulkPut(s);
      });
  },
};

// ── Snapshots (equity curve) ───────────────────────────────────────────────

import { lotCurrentValue } from "./calculations.js";

export const snapshots = {
  list: () => db.snapshots.orderBy("date").toArray(),
  get:  (date) => db.snapshots.get(date),

  async takeNow() {
    const [lotsArr, bondsArr, txsArr] = await Promise.all([
      db.lots.toArray(),
      db.bondReferences.toArray(),
      db.cashTransactions.toArray(),
    ]);
    const bondsByIsin = new Map(bondsArr.map(b => [b.isin, b]));
    const nowIso = new Date().toISOString();
    const totals = {};
    const assetsByCurrency = {};
    const cashByCurrency = {};

    for (const lot of lotsArr) {
      const bond = bondsByIsin.get(lot.isin);
      if (!bond) continue;
      const value = lotCurrentValue(bond, lot, nowIso);
      const cur = bond.currency || "UAH";
      assetsByCurrency[cur] = (assetsByCurrency[cur] || 0) + value;
      totals[cur] = (totals[cur] || 0) + value;
    }
    for (const tx of txsArr) {
      const cur = tx.currency || "UAH";
      cashByCurrency[cur] = (cashByCurrency[cur] || 0) + (Number(tx.amount) || 0);
      totals[cur] = (totals[cur] || 0) + (Number(tx.amount) || 0);
    }

    const date = nowIso.slice(0, 10);
    await db.snapshots.put({
      date, totals, assetsByCurrency, cashByCurrency,
      createdAt: nowIso,
    });
    return { date, totals };
  },

  async takeIfStale() {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await db.snapshots.get(today);
    if (existing) return null;
    return await snapshots.takeNow();
  },

  async remove(date) {
    await db.snapshots.delete(date);
  },
};

// ── Demo / Sample Portfolio ────────────────────────────────────────────────

export const demo = {
  async loadSamplePortfolio() {
    // Ensure brokers are seeded
    await seedDefaultBrokers();

    // Sample bonds (з реальних скрінів Monobank ICU)
    const sampleBonds = [
      {
        isin: "UA4000234215", ticker: "ОВДП-2026-06",
        type: "ovdp", currency: "UAH", faceValue: 1000,
        couponRate: 15.10, couponFrequency: 0,  // bullet (1 виплата)
        issueDate: "2025-06-24", maturityDate: "2026-06-24",
        issuer: "Мінфін України",
        notes: "Демо ОВДП — короткострокова",
      },
      {
        isin: "UA4000238992", ticker: "ОВДП-2029-04",
        type: "ovdp", currency: "UAH", faceValue: 1000,
        couponRate: 16.20, couponFrequency: 2,
        issueDate: "2026-04-25", maturityDate: "2029-04-25",
        issuer: "Мінфін України",
        notes: "Демо ОВДП — на 3 роки",
      },
    ];
    for (const b of sampleBonds) {
      if (!(await db.bondReferences.get(b.isin))) {
        await bonds.add(b);
      }
    }

    // Spільний рахунок на ICU
    const sharedAccountId = "demo_shared";
    if (!(await db.accounts.get(sharedAccountId))) {
      await accounts.add({
        id: sharedAccountId,
        name: "Доньки разом (демо)",
        kind: "shared",
        brokerId: "broker_icu",
        beneficiaryIds: ["child1", "child2"],
        primaryCurrency: "UAH",
        color: "#c9a96a",
        emoji: "👨‍👩‍👧",
      });
    }

    // Tato personal account on Monobank
    const tatoAccountId = "demo_tato";
    if (!(await db.accounts.get(tatoAccountId))) {
      await accounts.add({
        id: tatoAccountId,
        name: "Тато Monobank (демо)",
        kind: "personal",
        brokerId: "broker_mono",
        beneficiaryIds: ["me"],
        primaryCurrency: "UAH",
        color: "#000000",
        emoji: "🖤",
      });
    }

    // Deposits
    await transactions.deposit({ accountId: sharedAccountId, amount: 50000, currency: "UAH", date: "2026-03-15", notes: "Стартове поповнення (демо)" });
    await transactions.deposit({ accountId: tatoAccountId,   amount: 30000, currency: "UAH", date: "2026-03-20", notes: "Стартове поповнення (демо)" });

    // Lots
    await lots.add({
      isin: "UA4000234215", accountId: sharedAccountId,
      quantity: 10, purchasePrice: 1000, accruedInterestPerPiece: 30,
      purchaseDate: "2026-04-01",
      notes: "Демо-лот",
    });
    await lots.add({
      isin: "UA4000238992", accountId: sharedAccountId,
      quantity: 15, purchasePrice: 1000, accruedInterestPerPiece: 5,
      purchaseDate: "2026-05-01",
      notes: "Демо-лот",
    });
    await lots.add({
      isin: "UA4000238992", accountId: tatoAccountId,
      quantity: 20, purchasePrice: 1000, accruedInterestPerPiece: 5,
      purchaseDate: "2026-05-01",
      notes: "Демо-лот",
    });

    return true;
  },

  async clearAll() {
    await db.transaction("rw",
      [db.persons, db.brokers, db.accounts, db.bondReferences, db.lots, db.couponPayments, db.cashTransactions],
      async () => {
        await db.cashTransactions.clear();
        await db.couponPayments.clear();
        await db.lots.clear();
        await db.bondReferences.clear();
        await db.accounts.clear();
        await db.persons.clear();
        await db.brokers.clear();
      });
    localStorage.removeItem("df_portfolio_seeded_v2");
    localStorage.removeItem("df_last_backup_at");
  },
};

// ── Seed Defaults ───────────────────────────────────────────────────────────

export async function seedDefaultsIfEmpty() {
  await seedDefaultBrokers();
  const personCount = await db.persons.count();
  if (personCount > 0) return false;

  const seedPersons = [
    { id: "me",     name: "Тато",     type: "parent", birthDate: null, color: "#c9a96a", emoji: "👨" },
    { id: "child1", name: "Донька 1", type: "child",  birthDate: null, color: "#8fae7a", emoji: "👧" },
    { id: "child2", name: "Донька 2", type: "child",  birthDate: null, color: "#6f86c4", emoji: "👧" },
  ];
  await db.persons.bulkAdd(seedPersons.map(p => ({ ...p, createdAt: now() })));
  return true;
}
