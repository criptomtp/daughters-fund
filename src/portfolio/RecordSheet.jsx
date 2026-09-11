import { useMemo, useState } from "react";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBonds } from "./hooks/useBonds.js";
import { useLots } from "./hooks/useLots.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { useCashBalance } from "./hooks/useTransactions.js";
import { accruedFromSchedule, groupCouponEvents, pocketCoins } from "./calculations.js";
import { transactions as txRepo, lots as lotsRepo, coupons as couponsRepo } from "./repository.js";
import { coinPriceUAH, COINS } from "./useMarket.js";

// Лист запису — єдине місце, де щось вноситься руками.
// Три сегменти в порядку частоти: внесок+купівля (12/рік), купон (4/рік),
// переказ (2-5/рік). Найчастіша дія відкрита одразу, без зайвого тапу.

const SYM = { UAH: "₴", USD: "$", EUR: "€" };
const PREFS = "df_record_prefs";
const money = (n, c = "UAH") =>
  n == null || !isFinite(n) ? "—" : (SYM[c] || "") + (Math.round(n * 100) / 100).toLocaleString("uk-UA");
const money0 = (n, c = "UAH") =>
  n == null || !isFinite(n) ? "—" : (SYM[c] || "") + Math.round(n).toLocaleString("uk-UA");
const today = () => new Date().toISOString().slice(0, 10);

const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...p })); } catch { /* ignore */ } };

