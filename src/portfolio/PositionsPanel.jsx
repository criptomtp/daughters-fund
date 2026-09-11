import { useEffect, useState } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { groupPositions } from "./calculations.js";
import { lots as lotsRepo } from "./repository.js";

// Позиції — один рядок на випуск, а не на кожну покупку.
// Купуючи щомісяця один папір, за рік маєш дванадцять лотів; для власника
// це одна позиція, окремі покупки потрібні лише щоб виправити або продати.

const money = (n) => (n == null || !isFinite(n) ? "—" : "₴" + Math.round(n).toLocaleString("uk-UA"));
const money2 = (n) => (n == null || !isFinite(n) ? "—" : "₴" + (Math.round(n * 100) / 100).toLocaleString("uk-UA"));
const day = (d) => String(d || "").slice(0, 10);

export function PositionsPanel({ pocket }) {
  const { list: allLots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: coupons } = useCoupons({});
  const { list: accounts } = useAccounts();

  const [now] = useState(() => new Date().toISOString());
  const [openIsin, setOpenIsin] = useState(null);
  const [selling, setSelling] = useState(null);
  const [market, setMarket] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    // Знімок ринкових дохідностей лежить поруч із застосунком: НБУ віддає
    // реальні угоди лише 9-мегабайтним xlsx, який у браузері не розібрати.
    fetch("/market-yields.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setMarket(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const pocketId = pocket?.id || null;
  const lots = pocketId ? allLots.filter(l => l.pocketId === pocketId) : allLots;

  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));
  const accById = new Map(accounts.map(a => [a.id, a]));
  const positions = groupPositions({ lots, bondsByIsin, coupons, asOfDate: now });

  const closed = lots.filter(l => l.closedAt && day(l.closedAt) <= day(now));

  const doSell = async (lot, amount, date) => {
    setErr(null);
    try {
      await lotsRepo.sell(lot.id, { date, amount: Number(amount) });
      setSelling(null);
    } catch (e) { setErr(e.message); }
  };

  if (positions.length === 0) return <p className="sheet-empty">Відкритих позицій немає.</p>;

  return (
    <div className="panel">
      {err && <div className="portfolio-error">⚠ {err}</div>}

      {positions.map(p => {
        const mk = market?.yields?.[p.isin];
        const diff = mk && p.ytm != null ? p.ytm - mk.ytm : null;
        const isOpen = openIsin === p.isin;
        return (
          <section key={p.isin} className="pos-card">
            <button className="pos-head" onClick={() => setOpenIsin(isOpen ? null : p.isin)}>
              <span className="pos-name">{p.bond.ticker || p.isin}</span>
              <span className="pos-value">{money(p.value)}</span>
              <span className="pos-meta">
                {p.quantity} шт · до {day(p.bond.maturityDate)} ·{" "}
                {p.accountIds.map(id => accById.get(id)?.name).filter(Boolean).join(", ")}
              </span>
              <span className={`pos-gain ${p.gain >= 0 ? "up" : "down"}`}>
                {p.gain >= 0 ? "+" : ""}{money(p.gain)}
              </span>
            </button>

            <div className="pos-yield">
              {p.ytm != null && <span>твоя {p.ytm.toFixed(2)}%</span>}
              {mk ? (
                <>
                  <span className="pos-sep">·</span>
                  <span>ринок {mk.ytm.toFixed(2)}%</span>
                  <span className={diff >= 0 ? "up" : "down"}>
                    {" "}({diff >= 0 ? "+" : ""}{diff.toFixed(2)})
                  </span>
                </>
              ) : (
                <><span className="pos-sep">·</span><span className="pos-dim">ринкової ціни немає</span></>
              )}
            </div>

            {isOpen && (
              <div className="pos-lots">
                {p.lots.map(l => (
                  <div key={l.id} className="pos-lot">
                    <span>{day(l.purchaseDate)}</span>
                    <span>{l.quantity} шт × {money2(l.purchasePrice + (l.accruedInterestPerPiece || 0))}</span>
                    <button className="ghost-action" onClick={() => setSelling({
                      lot: l, amount: Math.round(l.quantity * (l.purchasePrice + (l.accruedInterestPerPiece || 0))),
                      date: day(now),
                    })}>Продати</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {market?.asOf && (
        <p className="an-sub">Ринкові дохідності — реальні угоди вторинного ринку, дані НБУ на {market.asOf}.</p>
      )}

      {closed.length > 0 && (
        <section className="an-card">
          <span className="strip-label">Закриті позиції</span>
          <div className="an-rows">
            {closed.map(l => (
              <div key={l.id}>
                <span>{bondsByIsin.get(l.isin)?.ticker || l.isin} · {l.quantity} шт</span>
                <strong>{l.closedReason === "sale" ? "продано" : "погашено"} {day(l.closedAt)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {selling && (
        <div className="sheet-backdrop" onClick={() => setSelling(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <button className="sheet-grabber" onClick={() => setSelling(null)} aria-label="Закрити" />
            <h3 className="panel-title">Продаж лоту</h3>
            <p className="an-sub">
              {selling.lot.quantity} шт {bondsByIsin.get(selling.lot.isin)?.ticker || selling.lot.isin},
              куплено {day(selling.lot.purchaseDate)}. Виплати після дати продажу буде знято з розкладу.
            </p>
            <label className="big-field">
              <span className="big-label">Отримано, ₴</span>
              <div className="big-input-row">
                <span className="big-cur">₴</span>
                <input type="number" inputMode="decimal" step="0.01" className="big-input" autoFocus
                  value={selling.amount} onChange={e => setSelling(s => ({ ...s, amount: e.target.value }))} />
              </div>
            </label>
            <label className="form-field">
              <span className="form-label">Дата продажу</span>
              <input type="date" className="form-input" value={selling.date}
                onChange={e => setSelling(s => ({ ...s, date: e.target.value }))} />
            </label>
            <button className="primary-action"
              onClick={() => doSell(selling.lot, selling.amount, selling.date)}>
              Записати продаж
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
