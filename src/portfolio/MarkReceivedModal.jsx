import { useState } from "react";
import { Modal } from "./Modal.jsx";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function MarkReceivedModal({ coupon, lot, bond, account, onSubmit, onCancel }) {
  const expected = coupon.amountNet;
  const [actualAmount, setActualAmount] = useState(expected);
  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const diff = Number(actualAmount) - expected;
  const cur = bond?.currency || "UAH";

  const submit = () => {
    onSubmit({
      actualAmount: Number(actualAmount),
      actualDate,
      notes,
    });
  };

  return (
    <Modal onClose={onCancel} ariaLabel="Позначити купон отриманим">
      <h3 className="modal-title">✓ Позначити отриманим</h3>

      <div className="modal-info">
        <div className="ps-row">
          <span>{coupon.kind === "redemption" ? "Погашення" : coupon.kind === "coupon+redemption" ? "Купон + Погашення" : "Купон"} ·</span>
          <strong>{account?.emoji} {account?.name}</strong>
        </div>
        <div className="ps-row dim">
          <span>Очікувано:</span>
          <strong>{fmt(expected, cur)}</strong>
        </div>
        <div className="ps-row dim">
          <span>Заплановано на:</span>
          <strong>{coupon.scheduledDate?.slice(0, 10)}</strong>
        </div>
        <div className="ps-row dim">
          <span>{lot?.isin}</span>
          <strong>{bond?.ticker || ""}</strong>
        </div>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span className="form-label">Фактично отримано<span className="req">*</span></span>
          <input
            type="number" step="0.01" className="form-input"
            value={actualAmount}
            onChange={e => setActualAmount(e.target.value)}
            autoFocus
          />
        </label>
        <label className="form-field">
          <span className="form-label">Дата отримання<span className="req">*</span></span>
          <input
            type="date" className="form-input"
            value={actualDate}
            onChange={e => setActualDate(e.target.value)}
          />
        </label>
        <label className="form-field form-field--full">
          <span className="form-label">Коментар</span>
          <input
            className="form-input"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="напр. комісія банку, валютна різниця..."
          />
        </label>
      </div>

      {Math.abs(diff) > 0.01 && (
        <div className={diff < 0 ? "ps-warning" : "modal-info"}>
          {diff < 0
            ? `⚠ Менше очікуваного на ${fmt(-diff, cur)} (різниця, комісія банку, тощо)`
            : `+${fmt(diff, cur)} більше очікуваного`}
        </div>
      )}

      <div className="modal-actions">
        <button className="owner-action-btn ok" onClick={submit}>Зберегти</button>
        <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
      </div>
    </Modal>
  );
}
