import { useMemo, useState } from "react";
import { useTransactions } from "./hooks/useTransactions.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { groupCouponEvents } from "./calculations.js";

// Історія — один журнал усіх записів. Купівля показується ОДНИМ рядком:
// у базі це лот + авто-списання готівки, але для власника це одна подія,
// і два рядки читались би як «купив двічі».

const SYM = { UAH: "₴", USD: "$", EUR: "€" };
const money = (n, c = "UAH") =>
  n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + (SYM[c] || "") + Math.abs(Math.round(n)).toLocaleString("uk-UA");

const KIND_LABEL = {
  deposit: "Поповнення",
  withdrawal: "Зняття",
  lot_purchase: "Купівля",
  lot_redemption: "Погашення",
  lot_sale: "Продаж",
  coupon_received: "Купон",
  crypto_buy: "Купівля крипти",
  transfer_out: "Переказ →",
  transfer_in: "→ Переказ",
  fee: "Комісія",
  manual: "Корекція",
};

const MONTHS = ["січня","лютого","березня","квітня","травня","червня",
  "липня","серпня","вересня","жовтня","листопада","грудня"];

function human(dateIso) {
  const d = String(dateIso).slice(0, 10).split("-");
  return `${Number(d[2])} ${MONTHS[Number(d[1]) - 1]}`;
}

export function HistoryScreen({ pocket }) {
  const { list: accounts } = useAccounts();
  const [filter, setFilter] = useState("all");
  const { list: allTxs } = useTransactions({
    accountId: filter === "all" ? undefined : filter,
    limit: 100000,
  });
  const { list: allLots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: coupons } = useCoupons({});

  // Історія показує один простір: у стрічці операцій чужі внески читались би
  // як власні, а найближчі виплати — як ті, що надійдуть тобі.
  const pocketId = pocket?.id || null;
  const txs  = useMemo(() => (pocketId ? allTxs.filter(t => t.pocketId === pocketId) : allTxs), [allTxs, pocketId]);
  const lots = useMemo(() => (pocketId ? allLots.filter(l => l.pocketId === pocketId) : allLots), [allLots, pocketId]);

  const bondByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);
  const lotById = useMemo(() => new Map(lots.map(l => [l.id, l])), [lots]);
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  const upcoming = useMemo(() => {
    const t = new Date().toISOString().slice(0, 10);
    return groupCouponEvents(coupons, lots)
      .filter(e => e.status !== "received" && e.scheduledDate > t)
      .slice(0, 3);
  }, [coupons, lots]);

  const groups = useMemo(() => {
    const sorted = [...txs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const out = [];
    let currentMonth = null;
    for (const t of sorted) {
      const m = String(t.date).slice(0, 7);
      if (m !== currentMonth) { currentMonth = m; out.push({ month: m, items: [] }); }
      out[out.length - 1].items.push(t);
    }
    return out;
  }, [txs]);

  const describe = (t) => {
    if (t.kind === "lot_purchase") {
      const lot = lotById.get(t.refId);
      const bond = lot && bondByIsin.get(lot.isin);
      return lot ? `${lot.quantity} шт · ${bond?.ticker || lot.isin}` : t.notes || "";
    }
    if (t.kind === "coupon_received" || t.kind === "lot_redemption") return t.notes || "";
    if (t.kind === "transfer_out" || t.kind === "transfer_in") {
      return accById.get(t.accountId)?.name || "";
    }
    return t.notes || "";
  };

  return (
    <div className="screen history">
      <header className="screen-head"><h1 className="screen-title">Історія</h1></header>

      {accounts.length > 1 && (
        <div className="chips">
          <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>Усі</button>
          {accounts.map(a => (
            <button key={a.id} className={`chip ${filter === a.id ? "active" : ""}`} onClick={() => setFilter(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="ahead">
          <span className="strip-label">Попереду</span>
          {upcoming.map(e => {
            const b = bondByIsin.get(e.isin);
            return (
              <div key={e.key} className="ahead-row">
                <span className="ahead-date">{human(e.scheduledDate)}</span>
                <span className="ahead-name">{b?.ticker || e.isin}</span>
                <span className="ahead-amount">{money(e.amountNet, b?.currency)}</span>
              </div>
            );
          })}
        </section>
      )}

      {groups.length === 0 && <p className="sheet-empty">Записів ще немає.</p>}

      {groups.map(g => (
        <section key={g.month} className="ledger-month">
          <span className="strip-label">{MONTHS[Number(g.month.slice(5)) - 1]} {g.month.slice(0, 4)}</span>
          {g.items.map(t => {
            const amt = Number(t.amount) || 0;
            return (
              <div key={t.id} className="ledger-row">
                <span className="ledger-day">{String(t.date).slice(8, 10)}</span>
                <span className="ledger-body">
                  <span className="ledger-kind">{KIND_LABEL[t.kind] || t.kind}</span>
                  <span className="ledger-note">{describe(t)}</span>
                </span>
                <span className={`ledger-amount ${amt >= 0 ? "up" : "down"}`}>
                  {money(amt, t.currency)}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