export function RecordSheet({ open, onClose, initialTab = "buy", market, pocket, pockets = [] }) {
  const [tab, setTab] = useState(initialTab);
  const [pocketId, setPocketId] = useState(null);
  if (!open) return null;

  // За замовчуванням записуємо в той простір, у якому ти зараз. Міняти
  // доводиться рідко, тож вибір показуємо лише коли кишень більше однієї.
  const activeId = pocketId || pocket?.id || pockets[0]?.id || null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Запис">
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="sheet-grabber" onClick={onClose} aria-label="Закрити" />
        <div className="seg" role="tablist">
          {[["buy", "Внесок і купівля"], ["coupon", "Купон"], ["transfer", "Переказ"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id}
              className={`seg-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {pockets.length > 1 && (
          <label className="form-field pocket-pick">
            <span className="form-label">Чиї гроші</span>
            <div className="ph-pick">
              {pockets.map(pk => (
                <button key={pk.id} type="button"
                  className={`seg-btn ${pk.id === activeId ? "active" : ""}`}
                  onClick={() => setPocketId(pk.id)}>
                  {pk.emoji} {pk.name}
                </button>
              ))}
            </div>
          </label>
        )}
        <div className="sheet-body">
          {tab === "buy" && <BuyForm onDone={onClose} market={market} pocketId={activeId} />}
          {tab === "coupon" && <CouponForm onDone={onClose} />}
          {tab === "transfer" && <TransferForm onDone={onClose} pocketId={activeId} pockets={pockets} />}
        </div>
      </div>
    </div>
  );
}

// ── Внесок і купівля ───────────────────────────────────────────────────────

function BuyForm({ onDone, market, pocketId }) {
  const { list: accounts } = useAccounts();
  const { list: bonds } = useBonds();
  const prefs = useMemo(() => loadPrefs(), []);

  const [accountId, setAccountId] = useState(prefs.accountId || "");
  // null = ще не обирали (беремо дефолт), "" = свідомо «без покупки»
  const [isin, setIsin] = useState(prefs.isin ?? null);
  const [date, setDate] = useState(today);
  const [deposit, setDeposit] = useState(prefs.deposit ?? 5000);
  const [price, setPrice] = useState("");
  const [coin, setCoin] = useState("BTC");
  const [coinAmount, setCoinAmount] = useState("");
  const [qtyOverride, setQtyOverride] = useState(null);
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const effAccountId = accountId || accounts[0]?.id || "";
  const effIsin = isin === null ? (bonds[0]?.isin || "") : isin;
  const account = accounts.find(a => a.id === effAccountId);
  // Біржовий рахунок ведеться інакше: облігацій там немає, є монети,
  // і заводяться туди долари, а не гривня.
  const isExchange = account?.kind === "exchange";
  const isExchangeInput = isExchange;
  const bond = isExchange ? null : bonds.find(b => b.isin === effIsin);
  const cur = bond?.currency || account?.primaryCurrency || "UAH";

  const balances = useCashBalance(effAccountId);
  const cashNow = balances[cur] || 0;

  // На біржу заходять долари. Внутрішній облік фонду ведеться в гривні, тому
  // одразу переводимо за поточним курсом НБУ — так само, як зроблено для
  // історичних поповнень (кожне записане в гривні за курсом своєї дати).
  const depRaw = Math.max(0, Number(deposit) || 0);
  const fxRate = Number(market?.uahPerUSD) || 0;
  const dep = isExchangeInput ? Math.round(depRaw * fxRate * 100) / 100 : depRaw;
  const dirty = Number(price) || 0;
  const available = cashNow + dep;
  const maxQty = dirty > 0 ? Math.floor(available / dirty) : 0;
  const qty = qtyOverride != null ? Math.max(0, Math.min(qtyOverride, maxQty)) : maxQty;
  const spend = qty * dirty;
  const leftover = available - spend;

  const accrued = bond ? accruedFromSchedule(bond, date) : 0;
  const clean = Math.max(0, dirty - accrued);

  const schedule = Array.isArray(bond?.customSchedule) ? bond.customSchedule : [];
  const nextPay = schedule
    .filter(r => r?.date && r.date.slice(0, 10) > date)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  const coins = Number(coinAmount) || 0;
  const coinPrice = isExchange ? coinPriceUAH(coin, market) : null;

  // Внесок без покупки — теж повноцінний запис. Саме цього не вміла стара форма.
  const canSubmit = !!account && !busy &&
    (isExchange ? (dep > 0 || coins > 0) : (dep > 0 || qty > 0));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      if (dep > 0) {
        await txRepo.deposit({
          accountId: effAccountId, pocketId, amount: dep, currency: cur, date,
          notes: isExchange ? `Поповнення біржі $${depRaw.toFixed(2)} (курс ${fxRate})` : "Внесок",
        });
      }
      if (isExchange && coins > 0) {
        await txRepo.cryptoBuy({
          accountId: effAccountId, pocketId, amount: dep, ticker: coin,
          coinAmount: coins, currency: cur, date,
        });
      }
      if (!isExchange && qty > 0 && bond) {
        await lotsRepo.add({
          isin: effIsin, accountId: effAccountId, pocketId, purchaseDate: date, quantity: qty,
          purchasePrice: Math.round(clean * 100) / 100,
          accruedInterestPerPiece: Math.round(accrued * 100) / 100,
          commission: 0, notes: "",
        });
      }
      savePrefs({ accountId: effAccountId, isin: effIsin, deposit: depRaw });
      onDone?.();
    } catch (e) {
      setErr(e.message || "Не вдалося записати");
      setBusy(false);
    }
  };

  if (accounts.length === 0) {
    return <p className="sheet-empty">Спершу створи рахунок: Деталі → Рахунки.</p>;
  }

  return (
    <>
      <button className="context-row" onClick={() => setShowContext(v => !v)} aria-expanded={showContext}>
        <span>{account?.name || "рахунок"} · {isExchange ? coin : (bond ? (bond.ticker || bond.isin) : "без покупки")} · {date === today() ? "сьогодні" : date}</span>
        <span className="context-chev">{showContext ? "▾" : "▸"}</span>
      </button>

      {showContext && (
        <div className="context-fields">
          <label className="form-field">
            <span className="form-label">Рахунок</span>
            <select className="form-input" value={effAccountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {!isExchange && (
            <label className="form-field">
              <span className="form-label">Облігація</span>
              <select className="form-input" value={effIsin} onChange={e => { setIsin(e.target.value); setQtyOverride(null); }}>
                <option value="">— лише поповнення, без покупки —</option>
                {bonds.map(b => <option key={b.isin} value={b.isin}>{b.isin} · {b.ticker || ""}</option>)}
              </select>
            </label>
          )}
          <label className="form-field">
            <span className="form-label">Дата</span>
            <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
          </label>
        </div>
      )}

      <label className="big-field">
        <span className="big-label">{isExchange ? "Поповнення біржі, доларів" : "Поповнення"}</span>
        <div className="big-input-row">
          <span className="big-cur">{isExchange ? "$" : SYM[cur]}</span>
          <input type="number" inputMode="decimal" step={isExchange ? "0.01" : "1"} min="0" className="big-input"
            value={deposit} onChange={e => setDeposit(e.target.value)} />
        </div>
        <span className="big-hint">
          {isExchange
            ? (fxRate > 0
                ? `${money(dep, "UAH")} за курсом ${fxRate} ₴/$${date !== today() ? " — курс сьогоднішній" : ""}`
                : "курс ще не завантажився")
            : `на рахунку вже ${money(cashNow, cur)}`}
        </span>
      </label>

      {isExchange && (
        <label className="big-field">
          <span className="big-label">Куплено монет</span>
          <div className="big-input-row">
            <select className="coin-select" value={coin} onChange={e => setCoin(e.target.value)}>
              {COINS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" inputMode="decimal" step="any" min="0" className="big-input"
              value={coinAmount} onChange={e => setCoinAmount(e.target.value)} placeholder="0.00185" />
          </div>
          <span className="big-hint">
            зараз у цій кишені {Number(pocketCoins(account, pocketId)[coin] || 0).toFixed(8)} {coin}
          </span>
        </label>
      )}

      {bond && (
        <label className="big-field">
          <span className="big-label">Ціна за штуку — як показує брокер</span>
          <div className="big-input-row">
            <span className="big-cur">{SYM[cur]}</span>
            <input type="number" inputMode="decimal" step="0.01" min="0" className="big-input"
              autoFocus value={price} onChange={e => { setPrice(e.target.value); setQtyOverride(null); }}
              placeholder="1007.87" />
          </div>
        </label>
      )}

      <div className="calc-box">
        {isExchange ? (
          coins > 0 || dep > 0 ? (
            <>
              <div className="calc-line">
                на біржу заходить <strong>${depRaw.toFixed(2)}</strong> ({money(dep, "UAH")})
                {coins > 0 && <> · залишок стане{" "}
                  <strong>{(Number(pocketCoins(account, pocketId)[coin] || 0) + coins).toFixed(8)} {coin}</strong></>}
              </div>
              {coins > 0 && coinPrice && (
                <div className="calc-sub">
                  за курсом сьогодні це {money(coinPrice * coins, "UAH")}
                  {depRaw > 0 && <> · ціна входу ${Math.round(depRaw / coins).toLocaleString("uk-UA")} за {coin}</>}
                </div>
              )}
            </>
          ) : (
            <span className="calc-hint">Введи суму поповнення і скільки монет куплено.</span>
          )
        ) : !bond ? (
          <span className="calc-hint">Записується лише поповнення {money(dep, cur)}.</span>
        ) : dirty <= 0 ? (
          <span className="calc-hint">Доступно {money(available, cur)}. Введи ціну — покажу, скільки влізе.</span>
        ) : maxQty === 0 ? (
          <span className="calc-warn">{money(available, cur)} не вистачає навіть на одну облігацію.</span>
        ) : (
          <>
            <div className="calc-qty">
              <button className="qty-btn" onClick={() => setQtyOverride(Math.max(0, qty - 1))} disabled={qty <= 0}>−</button>
              <span className="qty-value">{qty} шт</span>
              <button className="qty-btn" onClick={() => setQtyOverride(Math.min(maxQty, qty + 1))} disabled={qty >= maxQty}>+</button>
            </div>
            <div className="calc-line">
              доступно {money(available, cur)} → спишеться <strong>{money(spend, cur)}</strong>, залишок {money(leftover, cur)}
            </div>
            <div className="calc-sub">
              чиста {money(clean, cur)} + НКД {money(accrued, cur)}
              {nextPay && <> · {nextPay.date.slice(0, 10)} надійде {money((Number(nextPay.amountPerPiece) || 0) * qty, cur)}</>}
            </div>
          </>
        )}
      </div>

      {err && <div className="portfolio-error">⚠ {err}</div>}

      <button className="primary-action" onClick={submit} disabled={!canSubmit}>
        {busy ? "Записую…" : "Записати"}
      </button>
    </>
  );
}

// ── Купон ──────────────────────────────────────────────────────────────────

function CouponForm({ onDone }) {
  const { list: lots } = useLots({});
  const { list: coupons } = useCoupons({});
  const { list: accounts } = useAccounts();
  const { list: bonds } = useBonds();
  const [busyKey, setBusyKey] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);

  const pending = useMemo(() => {
    const t = today();
    return groupCouponEvents(coupons, lots)
      .filter(e => e.status !== "received" && e.scheduledDate <= t)
      .reverse();
  }, [coupons, lots]);

  const upcoming = useMemo(() => {
    const t = today();
    return groupCouponEvents(coupons, lots).filter(e => e.status !== "received" && e.scheduledDate > t).slice(0, 3);
  }, [coupons, lots]);

  // Останні підтверджені — щоб суму можна було виправити пізніше,
  // коли з'ясується, що надійшло не рівно стільки, скільки планувалось.
  const done = useMemo(
    () => groupCouponEvents(coupons, lots).filter(e => e.status === "received").slice(-3).reverse(),
    [coupons, lots]
  );

  const confirm = async (ev, override) => {
    setBusyKey(ev.key); setErr(null);
    try {
      await couponsRepo.markGroupReceived(ev.couponIds, {
        actualDate: override?.date || ev.scheduledDate,
        actualAmount: override?.amount != null ? Number(override.amount) : undefined,
        accountId: override?.accountId || undefined,
      });
      setEditing(null);
      if (pending.length <= 1) onDone?.();
    } catch (e) { setErr(e.message || "Не вдалося записати"); }
    finally { setBusyKey(null); }
  };

  // Скасувати підтвердження — щоб перезаписати з правильною сумою.
  const undo = async (ev) => {
    setBusyKey(ev.key); setErr(null);
    try { await couponsRepo.markGroupScheduled(ev.couponIds); }
    catch (e) { setErr(e.message || "Не вдалося скасувати"); }
    finally { setBusyKey(null); }
  };

  const label = (ev) => {
    const b = bonds.find(x => x.isin === ev.isin);
    const a = accounts.find(x => x.id === ev.accountId);
    const cur = b?.currency || "UAH";
    return { cur, text: `${b?.ticker || ev.isin} · ${a?.name || ""}` };
  };

  return (
    <>
      {err && <div className="portfolio-error">⚠ {err}</div>}

      {pending.length === 0 && (
        <div className="coupon-empty">
          <p className="sheet-empty">Немає виплат, які чекають підтвердження.</p>
          {upcoming.length > 0 && (
            <ul className="upcoming-list">
              {upcoming.map(ev => {
                const { cur, text } = label(ev);
                return <li key={ev.key}><span>{ev.scheduledDate}</span><span>{text}</span><strong>{money(ev.amountNet, cur)}</strong></li>;
              })}
            </ul>
          )}
        </div>
      )}

      {done.length > 0 && (
        <section className="done-list">
          <span className="strip-label">Підтверджені</span>
          {done.map(ev => {
            const { cur, text } = label(ev);
            return (
              <div key={ev.key} className="done-row">
                <span className="done-meta">{ev.actualDate || ev.scheduledDate} · {text}</span>
                <span className="done-amount">{money(ev.actualAmount || ev.amountNet, cur)}</span>
                <button className="ghost-action" onClick={() => undo(ev)} disabled={busyKey === ev.key}>
                  Виправити
                </button>
              </div>
            );
          })}
        </section>
      )}

      {pending.map(ev => {
        const { cur, text } = label(ev);
        const isEditing = editing?.key === ev.key;
        return (
          <div key={ev.key} className="coupon-card">
            <div className="coupon-head">
              <span className="coupon-date">{ev.scheduledDate}</span>
              <span className="coupon-kind">{ev.kind === "coupon" ? "купон" : ev.kind === "redemption" ? "погашення" : "купон + погашення"}</span>
            </div>
            <div className="coupon-amount">{money(ev.amountNet, cur)}</div>
            <div className="coupon-meta">{text} · {ev.quantity} шт{ev.couponIds.length > 1 && ` · ${ev.couponIds.length} лоти`}</div>

            {isEditing ? (
              <div className="coupon-edit">
                <label className="form-field">
                  <span className="form-label">Фактична сума</span>
                  <input type="number" inputMode="decimal" step="0.01" className="form-input"
                    value={editing.amount} onChange={e => setEditing(s => ({ ...s, amount: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span className="form-label">Дата надходження</span>
                  <input type="date" className="form-input"
                    value={editing.date} onChange={e => setEditing(s => ({ ...s, date: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span className="form-label">Надійшло на рахунок</span>
                  <select className="form-input" value={editing.accountId}
                    onChange={e => setEditing(s => ({ ...s, accountId: e.target.value }))}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <span className="form-hint">за замовчуванням — рахунок, де лежить папір</span>
                </label>
                <div className="coupon-actions">
                  <button className="primary-action" onClick={() => confirm(ev, editing)} disabled={busyKey === ev.key}>Зберегти</button>
                  <button className="ghost-action" onClick={() => setEditing(null)}>Скасувати</button>
                </div>
              </div>
            ) : (
              <div className="coupon-actions">
                <button className="primary-action" onClick={() => confirm(ev)} disabled={busyKey === ev.key}>
                  {busyKey === ev.key ? "…" : "Так, надійшов"}
                </button>
                <button className="ghost-action"
                  onClick={() => setEditing({ key: ev.key, amount: Math.round(ev.amountNet * 100) / 100, date: ev.scheduledDate, accountId: ev.accountId })}>
                  Змінити
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Переказ ────────────────────────────────────────────────────────────────

function TransferForm({ onDone, pocketId }) {
  const { list: accounts } = useAccounts();
  const prefs = useMemo(() => loadPrefs(), []);
  const [fromId, setFromId] = useState(prefs.transferFrom || "");
  const [toId, setToId] = useState(prefs.transferTo || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const effFrom = fromId || accounts[0]?.id || "";
  const effTo = toId || accounts.find(a => a.id !== effFrom)?.id || "";
  const from = accounts.find(a => a.id === effFrom);
  const to = accounts.find(a => a.id === effTo);
  const cur = from?.primaryCurrency || "UAH";
  const balances = useCashBalance(effFrom);

  const amt = Number(amount) || 0;
  const canSubmit = from && to && effFrom !== effTo && amt > 0 && !busy;

  const swap = () => { setFromId(effTo); setToId(effFrom); };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      await txRepo.transfer({ fromAccountId: effFrom, toAccountId: effTo, pocketId, amount: amt, currency: cur, date, notes: "" });
      savePrefs({ transferFrom: effFrom, transferTo: effTo });
      onDone?.();
    } catch (e) { setErr(e.message || "Не вдалося записати"); setBusy(false); }
  };

  if (accounts.length < 2) {
    return <p className="sheet-empty">Переказ потребує двох рахунків. Додай другий у Деталі → Рахунки.</p>;
  }

  return (
    <>
      <div className="transfer-row">
        <select className="form-input" value={effFrom} onChange={e => setFromId(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="swap-btn" onClick={swap} title="Змінити напрямок" aria-label="Змінити напрямок">⇄</button>
        <select className="form-input" value={effTo} onChange={e => setToId(e.target.value)}>
          {accounts.filter(a => a.id !== effFrom).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <label className="big-field">
        <span className="big-label">Сума</span>
        <div className="big-input-row">
          <span className="big-cur">{SYM[cur]}</span>
          <input type="number" inputMode="decimal" step="1" min="0" className="big-input"
            autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <span className="big-hint">на {from?.name}: {money0(balances[cur] || 0, cur)}</span>
      </label>

      <label className="form-field">
        <span className="form-label">Дата</span>
        <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
      </label>

      {err && <div className="portfolio-error">⚠ {err}</div>}
      <button className="primary-action" onClick={submit} disabled={!canSubmit}>
        {busy ? "Записую…" : "Записати"}
      </button>
    </>
  );
}
