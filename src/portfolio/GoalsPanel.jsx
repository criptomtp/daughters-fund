import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { usePersons } from "./hooks/usePersons.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { goalProgress, ageInYears } from "./calculations.js";

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };
function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  if (Math.abs(n) >= 1_000_000) return sym + (n / 1_000_000).toFixed(2) + "M";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

export function GoalsPanel() {
  const { list: persons } = usePersons();
  const { list: accounts } = useAccounts();
  const { list: lots } = useLots();
  const { list: bonds } = useBonds();

  const cashByAccountRaw = useLiveQuery(async () => {
    const all = await db.cashTransactions.toArray();
    const map = new Map();
    for (const t of all) {
      if (!map.has(t.accountId)) map.set(t.accountId, {});
      const m = map.get(t.accountId);
      const cur = t.currency || "UAH";
      m[cur] = (m[cur] || 0) + (Number(t.amount) || 0);
    }
    return map;
  }, []);

  const bondsByIsin = useMemo(() => new Map(bonds.map(b => [b.isin, b])), [bonds]);

  // FX rates (units per EUR) published by the app root from live/manual market data.
  // Read once on mount via a lazy initializer (no useMemo over an impure read).
  const [fxRates] = useState(() => {
    try {
      const raw = localStorage.getItem("df_fx_rates");
      if (raw) return JSON.parse(raw);
    } catch { /* ignore malformed */ }
    return { UAH: 51.1, USD: 1.085, EUR: 1 };
  });

  const goals = useMemo(() => {
    const cashByAccount = cashByAccountRaw || new Map();
    return persons
      .map(person => {
        const g = goalProgress({ person, accounts, lots, bondsByIsin, cashByAccount, fxRates });
        if (!g) return null;
        return { person, ...g };
      })
      .filter(Boolean);
  }, [persons, accounts, lots, bondsByIsin, cashByAccountRaw, fxRates]);

  if (goals.length === 0) return null;

  return (
    <div className="goals-panel">
      <div className="goals-title">🎯 Цілі</div>
      <div className="goals-list">
        {goals.map(g => (
          <GoalCard key={g.person.id} goal={g} />
        ))}
      </div>
    </div>
  );
}

function GoalCard({ goal }) {
  const { person, targetAmount, currency, currentValue, progress, remaining, daysLeft, yearsLeft, requiredMonthly, deadlineReached, isComplete } = goal;
  const age = ageInYears(person.birthDate);
  const pct = Math.min(100, Math.max(0, progress * 100));

  return (
    <div className="goal-card" style={{ "--accent": person.color }}>
      <div className="goal-card-head">
        <span className="goal-emoji">{person.emoji}</span>
        <span className="goal-name">{person.name}</span>
        {age != null && <span className="goal-age">{age.toFixed(1)} р.</span>}
        {isComplete && <span className="goal-done">✓ Виконано</span>}
      </div>

      <div className="goal-progress-bar">
        <div className="goal-progress-fill" style={{ width: `${pct}%` }} />
        <span className="goal-progress-label">{pct.toFixed(0)}%</span>
      </div>

      <div className="goal-meta">
        <div className="goal-meta-row">
          <span className="goal-meta-label">Зараз</span>
          <strong>{fmt(currentValue, currency)}</strong>
          <span className="goal-meta-sep">/</span>
          <span className="goal-meta-label">Ціль</span>
          <strong>{fmt(targetAmount, currency)}</strong>
        </div>
        {!isComplete && (
          <div className="goal-meta-row">
            <span className="goal-meta-label">Лишилось</span>
            <strong>{fmt(remaining, currency)}</strong>
            {daysLeft > 0 && (
              <>
                <span className="goal-meta-sep">·</span>
                <span className="goal-meta-label">До 18 років</span>
                <strong>{Math.floor(yearsLeft)} р. {Math.floor(daysLeft % 365.25)} дн.</strong>
              </>
            )}
            {requiredMonthly > 0 && (
              <>
                <span className="goal-meta-sep">·</span>
                <span className="goal-meta-label">Треба/міс</span>
                <strong className="goal-required">{fmt(requiredMonthly, currency)}</strong>
              </>
            )}
            {deadlineReached && (
              <>
                <span className="goal-meta-sep">·</span>
                <span className="goal-meta-label">Дедлайн настав, треба</span>
                <strong className="goal-required">{fmt(remaining, currency)} одразу</strong>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
