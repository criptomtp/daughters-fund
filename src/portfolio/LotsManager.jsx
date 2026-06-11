import { useState, useMemo } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { lotInvested, lotYTM, lotAccruedTotal, lotXIRR } from "./calculations.js";
import { BondForm } from "./BondForm.jsx";
import { EMPTY_BOND_DRAFT } from "./bondConstants.js";
import { bonds as bondsRepo, lots as lotsRepo, transactions as txRepo } from "./repository.js";
import { useCashBalance } from "./hooks/useTransactions.js";
import { Modal } from "./Modal.jsx";
import { CashOpForm } from "./CashOpForm.jsx";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

const LAST_USED_KEY = "df_last_used_lot_form";

function loadLastUsed() {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLastUsed(data) {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify({
      accountId: data.accountId,
      brokerId: data.brokerId,
      isin: data.isin,
    }));
  } catch { /* ignore quota */ }
}

function emptyLotDraft(bonds, accounts) {
  const last = loadLastUsed();
  const accountId = (last.accountId && accounts.some(a => a.id === last.accountId))
    ? last.accountId
    : (accounts[0]?.id || "");
  const isin = (last.isin && bonds.some(b => b.isin === last.isin))
    ? last.isin
    : (bonds[0]?.isin || "");
  const selectedBond = bonds.find(b => b.isin === isin);
  return {
    isin,
    accountId,
    purchaseDate: new Date().toISOString().slice(0, 10),
    quantity: 1,
    purchasePrice: selectedBond?.faceValue || 1000,
    accruedInterestPerPiece: 0,
    commission: 0,
    notes: "",
  };
}

