import { useMemo, useEffect, useState } from "react";
import { useCoupons } from "./hooks/useCoupons.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { usePersons } from "./hooks/usePersons.js";
import { groupCouponsByMonth } from "./calculations.js";
import { MarkReceivedModal } from "./MarkReceivedModal.jsx";

const MONTH_NAMES = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];
const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function CouponCalendar({ accountFilter }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Refresh "now" every hour so calendar stays accurate over days/weeks
    const id = setInterval(() => setNow(new Date()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const fromIso = useMemo(() => now.toISOString(), [now]);
  const yearAhead = useMemo(() => {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }, [now]);

  const { list: coupons, loading, markReceived, markScheduled } = useCoupons({
    accountId: accountFilter === "all" ? undefined : accountFilter,
    from: fromIso,
    to: yearAhead,
  });
  const { list: lots } = useLots();
  const { list: bonds } = useBonds();
  const { list: accounts } = useAccounts();
  const { list: persons } = usePersons();

  const [confirmingCoupon, setConfirmingCoupon] = useState(null);

  const lotsById     = useMemo(() => new Map(lots.map(l => [l.id, l])), [lots]);
  const bondsByIsin  = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const personsById  = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons]);

  const groups = useMemo(() => groupCouponsByMonth(coupons), [coupons]);

  const handleConfirm = async (payload) => {
    if (!confirmingCoupon) return;
    try { await markReceived(confirmingCoupon.id, payload); }
    finally { setConfirmingCoupon(null); }
  };

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  if (coupons.length === 0) {
    return <div className="portfolio-empty">Жодної очікуваної виплати у наступних 12 місяцях.</div>;
  }

  return (
    <div className="coupon-calendar">
      {confirmingCoupon && (() => {
        const lot = lotsById.get(confirmingCoupon.lotId);
        const bond = lot && bondsByIsin.get(lot.isin);
        const account = lot && accountsById.get(lot.accountId);
        return (
          <MarkReceivedModal
            coupon={confirmingCoupon}
            lot={lot}
            bond={bond}
            account={account}
            onSubmit={handleConfirm}
            onCancel={() => setConfirmingCoupon(null)}
          />
        );
      })()}
      {groups.map(g => {
        const monthTotalByCur = {};
        for (const c of g.items) {
          const lot = lotsById.get(c.lotId);
          const bond = lot && bondsByIsin.get(lot.isin);
          const cur = bond?.currency || "UAH";
          monthTotalByCur[cur] = (monthTotalByCur[cur] || 0) + (c.amountNet || 0);
        }

        return (
          <section key={g.key} className="cal-month">
            <header className="cal-month-head">
              <span className="cal-month-name">{MONTH_NAMES[g.month]} {g.year}</span>
              <span className="cal-month-total">
                {Object.entries(monthTotalByCur).map(([cur, sum], i) => (
                  <span key={cur}>{i > 0 && " + "}{fmt(sum, cur)}</span>
                ))}
              </span>
            </header>
            <div className="cal-items">
              {g.items.map(c => {
                const lot = lotsById.get(c.lotId);
                const bond = lot && bondsByIsin.get(lot.isin);
                const account = lot && accountsById.get(lot.accountId);
                const beneficiaries = account
                  ? (account.beneficiaryIds || []).map(id => personsById.get(id)).filter(Boolean)
                  : [];
                const dayStr = c.scheduledDate.slice(8, 10);
                const isReceived = c.status === "received";
                const isShared = account?.kind === "shared" && beneficiaries.length > 1;

                const kindLabel = c.kind === "redemption"
                  ? "Погашення"
                  : c.kind === "coupon+redemption"
                  ? "Купон + Погашення"
                  : "Купон";

                return (
                  <div key={c.id} className={`cal-item ${isReceived ? "received" : ""} kind-${c.kind || "coupon"}`}
                       style={{ "--owner-color": account?.color || "#c9a96a" }}>
                    <span className="cal-day">{dayStr}</span>
                    <span className="cal-owner">
                      <span className="cal-kind-badge">{kindLabel}</span>
                      {" "}{account?.emoji} {account?.name || "—"}
                      {isShared && (
                        <span className="cal-share">
                          {" → "}{beneficiaries.map((p, i) => (
                            <span key={p.id} style={{ color: p.color }}>
                              {i > 0 && " · "}{p.name} {fmt((c.amountNet || 0) / beneficiaries.length, bond?.currency)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="cal-isin mono">{lot?.isin}</span>
                    <span className="cal-amount">{fmt(c.amountNet, bond?.currency)}</span>
                    {isReceived ? (
                      <button className="owner-action-btn" onClick={() => markScheduled(c.id)} title="Скасувати позначку">✓</button>
                    ) : (
                      <button className="owner-action-btn ok" onClick={() => setConfirmingCoupon(c)} title="Позначити отриманим (з можливістю вказати реальну суму)">Отримано</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
