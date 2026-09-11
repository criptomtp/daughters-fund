import { useState } from "react";
import { usePersons } from "./hooks/usePersons.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { accounts as accountsRepo } from "./repository.js";
import { ageInYears, goalProgress, avgMonthlyDeposits, projectedAtRate } from "./calculations.js";
import { useTransactions, useCashBalance } from "./hooks/useTransactions.js";
import { coinPriceUAH, COINS } from "./useMarket.js";
import { BUILD_ID } from "../buildId.js";
import { AccountsManager } from "./AccountsManager.jsx";
import { BondsManager } from "./BondsManager.jsx";
import { LotsManager } from "./LotsManager.jsx";
import { TransactionsPanel } from "./TransactionsPanel.jsx";
import { BackupPanel } from "./BackupPanel.jsx";
import { CouponCalendar } from "./CouponCalendar.jsx";
import { MaturityLadder } from "./MaturityLadder.jsx";
import { AnalyticsPanel } from "./AnalyticsPanel.jsx";
import { PositionsPanel } from "./PositionsPanel.jsx";

const money = (n) => (n == null || !isFinite(n) ? "—" : "₴" + Math.round(n).toLocaleString("uk-UA"));

/**
 * Поле з локальним чернетковим станом, яке зберігається при втраті фокуса.
 *
 * Раніше тут був `defaultValue` (неконтрольований інпут): значення показувалось
 * зі старого рендера, і введене ім'я могло не доїхати до бази. Тепер стан
 * локальний, а зовнішня зміна (імпорт) підхоплюється звіркою під час рендера —
 * без ефектів, тож і без зайвих каскадних рендерів.
 */
function LiveField({ value, onSave, ...rest }) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value ?? "");
  }
  return (
    <input {...rest} className="form-input" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onSave(draft)} />
  );
}

const SECTIONS = [
  { id: "kids",      title: "Доньки",      hint: "дати народження, цілі" },
  { id: "positions", title: "Позиції",     hint: "по випусках, твоя дохідність проти ринку" },
  { id: "accounts",  title: "Рахунки",     hint: "брокери, залишки, крипта" },
  { id: "bonds",     title: "Облігації",   hint: "довідник випусків" },
  { id: "records",   title: "Записи",      hint: "виправити лот або транзакцію" },
  { id: "analytics", title: "Аналітика",   hint: "крива, погашення, прогноз" },
  { id: "backup",    title: "Бекап",       hint: "експорт та відновлення" },
];

export function DetailsScreen({ open, onOpen, onClose, market }) {
  if (open) {
    const section = SECTIONS.find(s => s.id === open);
    return (
      <div className="screen details-sub">
        <header className="sub-head">
          <button className="back-btn" onClick={onClose} aria-label="Назад">‹</button>
          <h1 className="screen-title">{section?.title || ""}</h1>
        </header>
        {open === "kids" && <KidsPanel market={market} />}
        {open === "positions" && <PositionsPanel />}
        {open === "accounts" && <AccountsPanel market={market} />}
        {open === "bonds" && <BondsManager />}
        {open === "records" && <RecordsPanel />}
        {open === "analytics" && <AnalyticsPanel />}
        {open === "backup" && <BackupPanel />}
      </div>
    );
  }

  return (
    <div className="screen details">
      <header className="screen-head"><h1 className="screen-title">Деталі</h1></header>
      <nav className="detail-list">
        {SECTIONS.map(s => (
          <button key={s.id} className="detail-item" onClick={() => onOpen(s.id)}>
            <span className="detail-title">{s.title}</span>
            <span className="detail-hint">{s.hint}</span>
            <span className="detail-chev">›</span>
          </button>
        ))}
      </nav>
      <p className="build-stamp">збірка {BUILD_ID}</p>
    </div>
  );
}

// ── Доньки ─────────────────────────────────────────────────────────────────
// Дата народження раніше була безіменним інпутом 11px у дев'ятій секції знизу,
// і поки вона порожня, блок цілей мовчки не існував. Тепер це перший екран
// у «Деталях», з явним підписом і поясненням, навіщо вона потрібна.

