import { useState, useMemo } from "react";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBonds } from "./hooks/useBonds.js";
import { useCashBalance } from "./hooks/useTransactions.js";
import { accruedFromSchedule } from "./calculations.js";
import { transactions as txRepo, lots as lotsRepo } from "./repository.js";

// Місячний ритуал в один екран: завів гроші → купив облігації.
// Раніше це були дві різні форми у двох різних секціях; тут все разом,
// із живим підрахунком «скільки штук влізе і що залишиться».

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
const PREFS_KEY = "df_quick_entry_prefs";

function money(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  return (CURRENCY_SYMBOL[cur] || "") + Math.round(n).toLocaleString("uk-UA");
}
function money2(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  return (CURRENCY_SYMBOL[cur] || "") + (Math.round(n * 100) / 100).toLocaleString("uk-UA");
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }
  catch { /* квота — не критично */ }
}

export function QuickEntry({ onDone }) {
  const { list: accounts } = useAccounts();
  const { list: bonds } = useBonds();

  const prefs = useMemo(loadPrefs, []);
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(prefs.accountId || "");
  const [isin, setIsin] = useState(prefs.isin || "");
  const [amount, setAmount] = useState(prefs.amount ?? 5000);
  const [price, setPrice] = useState(prefs.price ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  // Перший рахунок / перша облігація як розумний дефолт, якщо ще нічого не обирали
  const effAccountId = accountId || accounts[0]?.id || "";
  const effIsin = isin || bonds[0]?.isin || "";

  const account = accounts.find(a => a.id === effAccountId);
  const bond = bonds.find(b => b.isin === effIsin);
  const cur = bond?.currency || "UAH";

  const balances = useCashBalance(effAccountId);
  const cashNow = balances[cur] || 0;

  const deposit = Math.max(0, Number(amount) || 0);
  const dirty = Number(price) || 0;
  const available = cashNow + deposit;

  const qty = dirty > 0 ? Math.floor(available / dirty) : 0;
  const spend = qty * dirty;
  const leftover = available - spend;

  // Ціну брокер показує брудною (з НКД). Розкладаємо на чисту + НКД за реальним
  // графіком виплат — тоді дохідність лоту рахується правильно.
  const accruedPerPiece = bond ? accruedFromSchedule(bond, date) : 0;
  const cleanPerPiece = Math.max(0, dirty - accruedPerPiece);

  const nextPayment = useMemo(() => {
    const rows = Array.isArray(bond?.customSchedule) ? bond.customSchedule : [];
    const future = rows
      .filter(r => r?.date && r.date.slice(0, 10) > date)
      .sort((a, b) => a.date.localeCompare(b.date));
    return future[0] || null;
  }, [bond, date]);

  const canSubmit = !!account && !!bond && dirty > 0 && qty > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null); setDone(null);
    try {
      if (deposit > 0) {
        await txRepo.deposit({
          accountId: effAccountId,
          amount: deposit,
          currency: cur,
          date,
          notes: "Місячний внесок",
        });
      }
      await lotsRepo.add({
        isin: effIsin,
        accountId: effAccountId,
        purchaseDate: date,
        quantity: qty,
        purchasePrice: Math.round(cleanPerPiece * 100) / 100,
        accruedInterestPerPiece: Math.round(accruedPerPiece * 100) / 100,
        commission: 0,
        notes: "",
      });
      savePrefs({ accountId: effAccountId, isin: effIsin, amount: deposit, price: dirty });
      setDone(`Записано: +${money(deposit, cur)} і ${qty} шт ${effIsin}. Залишок ${money2(leftover, cur)}.`);
      onDone?.();
    } catch (e) {
      setErr(e.message || "Не вдалося записати.");
    } finally {
      setBusy(false);
    }
  };

  if (accounts.length === 0 || bonds.length === 0) return null;

  return (
    <div className="quick-entry">
      <button
        type="button"
        className="quick-entry-toggle"
        onClick={() => { setOpen(o => !o); setDone(null); setErr(null); }}
        aria-expanded={open}
      >
        <span className="quick-entry-toggle-main">⚡ Записати внесок і покупку</span>
        <span className="quick-entry-toggle-chev">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="quick-entry-body">
          <div className="quick-entry-grid">
            <label className="form-field">
              <span className="form-label">Рахунок</span>
              <select className="form-input" value={effAccountId} onChange={e => setAccountId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">Дата</span>
              <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
            </label>

            <label className="form-field">
              <span className="form-label">Поповнення, {CURRENCY_SYMBOL[cur] || cur}</span>
              <input type="number" inputMode="decimal" step="1" min="0" className="form-input"
                value={amount} onChange={e => setAmount(e.target.value)} />
              <span className="form-hint">на рахунку вже {money2(cashNow, cur)}</span>
            </label>

            <label className="form-field">
              <span className="form-label">Ціна брокера за 1 шт</span>
              <input type="number" inputMode="decimal" step="0.01" min="0" className="form-input"
                value={price} onChange={e => setPrice(e.target.value)} placeholder="напр. 1007.87" />
              <span className="form-hint">брудна, як показує ICU</span>
            </label>

            <label className="form-field form-field--full">
              <span className="form-label">Облігація</span>
              <select className="form-input" value={effIsin} onChange={e => setIsin(e.target.value)}>
                {bonds.map(b => (
                  <option key={b.isin} value={b.isin}>
                    {b.isin} · погашення {b.maturityDate?.slice(0, 10) || "?"} · купон {b.couponRate}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-entry-preview">
            {dirty <= 0 ? (
              <span className="quick-entry-hint">Введи ціну за штуку — покажу, скільки влізе.</span>
            ) : qty === 0 ? (
              <span className="quick-entry-warn">
                {money2(available, cur)} не вистачає навіть на одну облігацію ({money2(dirty, cur)}).
              </span>
            ) : (
              <>
                <div className="quick-entry-headline">
                  {money2(available, cur)} → <strong>{qty} шт</strong> за {money2(spend, cur)},
                  залишиться <strong>{money2(leftover, cur)}</strong>
                </div>
                <div className="quick-entry-detail">
                  чиста ціна {money2(cleanPerPiece, cur)} + НКД {money2(accruedPerPiece, cur)}
                  {nextPayment && (
                    <> · найближча виплата {nextPayment.date.slice(0, 10)} —{" "}
                      {money2((Number(nextPayment.amountPerPiece) || 0) * qty, cur)}</>
                  )}
                </div>
              </>
            )}
          </div>

          {err && <div className="portfolio-error">⚠ {err}</div>}
          {done && <div className="quick-entry-done">✓ {done}</div>}

          <button type="button" className="quick-entry-submit" onClick={submit} disabled={!canSubmit}>
            {busy ? "Записую…" : "Записати внесок і покупку"}
          </button>
        </div>
      )}
    </div>
  );
}
