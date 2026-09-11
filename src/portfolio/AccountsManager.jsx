import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { usePersons } from "./hooks/usePersons.js";
import { usePockets } from "./hooks/usePockets.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { useLots } from "./hooks/useLots.js";
import { CURRENCIES } from "./taxRules.js";
import { Modal } from "./Modal.jsx";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmtMoney(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

const KIND_LABEL = { personal: "Персональний", shared: "Спільний" };

export function AccountsManager() {
  const { list: accounts, loading, error, add, update, remove } = useAccounts();
  const { list: persons } = usePersons();
  const { list: pockets } = usePockets();
  const { list: brokers } = useBrokers();
  const { list: lots } = useLots();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [opErr, setOpErr] = useState(null);

  const lotsByAccount = useMemo(() => {
    const map = new Map();
    for (const lot of lots) {
      if (!map.has(lot.accountId)) map.set(lot.accountId, 0);
      map.set(lot.accountId, map.get(lot.accountId) + 1);
    }
    return map;
  }, [lots]);

  const balancesByAccount = useLiveQuery(async () => {
    const all = await db.cashTransactions.toArray();
    const result = new Map();
    for (const t of all) {
      if (!result.has(t.accountId)) result.set(t.accountId, {});
      const map = result.get(t.accountId);
      const cur = t.currency || "UAH";
      map[cur] = (map[cur] || 0) + (Number(t.amount) || 0);
    }
    return result;
  }, [], new Map()) || new Map();

  // Розбивка залишку по кишенях. Це єдине місце, де простори показані разом:
  // у виписці брокера сума одна, і звіряти доводиться саме з нею.
  const pocketBalances = useLiveQuery(async () => {
    const all = await db.cashTransactions.toArray();
    const result = new Map();
    for (const t of all) {
      if (!t.pocketId) continue;
      const key = `${t.accountId}|${t.pocketId}`;
      const cur = t.currency || "UAH";
      if (!result.has(key)) result.set(key, {});
      const map = result.get(key);
      map[cur] = (map[cur] || 0) + (Number(t.amount) || 0);
    }
    return result;
  }, [], new Map()) || new Map();

  const grouped = useMemo(() => {
    const brokersByIdLocal = new Map(brokers.map(b => [b.id, b]));
    const groups = new Map();
    for (const acc of accounts) {
      const key = acc.brokerId || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(acc);
    }
    return Array.from(groups.entries()).map(([brokerId, accs]) => ({
      broker: brokersByIdLocal.get(brokerId) || { id: brokerId, name: "Без брокера", color: "#7a7568", emoji: "❓" },
      accounts: accs,
    }));
  }, [accounts, brokers]);

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  const handleSubmit = async (draft) => {
    setOpErr(null);
    try {
      if (editing) await update(editing.id, draft);
      else await add(draft);
      setCreating(false);
      setEditing(null);
    } catch (e) { setOpErr(e.message); }
  };

  const handleRemove = async (id, name) => {
    if (!confirm(`Видалити рахунок "${name}"?`)) return;
    setOpErr(null);
    try { await remove(id); }
    catch (e) { setOpErr(e.message); }
  };

  const personById = (id) => persons.find(p => p.id === id);

  const canCreateShared = persons.length >= 2 && brokers.length >= 1;
  const canCreatePersonal = persons.length >= 1 && brokers.length >= 1;

  return (
    <div className="accounts-manager">
      {error && <div className="portfolio-error">⚠ {error}</div>}
      {opErr && <div className="portfolio-error">⚠ {opErr}</div>}

      {accounts.length === 0 && (
        <div className="portfolio-empty">Жодного рахунку. Додайте перший нижче.</div>
      )}

      {grouped.map(({ broker, accounts: brokerAccounts }) => (
        <div key={broker.id} className="broker-group">
          <div className="broker-group-head">
            <span className="broker-badge" style={{ background: broker.color + "22", color: broker.color }}>
              {broker.emoji} {broker.name}
            </span>
            <span className="broker-group-count">
              {brokerAccounts.length} рахун{brokerAccounts.length === 1 ? "ок" : brokerAccounts.length < 5 ? "ки" : "ків"}
            </span>
          </div>
          <div className="accounts-list">
            {brokerAccounts.map(acc => {
              const beneficiaries = (acc.beneficiaryIds || []).map(personById).filter(Boolean);
              const lotCount = lotsByAccount.get(acc.id) || 0;
              const balances = balancesByAccount.get(acc.id) || {};
              const balanceCurrencies = Object.keys(balances);
              return (
                <div key={acc.id} className="account-card" style={{ "--owner-color": acc.color }}>
                  <div className="account-card-main">
                    <div className="account-card-top">
                      <span className="account-emoji">{acc.emoji}</span>
                      <span className="account-name">{acc.name}</span>
                      <span className={`account-kind ${acc.kind}`}>{KIND_LABEL[acc.kind]}</span>
                    </div>
                    <div className="account-card-meta">
                      <span className="account-beneficiaries">
                        {beneficiaries.length === 0 && <em>власника не вказано</em>}
                        {beneficiaries.map((b, i) => (
                          <span key={b.id}>
                            {i > 0 && " · "}
                            <span style={{ color: b.color }}>{b.emoji} {b.name}</span>
                          </span>
                        ))}
                      </span>
                      <span className="account-meta-sep">·</span>
                      <span>{lotCount} лот{lotCount === 1 ? "" : "и"}</span>
                    </div>
                    {balanceCurrencies.length > 0 && (
                      <div className="account-card-balance">
                        Залишок:{" "}
                        {balanceCurrencies.map((cur, i) => (
                          <span key={cur} className={balances[cur] < 0 ? "balance-neg" : "balance-pos"}>
                            {i > 0 && " · "}{fmtMoney(balances[cur], cur)}
                          </span>
                        ))}
                      </div>
                    )}
                    {pockets.length > 1 && (
                      <div className="account-pockets">
                        {pockets.map(pk => {
                          const b = pocketBalances.get(`${acc.id}|${pk.id}`);
                          if (!b) return null;
                          return (
                            <span key={pk.id} className="account-pocket-row">
                              <span className="pocket-dot" style={{ background: pk.color }} />
                              {pk.name}:{" "}
                              {Object.keys(b).map((cur, i) => (
                                <span key={cur} className={b[cur] < 0 ? "balance-neg" : ""}>
                                  {i > 0 && " · "}{fmtMoney(b[cur], cur)}
                                </span>
                              ))}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="account-card-actions">
                    <button className="owner-action-btn" onClick={() => setEditing(acc)}>✎</button>
                    <button className="remove-btn" onClick={() => handleRemove(acc.id, acc.name)}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="lots-actions">
        {canCreatePersonal && (
          <button className="add-btn" onClick={() => setCreating("personal")}>+ Персональний рахунок</button>
        )}
        {canCreateShared && (
          <button className="add-btn" onClick={() => setCreating("shared")}>+ Спільний рахунок</button>
        )}
      </div>

      {(creating || editing) && (
        <AccountForm
          kind={editing ? editing.kind : creating}
          initial={editing}
          persons={persons}
          brokers={brokers}
          onSubmit={handleSubmit}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function AccountForm({ kind, initial, persons, brokers, onSubmit, onCancel }) {
  const isShared = kind === "shared";
  const [draft, setDraft] = useState(initial || {
    name: isShared ? "Спільний портфель" : "",
    kind,
    brokerId: brokers[0]?.id || "",
    beneficiaryIds: isShared ? [] : (persons[0] ? [persons[0].id] : []),
    primaryCurrency: "UAH",
  });

  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const toggleBeneficiary = (id) => {
    if (isShared) {
      const cur = draft.beneficiaryIds || [];
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      upd("beneficiaryIds", next);
    } else {
      upd("beneficiaryIds", [id]);
    }
  };

  const submit = () => {
    if (!draft.name.trim() || !draft.brokerId) return;
    if (isShared && draft.beneficiaryIds.length < 2) return;
    if (!isShared && draft.beneficiaryIds.length !== 1) return;
    // beneficiaryWeights більше нічим не керують: частки рахуються від ваг
    // у кишені. Поле лишається в схемі, щоб старі бекапи відновлювались, але
    // нове значення сюди не пишеться — інакше в базі жили б два джерела
    // часток, з яких одне мовчазно ігнорується.
    onSubmit({ ...draft });
  };

  const canSubmit = draft.name.trim() && draft.brokerId &&
    (isShared ? draft.beneficiaryIds.length >= 2 : draft.beneficiaryIds.length === 1);

  return (
    <Modal onClose={onCancel} ariaLabel="Форма рахунку">
      <div>
        <h3 className="modal-title">
          {initial ? "Редагування рахунку" : (isShared ? "Новий спільний рахунок" : "Новий персональний рахунок")}
        </h3>

        <div className="form-grid">
          <label className="form-field form-field--full">
            <span className="form-label">Назва рахунку<span className="req">*</span></span>
            <input
              className="form-input"
              value={draft.name}
              onChange={e => upd("name", e.target.value)}
              placeholder={isShared ? "Напр. Доньки разом" : "Напр. Тато ICU"}
              autoFocus
            />
          </label>
          <label className="form-field">
            <span className="form-label">Брокер<span className="req">*</span></span>
            <select className="form-input" value={draft.brokerId} onChange={e => upd("brokerId", e.target.value)}>
              <option value="">— виберіть —</option>
              {brokers.map(b => (
                <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Основна валюта</span>
            <select className="form-input" value={draft.primaryCurrency} onChange={e => upd("primaryCurrency", e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="form-field form-field--full">
            <span className="form-label">
              {isShared ? "Юридично оформлено на (≥ 2)" : "Юридично оформлено на"}<span className="req">*</span>
            </span>
            <span className="form-hint">
              Хто записаний власником рахунку в депозитарія. Чиї на ньому гроші —
              окреме питання, воно вирішується кишенями на кожній покупці.
            </span>
            <div className="owner-members-grid">
              {persons.map(p => {
                const selected = draft.beneficiaryIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`member-chip ${selected ? "active" : ""}`}
                    style={{ "--chip-color": p.color }}
                    onClick={() => toggleBeneficiary(p.id)}
                  >
                    {p.emoji} {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="form-field form-field--full">
            <span className="form-label">Примітка про оформлення</span>
            <input className="form-input" value={draft.legalOwnerNote || ""}
              placeholder="напр. договір ICU № 123 від 2026-01-05, на батька"
              onChange={e => upd("legalOwnerNote", e.target.value)} />
          </label>
        </div>

        <div className="modal-info">
          💡 Це поле нічого не рахує — воно фіксує юридичну реальність.
          Підтвердженням прав на цінні папери є обліковий запис на рахунку
          (ЗУ «Про депозитарну систему», ст. 8 ч. 1), тож власником вважається
          той, на кого рахунок оформлено, незалежно від того, чиї гроші на ньому
          лежать. Розподіл між своїми й дитячими грошима ведеться кишенями.
        </div>

        <div className="modal-actions">
          <button className="owner-action-btn ok" onClick={submit} disabled={!canSubmit}>
            {initial ? "Зберегти" : "Створити"}
          </button>
          <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
        </div>
      </div>
    </Modal>
  );
}
