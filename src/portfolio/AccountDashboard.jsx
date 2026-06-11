import { useMemo, useEffect, useState } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { useCashBalance } from "./hooks/useTransactions.js";
import { accountSummary } from "./calculations.js";
import { HeroTile } from "./HeroTile.jsx";
import { GoalsPanel } from "./GoalsPanel.jsx";
import { MaturityLadder } from "./MaturityLadder.jsx";
import { EquityCurve } from "./EquityCurve.jsx";
import { DiversificationPanel } from "./DiversificationPanel.jsx";
import { ProjectionPanel } from "./ProjectionPanel.jsx";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(2) + "M";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function AccountDashboard({ accountFilter, accounts, persons }) {
  const { list: lots } = useLots({
    accountId: accountFilter === "all" ? undefined : accountFilter,
  });
  const { list: bonds } = useBonds();
  const { list: coupons } = useCoupons({
    accountId: accountFilter === "all" ? undefined : accountFilter,
  });
  const cashBalance = useCashBalance(accountFilter === "all" ? undefined : accountFilter);

  const [now, setNow] = useState(new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);

  const summary = useMemo(() => accountSummary({
    lots, bondsByIsin, coupons, asOfDate: now,
  }), [lots, bondsByIsin, coupons, now]);

  const isAll = accountFilter === "all";
  const acc = !isAll && accounts.find(a => a.id === accountFilter);
  const accent = isAll ? "#c9a96a" : (acc?.color || "#c9a96a");

  const beneficiaryList = acc
    ? (acc.beneficiaryIds || []).map(id => persons.find(p => p.id === id)).filter(Boolean)
    : [];

  const currencies = Object.keys({ ...summary.byCurrency, ...cashBalance });
  const mainCur = acc?.primaryCurrency || currencies[0] || "UAH";
  const mainCash = cashBalance[mainCur] || 0;
  const totalAssets = (summary.byCurrency[mainCur]?.currentValue || 0) + mainCash;

  return (
    <div className="dashboard-stack">
      <HeroTile accountFilter={accountFilter} />

    <div className="dashboard" style={{ "--accent": accent }}>
      <div className="dashboard-head">
        <div className="dashboard-title">
          {isAll ? "📊 Усі рахунки" : `${acc?.emoji || "💳"} ${acc?.name || ""}`}
        </div>
        {!isAll && beneficiaryList.length > 0 && (
          <div className="dashboard-beneficiaries">
            Бенефіціари: {beneficiaryList.map((p, i) => (
              <span key={p.id}>{i > 0 && ", "}<span style={{ color: p.color }}>{p.emoji} {p.name}</span></span>
            ))}
          </div>
        )}
      </div>

      <div className="dashboard-tiles">
        <Tile label="Залишок готівки" value={fmt(mainCash, mainCur)} good={mainCash >= 0} bad={mainCash < 0} />
        <Tile label="Лотів" value={summary.lotCount} />
        <Tile label="Вкладено" value={fmt(summary.invested, mainCur)} />
        <Tile label="Поточна вартість" value={fmt(summary.currentValue, mainCur)} accent />
        <Tile label="Сума активів" value={fmt(totalAssets, mainCur)} accent />
        <Tile label="Отримано YTD" value={fmt(summary.receivedYTD, mainCur)} good />
        <Tile label="Очікується (12 міс)" value={fmt(summary.scheduledNext12m, mainCur)} good />
      </div>

      {currencies.length > 1 && (
        <div className="dashboard-currencies">
          {currencies.map(cur => (
            <span key={cur} className="cur-chip">
              <span className="cur-name">{cur}:</span>
              <span className="cur-val">
                {fmt(cashBalance[cur] || 0, cur)} готівки · {fmt(summary.byCurrency[cur]?.currentValue || 0, cur)} в облігаціях
              </span>
            </span>
          ))}
        </div>
      )}
    </div>

    {isAll && <EquityCurve currency={mainCur} />}
    {isAll && <GoalsPanel />}
    <MaturityLadder accountFilter={accountFilter} />
    {isAll && <DiversificationPanel />}
    {isAll && <ProjectionPanel currency={mainCur} />}
    </div>
  );
}

function Tile({ label, value, accent, good, bad }) {
  return (
    <div className={`tile ${accent ? "tile--accent" : ""} ${good ? "tile--good" : ""} ${bad ? "tile--bad" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}
