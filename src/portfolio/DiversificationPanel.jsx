import { useMemo } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { lotCurrentValue } from "./calculations.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return sym + (n / 1_000).toFixed(0) + "k";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

const COLORS = ["#c9a96a", "#8fae7a", "#6f86c4", "#b85c5c", "#a78bfa", "#f472b6", "#fb923c", "#22d3ee"];

function termBucket(maturityDate) {
  if (!maturityDate) return "—";
  const years = (new Date(maturityDate) - new Date()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 0)  return "Прострочено";
  if (years < 1)  return "до 1 року";
  if (years < 3)  return "1–3 роки";
  if (years < 5)  return "3–5 років";
  return "5+ років";
}

export function DiversificationPanel() {
  const { list: lots } = useLots();
  const { list: bonds } = useBonds();
  const { list: accounts } = useAccounts();
  const { list: brokers } = useBrokers();

  const bondsByIsin   = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);
  const accountsById  = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const brokersById   = useMemo(() => new Map(brokers.map(b => [b.id, b])), [brokers]);

  const breakdown = useMemo(() => {
    const byType     = new Map();
    const byCurrency = new Map();
    const byBroker   = new Map();
    const byTerm     = new Map();
    const byIssuer   = new Map();

    let totalUAH = 0;
    for (const lot of lots) {
      const bond = bondsByIsin.get(lot.isin);
      if (!bond) continue;
      const value = lotCurrentValue(bond, lot);
      // simple aggregation by currency separately
      const account = accountsById.get(lot.accountId);
      const broker = account && brokersById.get(account.brokerId);
      const valueKey = bond.currency === "UAH" ? value : 0;
      totalUAH += valueKey;

      const accumulate = (map, key) => {
        if (!map.has(key)) map.set(key, 0);
        if (bond.currency === "UAH") map.set(key, map.get(key) + value);
      };

      accumulate(byType, bond.type === "ovdp" ? "ОВДП" : "Корпоративні");
      accumulate(byCurrency, bond.currency);
      accumulate(byBroker, broker?.name || "Без брокера");
      accumulate(byTerm, termBucket(bond.maturityDate));
      accumulate(byIssuer, bond.issuer || "—");
    }

    const toSorted = (m) => Array.from(m.entries())
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({ key, value, pct: totalUAH > 0 ? (value / totalUAH) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

    return {
      total: totalUAH,
      type: toSorted(byType),
      currency: toSorted(byCurrency),
      broker: toSorted(byBroker),
      term: toSorted(byTerm),
      issuer: toSorted(byIssuer),
    };
  }, [lots, bondsByIsin, accountsById, brokersById]);

  if (breakdown.total === 0) return null;

  return (
    <div className="diversification">
      <div className="diversification-title">📐 Диверсифікація (UAH)</div>
      <div className="diversification-grid">
        <BreakdownGroup title="За типом" items={breakdown.type} />
        <BreakdownGroup title="За валютою" items={breakdown.currency} />
        <BreakdownGroup title="За брокером" items={breakdown.broker} />
        <BreakdownGroup title="За терміном погашення" items={breakdown.term} />
        {breakdown.issuer.length > 1 && (
          <BreakdownGroup title="За емітентом" items={breakdown.issuer} />
        )}
      </div>
    </div>
  );
}

function BreakdownGroup({ title, items }) {
  if (items.length === 0) return null;
  return (
    <div className="bd-group">
      <div className="bd-group-title">{title}</div>
      <div className="bd-group-bars">
        {items.map((item, i) => (
          <div key={item.key} className="bd-bar-row">
            <div className="bd-bar-head">
              <span className="bd-bar-label">{item.key}</span>
              <span className="bd-bar-value">{fmt(item.value)} <span className="bd-bar-pct">({item.pct.toFixed(0)}%)</span></span>
            </div>
            <div className="bd-bar-track">
              <div
                className="bd-bar-fill"
                style={{
                  width: `${item.pct}%`,
                  background: COLORS[i % COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
