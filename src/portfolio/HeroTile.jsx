import { useMemo } from "react";
import { useCoupons } from "./hooks/useCoupons.js";
import { useLots } from "./hooks/useLots.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBonds } from "./hooks/useBonds.js";
import { findNextCoupon, findOverdueCoupons } from "./calculations.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

function daysAwayLabel(d) {
  if (d <= 0) return "сьогодні";
  if (d === 1) return "завтра";
  if (d < 7) return `через ${d} дн.`;
  if (d < 30) return `через ${Math.round(d / 7)} тиж.`;
  return `через ${Math.round(d / 30)} міс.`;
}

export function HeroTile({ accountFilter, onMarkReceived }) {
  const { list: lots } = useLots();
  const { list: bonds } = useBonds();
  const { list: accounts } = useAccounts();
  const { list: coupons, markReceived } = useCoupons({
    accountId: accountFilter === "all" ? undefined : accountFilter,
  });

  const next = useMemo(() => findNextCoupon(coupons, lots, accounts), [coupons, lots, accounts]);
  const overdue = useMemo(() => findOverdueCoupons(coupons), [coupons]);

  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);
  const nextBond = next?.lot && bondsByIsin.get(next.lot.isin);
  const nextCur = nextBond?.currency || "UAH";

  const handleMarkReceived = async (id) => {
    try { await markReceived(id, {}); onMarkReceived?.(); }
    catch (e) { console.error(e); }
  };

  if (!next && overdue.length === 0) return null;

  return (
    <div className="hero-tile">
      {next && (
        <div className="hero-next">
          <span className="hero-icon">🔔</span>
          <div className="hero-content">
            <div className="hero-label">Найближча виплата</div>
            <div className="hero-main">
              <span className="hero-amount">{fmt(next.coupon.amountNet, nextCur)}</span>
              <span className="hero-when">{daysAwayLabel(next.daysAway)} ({next.coupon.scheduledDate?.slice(0, 10)})</span>
            </div>
            <div className="hero-sub">
              {next.account?.emoji} {next.account?.name} · {nextBond?.ticker || next.lot?.isin}
            </div>
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="hero-overdue">
          <span className="hero-icon">⚠</span>
          <div className="hero-content">
            <div className="hero-label">Не позначено отриманим</div>
            <div className="hero-overdue-list">
              {overdue.slice(0, 3).map(c => {
                const lot = lots.find(l => l.id === c.lotId);
                const bond = lot && bondsByIsin.get(lot.isin);
                const acc = lot && accounts.find(a => a.id === lot.accountId);
                return (
                  <button
                    key={c.id}
                    className="hero-overdue-item"
                    onClick={() => handleMarkReceived(c.id)}
                    title="Позначити отриманим"
                  >
                    {c.scheduledDate?.slice(0, 10)} · {acc?.emoji} {acc?.name} ·{" "}
                    <span className="hero-overdue-amount">{fmt(c.amountNet, bond?.currency)}</span>
                    {" "}<span className="hero-mark-cta">✓</span>
                  </button>
                );
              })}
              {overdue.length > 3 && (
                <div className="hero-overdue-more">… і ще {overdue.length - 3} нижче в календарі</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
