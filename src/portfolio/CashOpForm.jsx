import { useState } from "react";
import { Modal } from "./Modal.jsx";
import { CURRENCIES } from "./taxRules.js";

// Універсальна форма для готівкових операцій: deposit / withdraw / transfer
export function CashOpForm({ mode, accounts, brokersById, defaultAccountId, onSubmit, onCancel }) {
  const isTransfer = mode === "transfer";
  const isDeposit  = mode === "deposit";

  const defaultAcc = accounts.find(a => a.id === defaultAccountId) || accounts[0];

  const [accountId, setAccountId] = useState(defaultAcc?.id || "");
  const [toAccountId, setToAccountId] = useState(
    accounts.find(a => a.id !== defaultAcc?.id)?.id || ""
  );
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultAcc?.primaryCurrency || "UAH");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const title = isTransfer ? "Переказ між рахунками"
              : isDeposit  ? "Поповнення рахунку"
              : "Зняття з рахунку";

  const submit = async () => {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) return;
    if (isTransfer) {
      await onSubmit({ fromAccountId: accountId, toAccountId, amount: num, currency, date, notes });
    } else {
      await onSubmit({ accountId, amount: num, currency, date, notes });
    }
  };

  const canSubmit = Number(amount) > 0 && accountId && (!isTransfer || (toAccountId && toAccountId !== accountId));

  return (
    <Modal onClose={onCancel} ariaLabel={title}>
      <h3 className="modal-title">{title}</h3>

      <div className="form-grid">
        <label className="form-field form-field--full">
          <span className="form-label">{isTransfer ? "З рахунку" : "Рахунок"}<span className="req">*</span></span>
          <select className="form-input" value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">— виберіть —</option>
            {accounts.map(a => {
              const broker = brokersById?.get(a.brokerId);
              return (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name} {broker ? `· ${broker.name}` : ""} · {a.primaryCurrency}
                </option>
              );
            })}
          </select>
        </label>

        {isTransfer && (
          <label className="form-field form-field--full">
            <span className="form-label">На рахунок<span className="req">*</span></span>
            <select className="form-input" value={toAccountId} onChange={e => setToAccountId(e.target.value)}>
              <option value="">— виберіть —</option>
              {accounts.filter(a => a.id !== accountId).map(a => {
                const broker = brokersById?.get(a.brokerId);
                return (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name} {broker ? `· ${broker.name}` : ""} · {a.primaryCurrency}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        <label className="form-field">
          <span className="form-label">Сума<span className="req">*</span></span>
          <input type="number" step="0.01" min="0" className="form-input"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus />
        </label>

        <label className="form-field">
          <span className="form-label">Валюта</span>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">Дата</span>
          <input type="date" className="form-input"
            value={date}
            onChange={e => setDate(e.target.value)} />
        </label>

        <label className="form-field form-field--full">
          <span className="form-label">Примітка</span>
          <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={isTransfer ? "напр. Перерозподіл, виплата зарплати..." : "коментар"} />
        </label>
      </div>

      <div className="modal-actions">
        <button className="owner-action-btn ok" onClick={submit} disabled={!canSubmit}>
          {isTransfer ? "Переказати" : isDeposit ? "Поповнити" : "Зняти"}
        </button>
        <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
      </div>
    </Modal>
  );
}