export function LotsManager({ accountFilter }) {
  const { list: lots, loading, error, add, update, remove, refresh: refreshLots } = useLots({
    accountId: accountFilter === "all" ? undefined : accountFilter,
  });
  const { list: bonds, refresh: refreshBonds } = useBonds();
  const { list: accounts } = useAccounts();
  const { list: brokers } = useBrokers();
  const [editingLot, setEditingLot] = useState(null);
  const [creatingBond, setCreatingBond] = useState(false);
  const [splittingLot, setSplittingLot] = useState(null);
  const [opErr, setOpErr] = useState(null);

  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const brokersById = useMemo(() => new Map(brokers.map(b => [b.id, b])), [brokers]);

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  const handleSubmit = async (draft) => {
    setOpErr(null);
    try {
      if (editingLot === "new") {
        await add(draft);
        saveLastUsed(draft);  // memorize for next "+ Додати"
      } else {
        await update(editingLot.id, draft);
      }
      setEditingLot(null);
    } catch (e) { setOpErr(e.message); }
  };

  const handleRemove = async (id) => {
    if (!confirm("Видалити лот? Купонний графік цього лоту також буде видалено.")) return;
    setOpErr(null);
    try { await remove(id); }
    catch (e) { setOpErr(e.message); }
  };

  const handleCreateBond = async (bondDraft) => {
    setOpErr(null);
    try {
      await bondsRepo.add(bondDraft);
      await refreshBonds();
      setCreatingBond(false);
    } catch (e) { setOpErr(e.message); }
  };

  const handleSplit = async ({ lotId, quantityForNew, newAccountId }) => {
    setOpErr(null);
    try {
      await lotsRepo.split({ lotId, quantityForNew, newAccountId });
      setSplittingLot(null);
      await refreshLots();
    } catch (e) { setOpErr(e.message); }
  };

  // Купити можна якщо є хоча б 1 рахунок (ISIN можна створити inline у формі покупки)
  const canAdd = accounts.length > 0;

  return (
    <div className="lots-manager">
      {error && <div className="portfolio-error">⚠ {error}</div>}
      {opErr && <div className="portfolio-error">⚠ {opErr}</div>}

      <div className="lots-list">
        {lots.length === 0 && (
          <div className="portfolio-empty">
            {accounts.length === 0
              ? "Спочатку створіть рахунок у секції '💳 Рахунки' нижче — обери брокера (ICU, Monobank, Sense, Приват) і бенефіціара. Тоді тут можна буде записати першу покупку."
              : bonds.length === 0
              ? "Жодного лоту. Натисни '🛒 Купив облігацію' нижче — у формі покупки можна одразу створити новий ISIN inline."
              : "Жодного лоту. Натисни '🛒 Купив облігацію' нижче."}
          </div>
        )}
        {lots.map(lot => {
          const bond = bondsByIsin.get(lot.isin);
          const account = accountsById.get(lot.accountId);
          const broker = account && brokersById.get(account.brokerId);
          const invested = lotInvested(lot);
          const accruedTotal = lotAccruedTotal(lot);
          const xirr = bond ? lotXIRR(bond, lot) : null;
          const ytm = bond && xirr == null ? lotYTM(bond, lot) : null;
          return (
            <div key={lot.id} className="lot-card" style={{ "--owner-color": account?.color || "#c9a96a" }}>
              <div className="lot-card-main">
                <div className="lot-card-top">
                  <span className="lot-owner">{account?.emoji} {account?.name || "—"}</span>
                  {broker && (
                    <span className="broker-badge" style={{ background: broker.color + "22", color: broker.color }}>
                      {broker.emoji} {broker.name}
                    </span>
                  )}
                  <span className="lot-isin mono">{lot.isin}</span>
                  {bond && <span className="lot-ticker">{bond.ticker}</span>}
                </div>
                <div className="lot-card-meta">
                  <span>{lot.quantity} × {fmt(lot.purchasePrice, bond?.currency)}</span>
                  {accruedTotal > 0 && (<>
                    <span className="bond-meta-sep">·</span>
                    <span>НКД {fmt(accruedTotal, bond?.currency)}</span>
                  </>)}
                  <span className="bond-meta-sep">·</span>
                  <span>{lot.purchaseDate?.slice(0, 10)}</span>
                  {xirr != null && (<>
                    <span className="bond-meta-sep">·</span>
                    <span className="lot-ytm" title="Реальна IRR з урахуванням НКД">XIRR {xirr.toFixed(2)}%</span>
                  </>)}
                  {ytm != null && (<>
                    <span className="bond-meta-sep">·</span>
                    <span className="lot-ytm">YTM ~{ytm.toFixed(2)}%</span>
                  </>)}
                </div>
              </div>
              <div className="lot-card-totals">
                <div className="lot-invested-label">Вкладено</div>
                <div className="lot-invested-value">{fmt(invested, bond?.currency)}</div>
              </div>
              <div className="lot-card-actions">
                <button className="owner-action-btn" title="Розщепити і перенести" onClick={() => setSplittingLot(lot)}>✂</button>
                <button className="owner-action-btn" onClick={() => setEditingLot(lot)}>✎</button>
                <button className="remove-btn" onClick={() => handleRemove(lot.id)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="lots-actions">
        {canAdd ? (
          <button className="add-btn add-btn--primary" onClick={() => setEditingLot("new")}>
            🛒 Купив облігацію (новий лот)
          </button>
        ) : (
          <div className="lots-blocked-hint">
            ⓘ Для запису покупки потрібен хоча б один рахунок (брокер + бенефіціар) — створи його у секції <strong>💳 Рахунки</strong> нижче.
          </div>
        )}
        <button className="add-btn" onClick={() => setCreatingBond(true)}>
          📚 + Додати ISIN у довідник
        </button>
      </div>

      {editingLot && (
        <LotForm
          initial={editingLot === "new" ? emptyLotDraft(bonds, accounts) : {
            ...editingLot,
            purchaseDate: editingLot.purchaseDate?.slice(0, 10),
            accruedInterestPerPiece: editingLot.accruedInterestPerPiece != null
              ? editingLot.accruedInterestPerPiece
              : (editingLot.quantity > 0 ? (editingLot.accruedInterestPaid || 0) / editingLot.quantity : 0),
          }}
          isNew={editingLot === "new"}
          bonds={bonds}
          accounts={accounts}
          brokers={brokers}
          brokersById={brokersById}
          onCreateBond={() => setCreatingBond(true)}
          onSubmit={handleSubmit}
          onCancel={() => setEditingLot(null)}
        />
      )}

      {creatingBond && (
        <BondForm
          initial={EMPTY_BOND_DRAFT}
          isNew={true}
          onSubmit={handleCreateBond}
          onCancel={() => setCreatingBond(false)}
        />
      )}

      {splittingLot && (
        <SplitLotForm
          lot={splittingLot}
          accounts={accounts.filter(a => a.id !== splittingLot.accountId)}
          brokersById={brokersById}
          bond={bondsByIsin.get(splittingLot.isin)}
          onSubmit={handleSplit}
          onCancel={() => setSplittingLot(null)}
        />
      )}
    </div>
  );
}

function LotForm({ initial, isNew, bonds, accounts, brokers, brokersById, onCreateBond, onSubmit, onCancel }) {
  // Initialize brokerId from initial.accountId (consistency)
  const initialBroker = useMemo(() => {
    if (initial.brokerId) return initial.brokerId;
    const acc = accounts.find(a => a.id === initial.accountId);
    return acc?.brokerId || "";
  }, [initial, accounts]);

  const [draft, setDraft] = useState({ ...initial, brokerId: initialBroker });
  const [topUpMode, setTopUpMode] = useState(null); // null | 'deposit' | 'transfer'
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  // When broker changes — clear/reset account if it doesn't belong to this broker
  const setBroker = (brokerId) => {
    setDraft(d => {
      const accStillValid = d.accountId && accounts.some(a => a.id === d.accountId && a.brokerId === brokerId);
      return {
        ...d,
        brokerId,
        accountId: accStillValid ? d.accountId : "",
      };
    });
  };

  // When bond changes — auto-fill clean price with face value
  const setIsin = (isin) => {
    const newBond = bonds.find(b => b.isin === isin);
    setDraft(d => ({
      ...d,
      isin,
      purchasePrice: newBond ? newBond.faceValue : d.purchasePrice,
    }));
  };

  const submit = () => {
    if (!draft.isin || !draft.accountId || !draft.quantity) return;
    onSubmit(draft);
  };

  const bond = bonds.find(b => b.isin === draft.isin);
  const selectedAccount = accounts.find(a => a.id === draft.accountId);
  const selectedBroker  = brokersById.get(draft.brokerId);
  const filteredAccounts = draft.brokerId
    ? accounts.filter(a => a.brokerId === draft.brokerId)
    : accounts;

  const qty = Number(draft.quantity) || 0;
  const accruedPP = Number(draft.accruedInterestPerPiece) || 0;
  const accruedTotal = accruedPP * qty;
  const dirtyPerPiece = (Number(draft.purchasePrice) || 0) + accruedPP;
  const cleanTotal = qty * (Number(draft.purchasePrice) || 0);
  const total = cleanTotal + accruedTotal + Number(draft.commission || 0);
  const ytmApprox = (bond && bond.maturityDate && draft.purchaseDate && draft.purchasePrice)
    ? lotYTM(bond, { purchaseDate: draft.purchaseDate, purchasePrice: draft.purchasePrice })
    : null;

  const balances = useCashBalance(draft.accountId);
  const cur = bond?.currency || "UAH";
  const availableCash = balances[cur] || 0;
  const willBeShort = bond && total > 0 && availableCash < total;

  const handleTopUp = async (payload) => {
    try {
      if (topUpMode === "deposit")      await txRepo.deposit(payload);
      else if (topUpMode === "transfer") await txRepo.transfer(payload);
      setTopUpMode(null);
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <Modal onClose={onCancel} ariaLabel="Форма лоту">
      <div>
        <h3 className="modal-title">{isNew ? "Нова покупка облігації" : "Редагувати лот"}</h3>

        <div className="form-grid">
          <label className="form-field form-field--full">
            <span className="form-label">Облігація (ISIN)<span className="req">*</span></span>
            <div className="isin-select-row">
              <select className="form-input" value={draft.isin} onChange={e => setIsin(e.target.value)} disabled={!isNew}>
                <option value="">— виберіть —</option>
                {bonds.map(b => (
                  <option key={b.isin} value={b.isin}>
                    {b.isin} · {b.ticker || "?"} · {b.couponRate}% · номінал {b.faceValue} {b.currency}
                  </option>
                ))}
              </select>
              {isNew && (
                <button type="button" className="owner-action-btn" onClick={onCreateBond}>+ Нова</button>
              )}
            </div>
          </label>

          {bond && (
            <div className="bond-summary-row form-field--full">
              <div className="bs-cell">
                <span className="bs-label">Номінал</span>
                <span className="bs-value">{fmt(bond.faceValue, bond.currency)}</span>
              </div>
              <div className="bs-cell">
                <span className="bs-label">Купон</span>
                <span className="bs-value">{bond.couponRate}%/рік</span>
              </div>
              <div className="bs-cell">
                <span className="bs-label">Погашення</span>
                <span className="bs-value">{bond.maturityDate?.slice(0, 10)}</span>
              </div>
              <div className="bs-cell">
                <span className="bs-label">Тип</span>
                <span className="bs-value">{bond.type === "ovdp" ? "ОВДП" : "Корпорат."}</span>
              </div>
            </div>
          )}

          <label className="form-field">
            <span className="form-label">Оператор (брокер)<span className="req">*</span></span>
            <select className="form-input" value={draft.brokerId} onChange={e => setBroker(e.target.value)}>
              <option value="">— виберіть —</option>
              {brokers.map(b => (
                <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Рахунок (куди лягає лот і звідки списується кеш)<span className="req">*</span></span>
            <select className="form-input" value={draft.accountId} onChange={e => upd("accountId", e.target.value)}>
              <option value="">{draft.brokerId ? "— виберіть —" : "— спочатку оберіть брокера —"}</option>
              {filteredAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.emoji} {a.name} · {a.primaryCurrency}</option>
              ))}
            </select>
          </label>

          {selectedBroker && selectedAccount && (
            <div className="form-field form-field--full lot-route">
              <span className="lot-route-step">{selectedBroker.emoji} {selectedBroker.name}</span>
              <span className="lot-route-arrow">→</span>
              <span className="lot-route-step">{selectedAccount.emoji} {selectedAccount.name}</span>
              {bond && (<>
                <span className="lot-route-arrow">→</span>
                <span className="lot-route-step lot-route-bond">{bond.ticker || bond.isin}</span>
              </>)}
              <span className="lot-route-hint">
                Облігація зберігатиметься в брокера {selectedBroker.name}, гроші спишуться з cash balance цього рахунку.
              </span>
            </div>
          )}

          <label className="form-field">
            <span className="form-label">Дата покупки<span className="req">*</span></span>
            <input type="date" className="form-input"
              value={draft.purchaseDate?.slice(0, 10) || ""}
              onChange={e => upd("purchaseDate", e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">Кількість<span className="req">*</span></span>
            <input type="number" step="1" min="1" className="form-input"
              value={draft.quantity}
              onChange={e => upd("quantity", Number(e.target.value))} />
          </label>
          <label className="form-field">
            <span className="form-label">
              Ціна за 1 шт. (clean) {bond && <span className="form-hint">за замовч. = номінал {bond.faceValue}</span>}
            </span>
            <input type="number" step="0.01" className="form-input"
              value={draft.purchasePrice}
              onChange={e => upd("purchasePrice", Number(e.target.value))} />
          </label>
          <label className="form-field">
            <span className="form-label">
              НКД на 1 шт. <span className="form-hint">різниця: брокерська ціна − номінал</span>
            </span>
            <input type="number" step="0.01" className="form-input"
              value={draft.accruedInterestPerPiece || 0}
              onChange={e => upd("accruedInterestPerPiece", Number(e.target.value))}
              placeholder="0" />
          </label>
          <label className="form-field">
            <span className="form-label">Комісія</span>
            <input type="number" step="0.01" className="form-input"
              value={draft.commission || 0}
              onChange={e => upd("commission", Number(e.target.value))} />
          </label>
          <label className="form-field form-field--full">
            <span className="form-label">Замітки</span>
            <input className="form-input" value={draft.notes || ""} onChange={e => upd("notes", e.target.value)} />
          </label>
        </div>

        {bond && (
          <div className="modal-info purchase-summary">
            <div className="ps-row dim">
              <span>Залишок на рахунку ({cur}):</span>
              <strong style={{ color: availableCash >= 0 ? "var(--gain)" : "var(--oxblood)" }}>
                {fmt(availableCash, cur)}
              </strong>
            </div>
            <div className="ps-row dim">
              <span>Брокерська ціна за 1 шт. (dirty):</span>
              <strong>{fmt(dirtyPerPiece, bond.currency)} = {fmt(draft.purchasePrice, bond.currency)} + {fmt(accruedPP, bond.currency)} НКД</strong>
            </div>
            <div className="ps-row">
              <span>Номінал × {qty} шт:</span>
              <strong>{fmt(cleanTotal, bond.currency)}</strong>
            </div>
            {accruedTotal > 0 && (
              <div className="ps-row">
                <span>+ НКД ({fmt(accruedPP, bond.currency)} × {qty}):</span>
                <strong>{fmt(accruedTotal, bond.currency)}</strong>
              </div>
            )}
            {draft.commission > 0 && (
              <div className="ps-row dim">
                <span>+ Комісія:</span>
                <strong>{fmt(Number(draft.commission || 0), bond.currency)}</strong>
              </div>
            )}
            <div className="ps-row total">
              <span>Списується з рахунку:</span>
              <strong>{fmt(total, bond.currency)}</strong>
            </div>
            {ytmApprox != null && (
              <div className="ps-row ytm">
                <span>Орієнтовна дохідність до погашення (YTM):</span>
                <strong>~{ytmApprox.toFixed(2)}%/рік</strong>
              </div>
            )}
            {willBeShort && (
              <div className="ps-warning">
                <div>⚠ Не вистачає {fmt(total - availableCash, cur)} на рахунку.</div>
                <div className="ps-warning-actions">
                  <button type="button" className="ps-warning-btn" onClick={() => setTopUpMode("deposit")}>
                    + Поповнити зараз
                  </button>
                  {accounts.length > 1 && (
                    <button type="button" className="ps-warning-btn" onClick={() => setTopUpMode("transfer")}>
                      ↔ Переказати з іншого
                    </button>
                  )}
                  <span className="ps-warning-hint">
                    Або зберегти зараз — баланс стане від'ємним поки не поповните.
                  </span>
                </div>
              </div>
            )}
            <div className="ps-hint">
              💡 Сума {fmt(total, cur)} буде автоматично списана з рахунку при збереженні (транзакція lot_purchase).
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="owner-action-btn ok" onClick={submit}
            disabled={!draft.isin || !draft.accountId || !draft.quantity}>
            {isNew ? "Зберегти покупку" : "Зберегти"}
          </button>
          <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
        </div>
      </div>

      {topUpMode && (
        <CashOpForm
          mode={topUpMode}
          accounts={accounts}
          brokersById={brokersById}
          defaultAccountId={draft.accountId}
          onSubmit={handleTopUp}
          onCancel={() => setTopUpMode(null)}
        />
      )}
    </Modal>
  );
}

function SplitLotForm({ lot, accounts, brokersById, bond, onSubmit, onCancel }) {
  const [quantityForNew, setQuantityForNew] = useState(Math.floor(lot.quantity / 2));
  const [newAccountId, setNewAccountId] = useState(accounts[0]?.id || "");

  const submit = () => onSubmit({ lotId: lot.id, quantityForNew: Number(quantityForNew), newAccountId });
  const remaining = lot.quantity - quantityForNew;
  const cur = bond?.currency || "UAH";

  return (
    <Modal onClose={onCancel} ariaLabel="Форма лоту">
      <div>
        <h3 className="modal-title">✂ Розщепити та перенести</h3>
        <div className="modal-info">
          Лот {lot.isin} · кількість {lot.quantity} · куплено {lot.purchaseDate?.slice(0, 10)}
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span className="form-label">Скільки виділити<span className="req">*</span></span>
            <input type="number" min="1" max={lot.quantity - 1} step="1" className="form-input"
              value={quantityForNew}
              onChange={e => setQuantityForNew(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">Куди (рахунок)<span className="req">*</span></span>
            <select className="form-input" value={newAccountId} onChange={e => setNewAccountId(e.target.value)}>
              {accounts.map(a => {
                const broker = brokersById.get(a.brokerId);
                return (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name} {broker ? `· ${broker.name}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="modal-info">
          <div>→ Новий лот: {quantityForNew} шт. на "{accounts.find(a => a.id === newAccountId)?.name}"</div>
          <div>→ Залишається у поточному рахунку: {remaining} шт.</div>
          <div>→ Орієнтовно: {fmt(quantityForNew * lot.purchasePrice, cur)} виноситься, {fmt(remaining * lot.purchasePrice, cur)} залишається</div>
        </div>
        <div className="modal-actions">
          <button className="owner-action-btn ok" onClick={submit}
            disabled={!newAccountId || quantityForNew <= 0 || quantityForNew >= lot.quantity}>
            Розщепити
          </button>
          <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
        </div>
      </div>
    </Modal>
  );
}