const RATE_KEY = "df_expected_return";
const loadRate = () => {
  try { const v = Number(localStorage.getItem(RATE_KEY)); return Number.isFinite(v) && v > 0 ? v : 15; }
  catch { return 15; }
};

function KidsPanel({ market }) {
  const { list: persons, update } = usePersons();
  const { list: accounts } = useAccounts();
  const { list: lots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: txs } = useTransactions({ limit: 100000 });
  const [err, setErr] = useState(null);
  const [rate, setRate] = useState(loadRate);

  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));

  const cryptoByAccount = new Map(accounts.filter(a => a.kind === "exchange").map(a => [
    a.id,
    Object.entries(a.holdings || {}).reduce((s, [t, amt]) => {
      const p = coinPriceUAH(t, market);
      return s + (p ? p * (Number(amt) || 0) : 0);
    }, 0),
  ]));
  const cashByAccount = new Map();
  for (const t of txs) {
    const cur = t.currency || "UAH";
    const prev = cashByAccount.get(t.accountId) || {};
    prev[cur] = (prev[cur] || 0) + (Number(t.amount) || 0);
    cashByAccount.set(t.accountId, prev);
  }

  const saveRate = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    setRate(n);
    try { localStorage.setItem(RATE_KEY, String(n)); } catch { /* ignore */ }
  };
  const kids = persons.filter(p => p.type === "child");

  const patch = async (id, data) => {
    setErr(null);
    try { await update(id, data); }
    catch (e) { setErr(e.message); }
  };

  const factMonthly = avgMonthlyDeposits({ transactions: txs, currency: "UAH", months: 6 });

  return (
    <div className="panel">
      {err && <div className="portfolio-error">⚠ {err}</div>}

      <section className="kid-card">
        <label className="form-field">
          <span className="form-label">Очікувана дохідність, % на рік</span>
          <LiveField type="number" inputMode="decimal" value={rate} onSave={saveRate} />
          <span className="form-hint">
            Під цю ставку рахується, скільки треба відкладати щомісяця. ОВДП сьогодні дають ~17%,
            але половина внесків іде в крипту — постав те, у що справді віриш на 12+ років.
          </span>
        </label>
      </section>

      {kids.length === 0 && <p className="sheet-empty">Ще нікого не додано.</p>}

      {kids.map(p => {
        const age = p.birthDate ? ageInYears(p.birthDate) : null;
        const yearsLeft = age != null ? Math.max(0, 18 - age) : null;
        const goal = goalProgress({
          person: p, accounts, lots, bondsByIsin,
          cashByAccount, extraByAccount: cryptoByAccount, annualReturnPct: rate,
        });
        return (
          <section key={p.id} className="kid-card">
            <label className="form-field">
              <span className="form-label">Ім'я</span>
              <LiveField value={p.name}
                onSave={v => patch(p.id, { name: v.trim() || "Без імені" })} />
            </label>

            <label className="form-field">
              <span className="form-label">Дата народження</span>
              <input type="date" className="form-input"
                value={p.birthDate ? p.birthDate.slice(0, 10) : ""}
                onChange={e => patch(p.id, { birthDate: e.target.value || null })} />
              <span className="form-hint">
                {age != null
                  ? `${Math.floor(age)} р. — до 18-річчя ${yearsLeft.toFixed(1)} р.`
                  : "Без неї не рахується, чи встигаєш накопичити до 18 років"}
              </span>
            </label>

            <label className="form-field">
              <span className="form-label">Ціль, ₴</span>
              <LiveField type="number" inputMode="decimal"
                value={p.targetAmount ?? ""} placeholder="напр. 1 000 000"
                onSave={v => patch(p.id, { targetAmount: v ? Number(v) : null })} />
            </label>

            {goal ? (
              <div className="goal-box">
                <div className="goal-line">
                  зараз {money(goal.currentValue)} з {money(goal.targetAmount)} — {Math.round(goal.progress * 100)}%
                </div>
                <div className="goal-bar"><span style={{ width: `${Math.min(100, goal.progress * 100)}%` }} /></div>
                <div className="goal-sub">
                  щоб встигнути під {rate}%: <strong>{money(goal.requiredMonthly)}/міс</strong>
                  {" · "}фактично вносиш {money(factMonthly)}/міс
                  {goal.requiredMonthly != null && (
                    <strong className={factMonthly >= goal.requiredMonthly ? " up" : " down"}>
                      {factMonthly >= goal.requiredMonthly ? " встигаєш" : " не встигаєш"}
                    </strong>
                  )}
                </div>
                <div className="goal-sub">
                  за поточного темпу до 18-річчя вийде{" "}
                  <strong>{money(projectedAtRate({
                    current: goal.currentValue, monthly: factMonthly,
                    years: goal.yearsLeft, annualReturnPct: rate,
                  }))}</strong>
                </div>
              </div>
            ) : (
              <p className="form-hint">Заповни дату народження і ціль — тут з'явиться план.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Рахунки ────────────────────────────────────────────────────────────────

function AccountsPanel({ market }) {
  const { list: accounts } = useAccounts();
  const exchanges = accounts.filter(a => a.kind === "exchange");

  return (
    <div className="panel">
      {exchanges.map(a => <CryptoAccountCard key={a.id} account={a} market={market} />)}
      <AccountsManager />
    </div>
  );
}

function CryptoAccountCard({ account, market }) {
  const holdings = account.holdings || {};
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(COINS.map(c => [c, holdings[c] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const balances = useCashBalance(account.id);

  const value = COINS.reduce((s, c) => {
    const p = coinPriceUAH(c, market);
    return s + (p ? p * (Number(draft[c]) || 0) : 0);
  }, 0);
  const invested = balances.UAH != null ? -(balances.UAH) : 0;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const next = {};
      for (const c of COINS) if (Number(draft[c]) > 0) next[c] = Number(draft[c]);
      await accountsRepo.update(account.id, { holdings: next, holdingsAt: new Date().toISOString() });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="crypto-card">
      <h3 className="panel-title">{account.name}</h3>
      <p className="form-hint">
        Біржа не віддає дані в браузер, тому залишок вводиться руками. Переоцінка — автоматична.
      </p>
      <div className="crypto-grid">
        {COINS.map(c => (
          <label key={c} className="form-field">
            <span className="form-label">{c}</span>
            <input type="number" inputMode="decimal" step="any" className="form-input"
              value={draft[c]} placeholder="0"
              onChange={e => setDraft(d => ({ ...d, [c]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="crypto-total">
        Оцінка: <strong>{money(value)}</strong>
        {invested > 0 && <> · заведено {money(invested)}</>}
        <span className="form-hint"> курс {market.uahPerUSD} ₴/$ · BTC ${market.btcUSD.toLocaleString("uk-UA")}</span>
      </div>
      {err && <div className="portfolio-error">⚠ {err}</div>}
      <button className="primary-action" onClick={save} disabled={busy}>
        {busy ? "Зберігаю…" : "Оновити залишок"}
      </button>
      {account.holdingsAt && (
        <p className="form-hint">останнє звіряння {String(account.holdingsAt).slice(0, 10)}</p>
      )}
    </section>
  );
}

// ── Записи ─────────────────────────────────────────────────────────────────
// Аварійний вихід: тут можна виправити або видалити помилково введений лот
// чи транзакцію. У щомісячному потоці сюди заходити не треба.

function RecordsPanel() {
  return (
    <div className="panel">
      <LotsManager accountFilter="all" />
      <TransactionsPanel accountFilter="all" />
    </div>
  );
}

// ── Аналітика ──────────────────────────────────────────────────────────────

// Аналітика живе в окремому файлі — там історія цін, відновлення серії
// й метрики просадок.
