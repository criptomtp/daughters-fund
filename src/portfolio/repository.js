import { db, SCHEMA_VERSION } from "./db.js";
import { generateCouponSchedule, lotInvested } from "./calculations.js";
// Статичний імпорт навмисне: динамічний `await import()` створював окремий чанк,
// і на встановленому PWA зі старим service worker він не завантажувався —
// імпорт бекапу падав з «Importing a module script failed». Файл маленький,
// економія на розділенні бандла не варта такого класу помилок.
import { migrateBackup } from "./migrations.js";

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

/**
 * Кишеня — іменована група власників із вагами: «Доньки» = дві доньки порівну,
 * «Я» = одна особа. Належність до кишені живе на лоті й на касовій операції,
 * а не на рахунку: один брокерський рахунок може містити гроші обох сторін.
 */
export const pockets = {
  list: () => db.pockets.orderBy("name").toArray(),
  get:  (id) => db.pockets.get(id),

  async add({ name, memberWeights, color = "#1c6b47", emoji = "👛" }) {
    if (!name?.trim()) throw new Error("Назва кишені обов'язкова");
    const w = normalizeWeights(memberWeights);
    if (!w) throw new Error("Кишеня потребує щонайменше одного учасника з вагою > 0");
    const pocket = {
      id: uid(), name: name.trim(), memberWeights: w,
      color, emoji, createdAt: now(),
    };
    await db.pockets.add(pocket);
    return pocket;
  },

  async update(id, patch) {
    const existing = await db.pockets.get(id);
    if (!existing) throw new Error("Кишеню не знайдено");
    if (patch.memberWeights !== undefined) {
      const w = normalizeWeights(patch.memberWeights);
      if (!w) throw new Error("Кишеня потребує щонайменше одного учасника з вагою > 0");
      patch = { ...patch, memberWeights: w };
    }
    const updated = { ...existing, ...patch };
    await db.pockets.put(updated);
    return updated;
  },

  async remove(id) {
    // Порожня кишеня зробила б частку нуль, а лоти в ній — невидимими.
    // Тому видалення можливе лише коли на неї нічого не посилається.
    const [lotCount, txCount] = await Promise.all([
      db.lots.where("pocketId").equals(id).count(),
      db.cashTransactions.where("pocketId").equals(id).count(),
    ]);
    if (lotCount || txCount) {
      throw new Error(`Кишеня використовується: ${lotCount} лотів, ${txCount} операцій`);
    }
    await db.pockets.delete(id);
  },
};

function normalizeWeights(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [personId, value] of Object.entries(raw)) {
    const w = Number(value);
    if (Number.isFinite(w) && w > 0) out[personId] = w;
  }
  return Object.keys(out).length ? out : null;
}

async function requirePocket(pocketId) {
  if (!pocketId) throw new Error("Кишеня обов'язкова");
  const pocket = await db.pockets.get(pocketId);
  if (!pocket) throw new Error("Кишеню не знайдено");
  return pocket;
}

/**
 * Перевіряє, що рахунком дозволено користуватися цій кишені.
 *
 * Стосується лише НОВИХ операцій. Редагування старих записів не чіпаємо:
 * доступність — налаштування, додане пізніше, і воно не має заднім числом
 * блокувати виправлення того, що вже сталося.
 */
async function requireAccountInPocket(accountId, pocketId) {
  const acc = await db.accounts.get(accountId);
  if (!acc) throw new Error("Рахунок не знайдено");
  const allowed = acc.pocketIds || [];
  if (allowed.length && !allowed.includes(pocketId)) {
    const pocket = await db.pockets.get(pocketId);
    throw new Error(`Рахунок «${acc.name}» не доступний кишені «${pocket?.name || "—"}»`);
  }
  return acc;
}

