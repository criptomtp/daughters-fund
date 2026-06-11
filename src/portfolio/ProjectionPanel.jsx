import { useMemo, useState } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { lotCurrentValue, lotXIRR, lotInvested } from "./calculations.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return sym + (n / 1_000).toFixed(1) + "k";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function ProjectionPanel({ currency = "UAH" }) {
  const { list: lots } = useLots();
  const { list: bonds } = useBonds();
  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);

  // Compute current value + weighted average XIRR
  const { currentValue, invested, weightedRate } = useMemo(() => {
    let total = 0;
    let investedTotal = 0;
    let weighted = 0;
    let weights = 0;
    for (const lot of lots) {
      const bond = bondsByIsin.get(lot.isin);
      if (!bond || bond.currency !== currency) continue;
      const value = lotCurrentValue(bond, lot);
      total += value;
      investedTotal += lotInvested(lot);
      const rate = lotXIRR(bond, lot);
      if (rate != null && rate > 0 && rate < 100) {
        weighted += rate * value;
        weights += value;
      }
    }
    return {
      currentValue: total,
      invested: investedTotal,
      weightedRate: weights > 0 ? weighted / weights : 15,
    };
  }, [lots, bondsByIsin, currency]);

  const [rate, setRate] = useState(weightedRate.toFixed(2));
  const [monthly, setMonthly] = useState(0);
  const [years, setYears] = useState(15);
  const [rateUserEdited, setRateUserEdited] = useState(false);
  const [seededRate, setSeededRate] = useState(weightedRate);

  // Re-seed the rate from the computed weighted XIRR when it changes (e.g. lots
  // finish loading async), unless the user typed their own value. "Adjust state
  // during render" — React-recommended over a syncing effect, and converges in
  // one extra render (no infinite loop: seededRate catches up to weightedRate).
  if (!rateUserEdited && weightedRate !== seededRate) {
    setSeededRate(weightedRate);
    setRate(weightedRate.toFixed(2));
  }

  const projection = useMemo(() => {
    const r = Number(rate) / 100;
    const m = Number(monthly);
    const y = Number(years);
    if (!r || !y) return null;
    // FV = PV(1+r)^y + PMT × (((1+r)^y - 1) / r) for annual contributions; convert monthly
    const monthsTotal = y * 12;
    const monthlyR = Math.pow(1 + r, 1 / 12) - 1;
    let value = currentValue;
    const points = [{ year: 0, value }];
    for (let m_i = 1; m_i <= monthsTotal; m_i++) {
      value = value * (1 + monthlyR) + m;
      if (m_i % 12 === 0) {
        points.push({ year: m_i / 12, value });
      }
    }
    const totalContributed = invested + m * monthsTotal;
    return { finalValue: value, points, totalContributed, growth: value - totalContributed };
  }, [rate, monthly, years, currentValue, invested]);

  if (currentValue === 0 && Number(monthly) === 0) {
    return null;
  }

  const max = projection ? Math.max(...projection.points.map(p => p.value)) : 0;
  const W = 800;
  const H = 100;
  const PAD = 8;

  return (
    <div className="projection-panel">
      <div className="projection-head">
        <div className="projection-title">🔮 Прогноз з реінвестицією</div>
        <div className="projection-meta">
          Поточна вартість в {currency}: <strong>{fmt(currentValue, currency)}</strong>
          {weightedRate > 0 && <> · Середня XIRR <strong>{weightedRate.toFixed(2)}%</strong></>}
        </div>
      </div>

      <div className="projection-controls">
        <label className="projection-ctrl">
          <span>Ставка дохідності, %/рік</span>
          <input type="number" step="0.5" min="0" max="100"
            value={rate} onChange={e => { setRateUserEdited(true); setRate(e.target.value); }} />
        </label>
        <label className="projection-ctrl">
          <span>Додатковий внесок, {CURRENCY_SYMBOL[currency]}/міс</span>
          <input type="number" step="100" min="0"
            value={monthly} onChange={e => setMonthly(e.target.value)} />
        </label>
        <label className="projection-ctrl">
          <span>Горизонт, років</span>
          <input type="number" step="1" min="1" max="50"
            value={years} onChange={e => setYears(e.target.value)} />
        </label>
      </div>

      {projection && (
        <>
          <div className="projection-result">
            <div className="projection-result-main">
              <div className="projection-result-label">Через {years} років буде</div>
              <div className="projection-result-value">{fmt(projection.finalValue, currency)}</div>
            </div>
            <div className="projection-result-meta">
              <div>Внесено всього: <strong>{fmt(projection.totalContributed, currency)}</strong></div>
              <div>Зростання (відсотки): <strong style={{ color: "var(--gain)" }}>+{fmt(projection.growth, currency)}</strong></div>
              <div>Множник: <strong>×{(projection.finalValue / projection.totalContributed).toFixed(2)}</strong></div>
            </div>
          </div>

          <svg className="projection-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="proj-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--gain)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="var(--gain)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {(() => {
              const pts = projection.points;
              const points = pts.map((p, i) => ({
                x: PAD + (i / (pts.length - 1)) * (W - 2 * PAD),
                y: H - PAD - ((p.value - currentValue) / (max - currentValue || 1)) * (H - 2 * PAD),
              }));
              const pathD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");
              const areaD = pathD + ` L${points[points.length - 1].x},${H - PAD} L${points[0].x},${H - PAD} Z`;
              return (
                <>
                  <path d={areaD} fill="url(#proj-gradient)" />
                  <path d={pathD} fill="none" stroke="var(--gain)" strokeWidth="2" />
                </>
              );
            })()}
          </svg>
        </>
      )}

      <div className="projection-hint">
        💡 Прогноз припускає що всі купонні виплати реінвестуються під ту саму ставку, плюс щомісячний внесок.
        Реальна дохідність залежить від інфляції, доступних ставок і поведінки користувача.
      </div>
    </div>
  );
}
