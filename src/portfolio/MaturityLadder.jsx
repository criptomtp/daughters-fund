import { useMemo } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { maturityLadder } from "./calculations.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return sym + (n / 1_000).toFixed(0) + "k";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function MaturityLadder({ accountFilter }) {
  const { list: lots } = useLots({
    accountId: accountFilter === "all" ? undefined : accountFilter,
  });
  const { list: bonds } = useBonds();
  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);

  const ladder = useMemo(() => maturityLadder(lots, bondsByIsin), [lots, bondsByIsin]);

  if (ladder.length === 0) return null;

  const maxAmount = Math.max(...ladder.map(b => b.totalPrincipal));
  const currentYear = new Date().getFullYear();

  return (
    <div className="ladder">
      <div className="ladder-title">📊 Графік погашень</div>
      <div className="ladder-bars">
        {ladder.map(bucket => {
          const heightPct = (bucket.totalPrincipal / maxAmount) * 100;
          const isPast = bucket.year < currentYear;
          const yearsAway = bucket.year - currentYear;
          const mainCur = Object.keys(bucket.byCurrency)[0] || "UAH";
          return (
            <div key={bucket.year} className={`ladder-bar-col ${isPast ? "past" : ""}`}>
              <div className="ladder-bar-track">
                <div
                  className="ladder-bar-fill"
                  style={{ height: `${heightPct}%` }}
                  title={`${bucket.year}: ${bucket.lotCount} лот(ів) на ${fmt(bucket.totalPrincipal, mainCur)}`}
                />
              </div>
              <div className="ladder-bar-amount">{fmt(bucket.totalPrincipal, mainCur)}</div>
              <div className="ladder-bar-year">{bucket.year}</div>
              <div className="ladder-bar-meta">
                {yearsAway > 0 ? `+${yearsAway} р.` : yearsAway === 0 ? "цей рік" : `${yearsAway} р.`}
                {" · "}{bucket.lotCount} лот{bucket.lotCount === 1 ? "" : "и"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