export const accounts = {
  list: () => db.accounts.orderBy("name").toArray(),
  get:  (id) => db.accounts.get(id),

  async add(data) {
    if (!data.name?.trim()) throw new Error("Назва рахунку обов'язкова");
    if (!data.brokerId) throw new Error("Брокер обов'язковий");

    const kind = data.kind || "shared";
    // Перевірка стосується будь-якого типу, включно з біржовим: рахунок без
    // бенефіціарів дає кожному частку нуль, і його активи тихо випадають із
    // підрахунку — цифри лишаються правдоподібними, просто меншими.
    if (!data.beneficiaryIds || data.beneficiaryIds.length === 0) {
      throw new Error("Рахунок потребує щонайменше 1 бенефіціара");
    }
    if (kind === "shared" && data.beneficiaryIds.length < 2) {
      throw new Error("Спільний рахунок потребує щонайменше 2 бенефіціарів");
    }
    if (kind === "personal" && data.beneficiaryIds.length !== 1) {
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
      // Біржовий рахунок (kind "exchange") ведеться інакше: угод не пишемо,
      // тримаємо поточні залишки монет як факт і переоцінюємо за курсом.
      pocketIds: Array.isArray(data.pocketIds) ? [...data.pocketIds] : [],
      holdingsByPocket: data.holdingsByPocket && typeof data.holdingsByPocket === "object"
        ? { ...data.holdingsByPocket } : null,
      holdingsAt: data.holdingsAt || null,
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
    if (patch.beneficiaryIds && patch.beneficiaryIds.length === 0) {
      throw new Error("Рахунок потребує щонайменше 1 бенефіціара");
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

    // Перебудова розкладу для всіх лотів цього ISIN — в одній транзакції.
    //
    // Підтверджені виплати НЕ чіпаємо. Раніше тут стиралося все підряд: після
    // виправлення дати погашення купони, які вже надійшли, поверталися в стан
    // «очікується». Гроші при цьому лишалися в касі, бо касова операція живе
    // окремо — і повторне підтвердження зарахувало б їх удруге. Саме та
    // помилка, яка не падає, а тихо подвоює суму.
    const affectedLots = await db.lots.where("isin").equals(isin).toArray();
    await db.transaction("rw", [db.bondReferences, db.couponPayments], async () => {
      await db.bondReferences.put(updated);
      for (const lot of affectedLots) {
        const existingRows = await db.couponPayments.where("lotId").equals(lot.id).toArray();
        const received = existingRows.filter(c => c.status === "received");
        const keepDates = new Set(received.map(c => String(c.scheduledDate).slice(0, 10)));

        for (const c of existingRows) {
          if (c.status !== "received") await db.couponPayments.delete(c.id);
        }

        const schedule = generateCouponSchedule(updated, lot)
          .filter(p => !keepDates.has(String(p.date).slice(0, 10)));
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
  pocket_out: "Передано іншій кишені",
  pocket_in:  "Отримано від іншої кишені",
  deposit:         { label: "Поповнення",        sign: +1 },
  withdrawal:      { label: "Зняття",            sign: -1 },
  lot_purchase:    { label: "Купівля облігації", sign: -1 },
  lot_redemption:  { label: "Погашення",         sign: +1 },
  lot_sale:        { label: "Продаж",            sign: +1 },
  coupon_received: { label: "Купон",             sign: +1 },
  // Гроші не пішли з портфеля — вони перетворились на монети, вартість яких
  // рахується з залишку на біржовому рахунку. Тому це не "зняття": у дохідність
  // як відтік власника не потрапляє.
  crypto_buy:      { label: "Купівля крипти",    sign: -1 },
  transfer_out:    { label: "Переказ (вихід)",   sign: -1 },
  transfer_in:     { label: "Переказ (вхід)",    sign: +1 },
  fee:             { label: "Комісія",           sign: -1 },
  manual:          { label: "Корекція",          sign:  0 },
};

export const transactions = {
  async list({ accountId, pocketId, kind, currency, from, to, refId, refType } = {}) {
    let q = accountId
      ? db.cashTransactions.where("accountId").equals(accountId)
      : db.cashTransactions.orderBy("date");
    let all = await q.toArray();

    if (pocketId)  all = all.filter(t => t.pocketId === pocketId);
    if (kind)      all = all.filter(t => t.kind === kind);
    if (currency)  all = all.filter(t => t.currency === currency);
    if (from)      all = all.filter(t => t.date >= isoDate(from));
    if (to)        all = all.filter(t => t.date <= isoDate(to));
    if (refId)     all = all.filter(t => t.refId === refId);
    if (refType)   all = all.filter(t => t.refType === refType);

    return all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },

  get: (id) => db.cashTransactions.get(id),

  async balanceByCurrency(accountId, asOf = null, pocketId = null) {
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
    if (pocketId) all = all.filter(t => t.pocketId === pocketId);
    const result = {};
    for (const t of all) {
      const cur = t.currency || "UAH";
      result[cur] = (result[cur] || 0) + (Number(t.amount) || 0);
    }
    return result;
  },

  async deposit({ accountId, pocketId, amount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    await requirePocket(pocketId);
    await requireAccountInPocket(accountId, pocketId);
    return await transactions._addRaw({
      accountId, pocketId, date, currency: currency || acc.primaryCurrency,
      amount: amt, kind: "deposit", notes,
    });
  },

  async withdraw({ accountId, pocketId, amount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    await requirePocket(pocketId);
    await requireAccountInPocket(accountId, pocketId);
    return await transactions._addRaw({
      accountId, pocketId, date, currency: currency || acc.primaryCurrency,
      amount: -amt, kind: "withdrawal", notes,
    });
  },

  /**
   * Купівля крипти на біржовому рахунку: гривня списується, монети додаються
   * до залишку. Це не «зняття» — гроші не виходять із фонду, вони змінюють
   * форму, тому окремий вид операції, який не рахується як відтік власника.
   */
  async cryptoBuy({ accountId, pocketId, amount, ticker, coinAmount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    if (acc.kind !== "exchange") throw new Error("Це не біржовий рахунок");

    const amt = Math.abs(Number(amount)) || 0;
    const coins = Number(coinAmount) || 0;
    if (amt <= 0 && coins <= 0) throw new Error("Вкажи суму або кількість монет");
    const t = String(ticker || "").toUpperCase();
    if (coins > 0 && !t) throw new Error("Вибери монету");
    // Кишеня обов'язкова і тут: воронка одна для всіх операцій. Те, що крипта
    // повністю дитяча — рішення інтерфейсу, а не сховища.
    await requirePocket(pocketId);
    await requireAccountInPocket(accountId, pocketId);

    await db.transaction("rw", [db.cashTransactions, db.accounts], async () => {
      if (amt > 0) {
        const tx = await transactions._addRaw({
          accountId, pocketId, date, currency: currency || acc.primaryCurrency,
          amount: -amt, kind: "crypto_buy",
          notes: notes || (coins > 0 ? `Куплено ${coins} ${t}` : "Купівля крипти"),
        });
        // Кількість монет зберігаємо прямо в транзакції — тоді історія
        // відновлюється точно, а не оцінкою за ціною дня.
        if (coins > 0 && tx?.id) {
          const saved = await db.cashTransactions.get(tx.id);
          if (saved) await db.cashTransactions.put({ ...saved, coinTicker: t, coinAmount: coins });
        }
      }
      if (coins > 0) {
        const fresh = await db.accounts.get(accountId);
        // Монети лягають у кишеню того, хто платив. Раніше вони просто
        // додавались до спільного числа на рахунку, і власника доводилось
        // відновлювати пропорцією витрат — здогадкою, яка помиляється, коли
        // сторони заходили за різною ціною.
        const byPocket = { ...(fresh.holdingsByPocket || {}) };
        const mine = { ...(byPocket[pocketId] || {}) };
        // Округлюємо до 8 знаків — точність сатоші, далі йде шум float
        mine[t] = Math.round(((Number(mine[t]) || 0) + coins) * 1e8) / 1e8;
        byPocket[pocketId] = mine;
        await db.accounts.put({ ...fresh, holdingsByPocket: byPocket, holdingsAt: isoDate(date) || now() });
      }
    });
  },

  async transfer({ fromAccountId, toAccountId, pocketId, amount, currency, date, notes }) {
    if (!fromAccountId || !toAccountId) throw new Error("Обидва рахунки обов'язкові");
    if (fromAccountId === toAccountId)   throw new Error("Рахунки мають бути різні");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");

    const [fromAcc, toAcc] = await Promise.all([
      db.accounts.get(fromAccountId), db.accounts.get(toAccountId)
    ]);
    if (!fromAcc) throw new Error("Рахунок-джерело не знайдено");
    if (!toAcc)   throw new Error("Рахунок-отримувач не знайдено");
    await requirePocket(pocketId);

    const curr = currency || fromAcc.primaryCurrency || "UAH";
    const dateIso = isoDate(date) || now();
    const outId = uid();
    const inId = uid();

    await db.transaction("rw", db.cashTransactions, async () => {
      await db.cashTransactions.bulkAdd([
        {
          id: outId, accountId: fromAccountId, pocketId, date: dateIso, currency: curr,
          amount: -amt, kind: "transfer_out",
          counterTxId: inId, counterAccountId: toAccountId,
          notes: notes || `→ ${toAcc.name}`, createdAt: now(),
        },
        {
          id: inId, accountId: toAccountId, pocketId, date: dateIso, currency: curr,
          amount: +amt, kind: "transfer_in",
          counterTxId: outId, counterAccountId: fromAccountId,
          notes: notes || `← ${fromAcc.name}`, createdAt: now(),
        },
      ]);
    });

    return { outId, inId };
  },

  /**
   * Переказ між кишенями в межах одного рахунку.
   *
   * Гроші нікуди не йдуть — змінюється лише те, чиї вони. Потрібно щоразу,
   * коли дитячий купон іде на батьківський папір або навпаки: без цього
   * залишок кишені, з якої платили, піде в мінус.
   */
  async pocketTransfer({ accountId, fromPocketId, toPocketId, amount, currency, date, notes }) {
    if (!accountId) throw new Error("Рахунок обов'язковий");
    if (fromPocketId === toPocketId) throw new Error("Кишені мають бути різні");
    const amt = Math.abs(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Сума має бути > 0");

    const acc = await db.accounts.get(accountId);
    if (!acc) throw new Error("Рахунок не знайдено");
    const [from, to] = await Promise.all([
      requirePocket(fromPocketId), requirePocket(toPocketId),
    ]);

    const curr = currency || acc.primaryCurrency || "UAH";
    const dateIso = isoDate(date) || now();
    const outId = uid();
    const inId = uid();

    await db.transaction("rw", db.cashTransactions, async () => {
      await db.cashTransactions.bulkAdd([
        {
          id: outId, accountId, pocketId: fromPocketId, date: dateIso, currency: curr,
          amount: -amt, kind: "pocket_out",
          counterTxId: inId, counterAccountId: accountId,
          notes: notes || `→ ${to.name}`, createdAt: now(),
        },
        {
          id: inId, accountId, pocketId: toPocketId, date: dateIso, currency: curr,
          amount: +amt, kind: "pocket_in",
          counterTxId: outId, counterAccountId: accountId,
          notes: notes || `← ${from.name}`, createdAt: now(),
        },
      ]);
    });

    return { outId, inId };
  },

  async _addRaw(data) {
    const tx = {
      id: data.id || uid(),
      accountId: data.accountId,
      pocketId: data.pocketId || null,
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
    pocketId: lot.pocketId,
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
  async list({ accountId, isin, pocketId } = {}) {
    let q;
    if (accountId)      q = db.lots.where("accountId").equals(accountId);
    else if (pocketId)  q = db.lots.where("pocketId").equals(pocketId);
    else if (isin)      q = db.lots.where("isin").equals(isin);
    else                q = db.lots.orderBy("purchaseDate");
    let all = await q.toArray();
    if (pocketId) all = all.filter(l => l.pocketId === pocketId);
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
    await requirePocket(data.pocketId);
    await requireAccountInPocket(data.accountId, data.pocketId);

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
      pocketId: data.pocketId,
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

  /**
   * Продаж лоту до погашення. Закриває позицію, зараховує виручку готівкою
   * і знімає з розкладу всі майбутні виплати по ньому — папера більше немає,
   * купони по ньому не прийдуть.
   */
  async sell(id, { date, amount, accountId, notes } = {}) {
    const lot = await db.lots.get(id);
    if (!lot) throw new Error("Лот не знайдено");
    if (lot.closedAt) throw new Error("Лот уже закритий");
    const proceeds = Math.abs(Number(amount));
    if (!Number.isFinite(proceeds) || proceeds <= 0) throw new Error("Сума продажу має бути > 0");
    const bond = await db.bondReferences.get(lot.isin);
    const when = isoDate(date) || now();

    await db.transaction("rw", [db.lots, db.cashTransactions, db.couponPayments], async () => {
      await db.lots.put({ ...lot, closedAt: when, closedReason: "sale" });
      await db.cashTransactions.add({
        id: uid(),
        accountId: accountId || lot.accountId,
        pocketId: lot.pocketId,
        date: when,
        currency: bond?.currency || "UAH",
        amount: proceeds,
        kind: "lot_sale",
        refId: lot.id,
        refType: "lot",
        notes: notes || `Продаж ${lot.quantity} × ${bond?.ticker || lot.isin}`,
        createdAt: now(),
      });
      // Заплановані виплати після дати продажу більше не наші
      const future = await db.couponPayments.where("lotId").equals(lot.id).toArray();
      for (const c of future) {
        if (c.status !== "received" && String(c.scheduledDate).slice(0, 10) > String(when).slice(0, 10)) {
          await db.couponPayments.delete(c.id);
        }
      }
    });
    return { closedAt: when, proceeds };
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

  /**
   * Виділяє частину штук в окремий лот — на інший рахунок, в іншу кишеню
   * або і те, і те.
   *
   * Поділ у межах ОДНОГО рахунку — основний випадок кишень: папір куплено
   * частково за свої гроші, частково за дитячі. Раніше це було заборонено
   * (вимагався інший рахунок), тож єдиний спосіб розділити власність не
   * працював.
   */
  async split({ lotId, quantityForNew, newAccountId, newPocketId, notes }) {
    const qNew = Math.floor(Number(quantityForNew));
    if (!Number.isFinite(qNew) || qNew <= 0) throw new Error("Кількість має бути > 0");

    const old = await db.lots.get(lotId);
    if (!old) throw new Error("Лот не знайдено");
    if (qNew >= old.quantity) throw new Error("Не можна винести всі або більше штук");

    const targetAccountId = newAccountId || old.accountId;
    const targetPocketId  = newPocketId  || old.pocketId;
    if (targetAccountId === old.accountId && targetPocketId === old.pocketId) {
      throw new Error("Має змінитися рахунок або кишеня — інакше ділити нема сенсу");
    }

    const newAcc = await db.accounts.get(targetAccountId);
    if (!newAcc) throw new Error("Цільовий рахунок не знайдено");
    await requirePocket(targetPocketId);
    const bond = await db.bondReferences.get(old.isin);
    if (!bond) throw new Error("Облігація не знайдена в довіднику");

    return await db.transaction("rw", [db.lots, db.couponPayments, db.cashTransactions], async () => {
      const remaining = old.quantity - qNew;
      const oldCommission = Number(old.commission) || 0;
      // Комісія теж ділиться — інакше сума двох половин не дорівнює цілому,
      // і баланс рахунку поїде рівно на розбіжність.
      const newCommission = Math.round(oldCommission * qNew / old.quantity * 100) / 100;

      const newLot = {
        id: uid(),
        isin: old.isin,
        accountId: targetAccountId,
        pocketId: targetPocketId,
        purchaseDate: old.purchaseDate,
        quantity: qNew,
        purchasePrice: old.purchasePrice,
        accruedInterestPerPiece: Number(old.accruedInterestPerPiece) || 0,
        commission: newCommission,
        closedAt: null,
        closedReason: null,
        notes: notes || `Виділено з лоту ${old.id.slice(0, 8)}`,
        createdAt: now(),
      };
      const oldUpdated = { ...old, quantity: remaining, commission: oldCommission - newCommission };

      await db.lots.add(newLot);
      await db.lots.put(oldUpdated);

      // Гроші при поділі не рухаються — рухається власність. Але кожен лот
      // мусить мати свою транзакцію покупки на СВОЮ суму.
      //
      // Раніше новий лот отримував trace-транзакцію з сумою 0, а старий
      // зберігав повну суму вихідної покупки. Обидва записи порушували
      // інваріант «транзакція покупки дорівнює вкладеному в лот», і перше ж
      // редагування будь-якої з половин змушувало lots.update перерахувати
      // її з нуля: у новому лоті з рахунку списувалось те, чого ніколи не
      // витрачали, у старому — навпаки, залишок стрибав угору.
      const oldTxs = await db.cashTransactions
        .where("[refId+refType]").equals([lotId, "lot"]).toArray();
      const oldTx = oldTxs[0];

      const newTx = buildLotPurchaseTx(newLot, bond);
      newTx.notes = `Виділено з лоту ${old.id.slice(0, 8)}`;
      if (oldTx) newTx.date = oldTx.date;
      await db.cashTransactions.add(newTx);

      if (oldTx) {
        const rebuilt = buildLotPurchaseTx(oldUpdated, bond);
        await db.cashTransactions.put({ ...oldTx, amount: rebuilt.amount });
        for (let i = 1; i < oldTxs.length; i++) await db.cashTransactions.delete(oldTxs[i].id);
      }

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

  async markReceived(id, { actualDate, actualAmount, notes, accountId } = {}) {
    const c = await db.couponPayments.get(id);
    if (!c) throw new Error("Виплату не знайдено");

    const lot = await db.lots.get(c.lotId);
    if (!lot) throw new Error("Лот не знайдено");
    const bond = await db.bondReferences.get(lot.isin);

    const amt = actualAmount != null ? Number(actualAmount) : c.amountNet;
    const date = isoDate(actualDate) || now();

    await db.transaction("rw", [db.couponPayments, db.cashTransactions, db.lots], async () => {
      await db.couponPayments.put({
        ...c,
        status: "received",
        actualDate: date,
        actualAmount: amt,
      });

      // Погашення закриває лот: тіло повернулось грошима, папера більше немає.
      // Без цього він висів би в портфелі вічно — вартість рахується від
      // номіналу, а номінал нікуди не дівається.
      const isRedemption = c.kind === "redemption" || c.kind === "coupon+redemption";
      if (isRedemption) {
        await db.lots.put({ ...lot, closedAt: date, closedReason: "redemption" });
      }

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
          // За замовчуванням гроші падають на рахунок, де лежить папір. Але
          // емітент може перерахувати і кудись інде (у звіті ICU так сталося з
          // погашенням — воно пішло на банківський рахунок), тому дозволяємо вказати.
          accountId: accountId || lot.accountId,
          // Гроші належать тій кишені, якій належав папір. Саме звідси
          // береться розбивка погашення, коли в одну дату гасяться лоти
          // обох сторін: рознесення по лотах уже пропорційне, лишається
          // лише згрупувати результат.
          pocketId: lot.pocketId,
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

  /**
   * Позначає отриманою ЦІЛУ подію виплати — усі лотові записи одного випуску
   * на одну дату. Емітент платить одним переказом, тому й підтвердження має
   * бути одне. Фактична сума ділиться між записами пропорційно їхнім плановим
   * сумам, а копійки округлення падають на останній, щоб сума частин дорівнювала
   * тому, що реально надійшло.
   */
  async markGroupReceived(couponIds, { actualDate, actualAmount, accountId } = {}) {
    const ids = [...new Set(couponIds || [])];
    if (ids.length === 0) throw new Error("Порожня група виплат");

    const rows = (await Promise.all(ids.map(id => db.couponPayments.get(id)))).filter(Boolean);
    if (rows.length === 0) throw new Error("Виплати не знайдено");

    const plannedTotal = rows.reduce((s, c) => s + (Number(c.amountNet) || 0), 0);
    const total = actualAmount != null ? Number(actualAmount) : plannedTotal;

    let allocated = 0;
    const shares = rows.map((c, i) => {
      if (i === rows.length - 1) return Math.round((total - allocated) * 100) / 100;
      const share = plannedTotal > 0
        ? Math.round((total * (Number(c.amountNet) || 0) / plannedTotal) * 100) / 100
        : Math.round((total / rows.length) * 100) / 100;
      allocated += share;
      return share;
    });

    for (let i = 0; i < rows.length; i++) {
      await this.markReceived(rows[i].id, { actualDate, actualAmount: shares[i], accountId });
    }
    return { count: rows.length, total };
  },

  /** Скасовує підтвердження цілої події — щоб перезаписати з правильною сумою. */
  async markGroupScheduled(couponIds) {
    for (const id of [...new Set(couponIds || [])]) {
      await this.markScheduled(id).catch(() => {});
    }
  },

  async markScheduled(id) {
    const c = await db.couponPayments.get(id);
    if (!c) throw new Error("Виплату не знайдено");
    await db.transaction("rw", [db.couponPayments, db.cashTransactions, db.lots], async () => {
      await db.couponPayments.put({ ...c, status: "scheduled", actualDate: null, actualAmount: null });
      // Скасували підтвердження погашення — лот повертається в портфель
      if (c.kind === "redemption" || c.kind === "coupon+redemption") {
        const lot = await db.lots.get(c.lotId);
        if (lot?.closedReason === "redemption") {
          await db.lots.put({ ...lot, closedAt: null, closedReason: null });
        }
      }
      const oldTxs = await db.cashTransactions
        .where("[refId+refType]").equals([id, "coupon"]).toArray();
      for (const t of oldTxs) await db.cashTransactions.delete(t.id);
    });
  },
};

// ── Backup / Restore ────────────────────────────────────────────────────────

export const backup = {
  async exportAll() {
    const [personsData, brokersData, accountsData, pocketsData, bondsData, lotsData, couponsData, txData, snapshotsData] = await Promise.all([
      db.persons.toArray(),
      db.brokers.toArray(),
      db.accounts.toArray(),
      db.pockets.toArray(),
      db.bondReferences.toArray(),
      db.lots.toArray(),
      db.couponPayments.toArray(),
      db.cashTransactions.toArray(),
      db.snapshots.toArray(),
    ]);
    // Device-local settings that live outside Dexie but must survive a restore
    // on a fresh device (wallet addresses are NOT financial records, yet losing
    // them on migration reads as data loss to the user).
    let localSettings = null;
    try {
      if (typeof localStorage !== "undefined") {
        localSettings = {
          df_wallets:  localStorage.getItem("df_wallets")  || null,
          df_fx_rates: localStorage.getItem("df_fx_rates") || null,
        };
      }
    } catch { /* private mode etc. — skip */ }

    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now(),
      localSettings,
      data: {
        persons: personsData,
        brokers: brokersData,
        accounts: accountsData,
        pockets: pocketsData,
        bondReferences: bondsData,
        lots: lotsData,
        couponPayments: couponsData,
        cashTransactions: txData,
        snapshots: snapshotsData,
      },
    };
  },

  // Завжди повна заміна (clear → bulkPut). Колишній merge-режим видалено:
  // UI його ніколи не вмикав, а мовчазний upsert по ключах міг непомітно
  // перезаписувати реальні записи з чужого файлу.
  async importAll(payload) {
    if (!payload?.data) throw new Error("Невалідний файл бекапу");
    const migrated = migrateBackup(payload);
    const { persons: p, brokers: br, accounts: a, pockets: pk, bondReferences: b, lots: l, couponPayments: c, cashTransactions: t, snapshots: s } = migrated.data;

    await db.transaction("rw",
      [db.persons, db.brokers, db.accounts, db.pockets, db.bondReferences, db.lots, db.couponPayments, db.cashTransactions, db.snapshots],
      async () => {
        await Promise.all([
          db.persons.clear(), db.brokers.clear(), db.accounts.clear(), db.pockets.clear(),
          db.bondReferences.clear(), db.lots.clear(),
          db.couponPayments.clear(), db.cashTransactions.clear(), db.snapshots.clear(),
        ]);
        if (p?.length)  await db.persons.bulkPut(p);
        if (br?.length) await db.brokers.bulkPut(br);
        if (a?.length)  await db.accounts.bulkPut(a);
        if (pk?.length) await db.pockets.bulkPut(pk);
        if (b?.length)  await db.bondReferences.bulkPut(b);
        if (l?.length)  await db.lots.bulkPut(l);
        if (c?.length)  await db.couponPayments.bulkPut(c);
        if (t?.length)  await db.cashTransactions.bulkPut(t);
        if (s?.length)  await db.snapshots.bulkPut(s);
      });

    // Restore device-local settings (wallet addresses, FX rates) if present.
    try {
      if (typeof localStorage !== "undefined" && migrated.localSettings) {
        const ls = migrated.localSettings;
        if (typeof ls.df_wallets === "string")  localStorage.setItem("df_wallets", ls.df_wallets);
        if (typeof ls.df_fx_rates === "string") localStorage.setItem("df_fx_rates", ls.df_fx_rates);
      }
    } catch { /* non-fatal */ }
  },
};

// ── Snapshots (equity curve) ───────────────────────────────────────────────

import { lotCurrentValue } from "./calculations.js";

export const snapshots = {
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
};

// ── Demo / Sample Portfolio ────────────────────────────────────────────────

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
