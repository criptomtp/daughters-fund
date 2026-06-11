import { useState, useMemo } from "react";
import { useTransactions } from "./hooks/useTransactions.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { CashOpForm } from "./CashOpForm.jsx";
import { CASH_KINDS } from "./repository.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  return sign + sym + Math.round(abs).toLocaleString("uk-UA");
}

const KIND_COLORS = {
  deposit:         "var(--gain)",
  withdrawal:      "var(--oxblood)",
  lot_purchase:    "var(--ink-mute)",
  lot_redemption:  "var(--gain)",
  coupon_received: "var(--gain)",
  transfer_out:    "var(--indigo)",
  transfer_in:     "var(--indigo)",
  fee:             "var(--oxblood)",
  manual:          "var(--ink-mute)",
};

export function TransactionsPanel({ accountFilter }) {
  const { list: txs, loading, deposit, withdraw, transfer, remove } = useTransactions({
    accountId: accountFilter === "all" ? undefined : accountFilter,
    limit: 200,
  });
  const { list: accounts } = useAccounts();
  const { list: brokers } = useBrokers();
  const [modalMode, setModalMode] = useState(null); // null | 'deposit' | 'withdraw' | 'transfer'
  const [opErr, setOpErr] = useState(null);

  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const brokersById = useMemo(() => new Map(brokers.map(b => [b.id, b])), [brokers]);

  const handleSubmit = async (payload) => {
    setOpErr(null);
    try {
      if (modalMode === "deposit")      await deposit(payload);
      else if (modalMode === "withdraw") await withdraw(payload);
      else if (modalMode === "transfer") await transfer(payload);
      setModalMode(null);
    } catch (e) { setOpErr(e.message); }
  };

  const handleRemove = async (id, kind) => {
    if (kind === "lot_purchase" || kind === "lot_redemption" || kind === "coupon_received") {
      alert("Цю транзакцію не можна видалити вручну — вона пов'язана з лотом або купоном.");
      return;
    }
    if (!confirm("Видалити транзакцію?")) return;
    setOpErr(null);
    try { await remove(id); }
    catch (e) { setOpErr(e.message); }
  };

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  return (
    <div className="transactions-panel">
      {opErr && <div className="portfolio-error">⚠ {opErr}</div>}

      <div className="lots-actions">
        <button className="add-btn" onClick={() => setModalMode("deposit")}>+ Поповнити</button>
        <button className="add-btn" onClick={() => setModalMode("withdraw")}>− Зняти</button>
        {accounts.length >= 2 && (
          <button className="add-btn" onClick={() => setModalMode("transfer")}>↔ Переказ</button>
        )}
      </div>

      {txs.length === 0 ? (
        <div className="portfolio-empty">Жодної транзакції. Поповніть рахунок або купіть облігацію.</div>
      ) : (
        <div className="tx-list">
          {txs.map(t => {
            const acc = accountsById.get(t.accountId);
            const counterAcc = t.counterAccountId ? accountsById.get(t.counterAccountId) : null;
            const cur = t.currency || "UAH";
            const kindLabel = CASH_KINDS[t.kind]?.label || t.kind;
            return (
              <div key={t.id} className="tx-row" style={{ "--owner-color": acc?.color || "var(--brass)" }}>
                <span className="tx-date">{t.date?.slice(0, 10)}</span>
                <span className="tx-account">{acc?.emoji} {acc?.name || "—"}</span>
                <span className="tx-kind" style={{ color: KIND_COLORS[t.kind] || "var(--paper-dim)" }}>
                  {kindLabel}
                  {counterAcc && <span className="tx-counter">{" "}↔ {counterAcc.emoji} {counterAcc.name}</span>}
                </span>
                <span className="tx-notes">{t.notes}</span>
                <span className="tx-amount" style={{ color: t.amount >= 0 ? "var(--gain)" : "var(--oxblood)" }}>
                  {fmt(t.amount, cur)}
                </span>
                <button className="tx-remove" onClick={() => handleRemove(t.id, t.kind)} aria-label="Видалити">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {modalMode && (
        <CashOpForm
          mode={modalMode}
          accounts={accounts}
          brokersById={brokersById}
          defaultAccountId={accountFilter === "all" ? null : accountFilter}
          onSubmit={handleSubmit}
          onCancel={() => setModalMode(null)}
        />
      )}
    </div>
  );
}
