import { useState } from "react";
import { usePersons } from "./hooks/usePersons.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { accounts as accountsRepo } from "./repository.js";
import { ageInYears, goalProgress, avgMonthlyDeposits, projectedAtRate,
  cashByPocketFrom, extraByPocketFrom, pocketShare, pocketCoins, accountCoins } from "./calculations.js";
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
import { usePockets } from "./hooks/usePockets.js";

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
  { id: "kids",      title: "Учасники",    hint: "дати народження, цілі" },
  { id: "pockets",   title: "Кишені",      hint: "чиї гроші на спільному рахунку" },
  { id: "positions", title: "Позиції",     hint: "по випусках, твоя дохідність проти ринку" },
  { id: "accounts",  title: "Рахунки",     hint: "брокери, залишки, крипта" },
  { id: "bonds",     title: "Облігації",   hint: "довідник випусків" },
  { id: "records",   title: "Записи",      hint: "виправити лот або транзакцію" },
  { id: "analytics", title: "Аналітика",   hint: "крива, погашення, прогноз" },
  { id: "backup",    title: "Бекап",       hint: "експорт та відновлення" },
];

export function DetailsScreen({ open, onOpen, onClose, market, pocket }) {
  if (open) {
    const section = SECTIONS.find(s => s.id === open);
    return (
      <div className="screen details-sub">
        <header className="sub-head">
          <button className="back-btn" onClick={onClose} aria-label="Назад">‹</button>
          <h1 className="screen-title">{section?.title || ""}</h1>
        </header>
        {open === "kids" && <KidsPanel market={market} pocket={pocket} />}
        {open === "pockets" && <PocketsPanel />}
        {open === "positions" && <PositionsPanel pocket={pocket} />}
        {open === "accounts" && <AccountsPanel market={market} pocket={pocket} />}
        {open === "bonds" && <BondsManager />}
        {open === "records" && <RecordsPanel pocket={pocket} />}
        {open === "analytics" && <AnalyticsPanel pocket={pocket} />}
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

function KidsPanel({ market, pocket }) {
  const { list: persons, update } = usePersons();
  const { list: accounts } = useAccounts();
  const { list: lots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: txs } = useTransactions({ limit: 100000 });
  const [err, setErr] = useState(null);
  const [rate, setRate] = useState(loadRate);

  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));

  const cryptoAccounts = accounts.filter(a => a.kind === "exchange");
  const extraByPocket = extraByPocketFrom({
    accounts: cryptoAccounts,
    priceOf: (ticker) => coinPriceUAH(ticker, market) || 0,
  });
  const cashByPocket = cashByPocketFrom(txs);

  const saveRate = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    setRate(n);
    try { localStorage.setItem(RATE_KEY, String(n)); } catch { /* ignore */ }
  };
  // У просторі «Я» дітей немає — показуємо учасників активної кишені.
  const kids = pocket
    ? persons.filter(p => pocketShare(pocket, p.id) > 0)
    : persons.filter(p => p.type === "child");

  const patch = async (id, data) => {
    setErr(null);
    try { await update(id, data); }
    catch (e) { setErr(e.message); }
  };

  const pocketTxs = pocket ? txs.filter(t => t.pocketId === pocket.id) : txs;
  const factMonthly = avgMonthlyDeposits({ transactions: pocketTxs, currency: "UAH", months: 6 });

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
          person: p, pockets: pocket ? [pocket] : [], lots, bondsByIsin,
          cashByPocket, extraByPocket, annualReturnPct: rate,
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

function AccountsPanel({ market, pocket }) {
  const { list: accounts } = useAccounts();
  const exchanges = accounts.filter(a => a.kind === "exchange");

  return (
    <div className="panel">
      {exchanges.map(a => <CryptoAccountCard key={a.id} account={a} market={market} pocket={pocket} />)}
      <AccountsManager />
    </div>
  );
}

function CryptoAccountCard({ account, market, pocket }) {
  // Залишок вводиться для КОНКРЕТНОЇ кишені. Спільне число тут було б
  // неправдою: біржа показує суму монет обох сторін, а належить кожна
  // монета комусь одному.
  const pocketId = pocket?.id || null;
  const mine = pocketCoins(account, pocketId);
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(COINS.map(c => [c, mine[c] ?? ""])));
  const [seenPocket, setSeenPocket] = useState(pocketId);
  if (pocketId !== seenPocket) {
    setSeenPocket(pocketId);
    setDraft(Object.fromEntries(COINS.map(c => [c, mine[c] ?? ""])));
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const balances = useCashBalance(account.id);

  const value = COINS.reduce((s, c) => {
    const p = coinPriceUAH(c, market);
    return s + (p ? p * (Number(draft[c]) || 0) : 0);
  }, 0);
  const invested = balances.UAH != null ? -(balances.UAH) : 0;
  const total = accountCoins(account);

  const save = async () => {
    if (!pocketId) { setErr("Спершу обери простір"); return; }
    setBusy(true); setErr(null);
    try {
      const next = {};
      for (const c of COINS) if (Number(draft[c]) > 0) next[c] = Number(draft[c]);
      const byPocket = { ...(account.holdingsByPocket || {}), [pocketId]: next };
      await accountsRepo.update(account.id, {
        holdingsByPocket: byPocket, holdingsAt: new Date().toISOString(),
      });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="crypto-card">
      <h3 className="panel-title">{account.name}</h3>
      <p className="form-hint">
        Біржа не віддає дані в браузер, тому залишок вводиться руками.
        Тут — частка кишені «{pocket?.name || "—"}». На біржі разом:{" "}
        {Object.entries(total).map(([c, a]) => `${a} ${c}`).join(" · ") || "нічого"}.
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

function RecordsPanel({ pocket }) {
  return (
    <div className="panel">
      <LotsManager accountFilter="all" pocket={pocket} />
      <TransactionsPanel accountFilter="all" pocket={pocket} />
    </div>
  );
}

// ── Аналітика ──────────────────────────────────────────────────────────────

// Аналітика живе в окремому файлі — там історія цін, відновлення серії
// й метрики просадок.

/**
 * Керування кишенями: хто в них і з якою вагою.
 *
 * Тут же — застереження про те, чим кишеня НЕ є. Юридично власність визначає
 * запис на рахунку в депозитарії (ЗУ «Про депозитарну систему», ст. 8 ч. 1),
 * а Сімейний кодекс ст. 173 ч. 2 прямо презюмує майно дітей, які живуть із
 * батьками, власністю батьків. Тому застосунок ніде не пише «власність».
 */
function PocketsPanel() {
  const { list: pockets, update } = usePockets();
  const { list: persons } = usePersons();
  const [err, setErr] = useState(null);

  const patch = async (id, data) => {
    setErr(null);
    try { await update(id, data); }
    catch (e) { setErr(e.message); }
  };

  const toggle = async (pocket, personId) => {
    const w = { ...(pocket.memberWeights || {}) };
    if (w[personId]) delete w[personId];
    else w[personId] = 1;
    await patch(pocket.id, { memberWeights: w });
  };

  return (
    <div className="panel">
      {err && <div className="portfolio-error">⚠ {err}</div>}

      <p className="an-sub">
        Кишеня — це облік, а не власність. Юридично все, що лежить на рахунку,
        належить тому, на кого рахунок оформлено.
      </p>

      {pockets.map(pk => {
        const weights = pk.memberWeights || {};
        const total = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0);
        return (
          <section key={pk.id} className="kid-card">
            <label className="form-field">
              <span className="form-label">Назва</span>
              <LiveField value={pk.name} onSave={v => patch(pk.id, { name: v.trim() || pk.name })} />
            </label>

            <span className="form-label">Учасники</span>
            {persons.map(p => {
              const w = Number(weights[p.id]) || 0;
              return (
                <div key={p.id} className="pocket-member">
                  <button
                    className={`ghost-action ${w > 0 ? "on" : ""}`}
                    onClick={() => toggle(pk, p.id)}>
                    {w > 0 ? "✓" : "+"} {p.name}
                  </button>
                  {w > 0 && (
                    <>
                      <LiveField type="number" inputMode="decimal" value={w}
                        onSave={v => {
                          const n = Number(v);
                          if (!Number.isFinite(n) || n <= 0) return;
                          patch(pk.id, { memberWeights: { ...weights, [p.id]: n } });
                        }} />
                      <span className="an-sub">
                        {total > 0 ? Math.round((w / total) * 100) + "%" : "—"}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {total === 0 && (
              <p className="portfolio-error">
                ⚠ Кишеня без учасників: усе, що в ній, рахуватиметься як нічиє.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
