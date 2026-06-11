import { useMemo, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { snapshots as snapshotsRepo } from "./repository.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return sym + (n / 1_000).toFixed(0) + "k";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function EquityCurve({ currency = "UAH" }) {
  const list = useLiveQuery(() => db.snapshots.orderBy("date").toArray(), [], undefined);

  // Take today's snapshot on mount if missing
  useEffect(() => {
    snapshotsRepo.takeIfStale().catch(() => {});
  }, []);

  const data = useMemo(() => {
    if (!list) return null;
    return list.map(s => ({
      date: s.date,
      value: s.totals?.[currency] || 0,
    }));
  }, [list, currency]);

  if (data === null) return null;
  if (data.length < 2) {
    return (
      <div className="equity-curve">
        <div className="equity-title">📈 Динаміка портфелю</div>
        <div className="equity-empty">
          {data.length === 0
            ? "Перший снімок створиться сьогодні. Графік з'явиться через 2+ дні."
            : `Один снімок ${data[0].date}: ${fmt(data[0].value, currency)}. Графік з'явиться завтра.`}
        </div>
      </div>
    );
  }

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 800;
  const H = 140;
  const PAD = 8;

  const points = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((d.value - min) / range) * (H - 2 * PAD);
    return { x, y, ...d };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");
  const areaD = pathD + ` L${points[points.length - 1].x},${H - PAD} L${points[0].x},${H - PAD} Z`;

  const first = data[0];
  const last = data[data.length - 1];
  const change = last.value - first.value;
  const changePct = first.value !== 0 ? (change / first.value) * 100 : 0;

  return (
    <div className="equity-curve">
      <div className="equity-head">
        <div>
          <div className="equity-title">📈 Динаміка портфелю</div>
          <div className="equity-meta">
            {data.length} {data.length === 1 ? "снімок" : data.length < 5 ? "снімки" : "снімків"} ·
            {" "}{first.date} → {last.date}
          </div>
        </div>
        <div className="equity-current">
          <div className="equity-current-value">{fmt(last.value, currency)}</div>
          <div className={`equity-change ${change >= 0 ? "pos" : "neg"}`}>
            {change >= 0 ? "+" : ""}{fmt(change, currency)} ({changePct.toFixed(1)}%)
          </div>
        </div>
      </div>

      <svg className="equity-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={areaD} fill="url(#equity-gradient)" opacity="0.4" />
        <path d={pathD} fill="none" stroke="var(--brass)" strokeWidth="2" />
        <defs>
          <linearGradient id="equity-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
