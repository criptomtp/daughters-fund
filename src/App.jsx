import { useState, useMemo, useCallback } from "react";

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MARKET = {
  btcPriceEUR: 68000,
  ethPriceEUR: 2800,
  solPriceEUR: 140,
  uahPerEUR: 51.10,
  usdPerEUR: 1.085,
};

const DEFAULT_INSTRUMENTS = [
  { id: "ovdp_short",  type: "bond_uah", label: "ОВДП 1.1р.",   rate: 16.35, color: "#60a5fa", emoji: "🇺🇦" },
  { id: "ovdp_medium", type: "bond_uah", label: "ОВДП 1.7р.",   rate: 17.10, color: "#60a5fa", emoji: "🇺🇦" },
  { id: "ovdp_peak",   type: "bond_uah", label: "ОВДП 3р. ⭐",  rate: 17.80, color: "#4ade80", emoji: "🇺🇦" },
  { id: "ovdp_long",   type: "bond_uah", label: "ОВДП 3.7р.",   rate: 14.60, color: "#60a5fa", emoji: "🇺🇦" },
  { id: "eur_bond",    type: "bond_eur", label: "EUR облігації", rate: 4.50,  color: "#a78bfa", emoji: "🇪🇺" },
  { id: "usd_bond",    type: "bond_usd", label: "USD облігації", rate: 5.20,  color: "#34d399", emoji: "🇺🇸" },
  {
    id: "btc", type: "crypto", label: "Bitcoin", color: "#f59e0b", emoji: "₿",
    scenarios: [
      { label: "Песимістичний", cagr: 15, color: "#ef4444" },
      { label: "Базовий",       cagr: 30, color: "#f59e0b" },
      { label: "Оптимістичний", cagr: 50, color: "#22c55e" },
      { label: "BTC = 0",       cagr: 0,  color: "#6b7280" },
    ],
  },
  {
    id: "eth", type: "crypto", label: "Ethereum", color: "#818cf8", emoji: "Ξ",
    scenarios: [
      { label: "Песимістичний", cagr: 10, color: "#ef4444" },
      { label: "Базовий",       cagr: 25, color: "#818cf8" },
      { label: "Оптимістичний", cagr: 40, color: "#22c55e" },
      { label: "ETH = 0",       cagr: 0,  color: "#6b7280" },
    ],
  },
  {
    id: "sol", type: "crypto", label: "Solana", color: "#a855f7", emoji: "◎",
    scenarios: [
      { label: "Песимістичний", cagr: 20, color: "#ef4444" },
      { label: "Базовий",       cagr: 40, color: "#a855f7" },
      { label: "Оптимістичний", cagr: 80, color: "#22c55e" },
      { label: "SOL = 0",       cagr: 0,  color: "#6b7280" },
    ],
  },
];

const DEFAULT_CHILDREN = [
  { id: "child1", name: "Донька 1", age: 3 },
  { id: "child2", name: "Донька 2", age: 5 },
];

const DEFAULT_ALLOCATION = { ovdp_peak: 50, btc: 50 };

// ── Calculations ─────────────────────────────────────────────────────────────

function calcBondUAH(monthlyEUR, years, rate, devalPct, uahPerEUR) {
  const months = years * 12;
  const mr = rate / 100 / 12;
  let total = 0;
  for (let m = 1; m <= months; m++) {
    const uah = monthlyEUR * uahPerEUR * Math.pow(1 + devalPct / 100, m / 12);
    total += uah * Math.pow(1 + mr, months - m);
  }
  return total / (uahPerEUR * Math.pow(1 + devalPct / 100, years));
}

function calcBondFixed(monthlyEUR, years, rate) {
  const months = years * 12;
  const mr = rate / 100 / 12;
  let total = 0;
  for (let m = 1; m <= months; m++) {
    total += monthlyEUR * Math.pow(1 + mr, months - m);
  }
  return total;
}

function calcCrypto(monthlyEUR, years, cagr, startPrice) {
  if (cagr === 0) return { totalEUR: 0, coins: 0, avgEntry: 0, finalPrice: startPrice, yearly: [] };
  const months = years * 12;
  const mg = Math.pow(1 + cagr / 100, 1 / 12);
  let coins = 0, eurIn = 0;
  const yearly = [];
  for (let m = 1; m <= months; m++) {
    const price = startPrice * Math.pow(mg, m - 1);
    coins += monthlyEUR / price;
    eurIn += monthlyEUR;
    if (m % 12 === 0) {
      yearly.push({
        year: m / 12,
        coins,
        price: startPrice * Math.pow(mg, m),
        eur: coins * startPrice * Math.pow(mg, m),
      });
    }
  }
  const finalPrice = startPrice * Math.pow(1 + cagr / 100, years);
  return { totalEUR: coins * finalPrice, coins, avgEntry: eurIn / coins, finalPrice, yearly };
}

function getStartPrice(inst, market) {
  if (inst.id === "btc") return market.btcPriceEUR;
  if (inst.id === "eth") return market.ethPriceEUR;
  if (inst.id === "sol") return market.solPriceEUR;
  return 1;
}

function calcInstrumentResult(inst, monthlyEUR, years, devalPct, market) {
  if (!monthlyEUR || years <= 0) return { totalEUR: 0, scenarioResults: null };
  if (inst.type === "bond_uah") {
    return { totalEUR: calcBondUAH(monthlyEUR, years, inst.rate, devalPct, market.uahPerEUR), scenarioResults: null };
  }
  if (inst.type === "bond_eur") {
    return { totalEUR: calcBondFixed(monthlyEUR, years, inst.rate), scenarioResults: null };
  }
  if (inst.type === "bond_usd") {
    const monthlyUSD = monthlyEUR * market.usdPerEUR;
    return { totalEUR: calcBondFixed(monthlyUSD, years, inst.rate) / market.usdPerEUR, scenarioResults: null };
  }
  if (inst.type === "crypto") {
    const startPrice = getStartPrice(inst, market);
    const scenarioResults = inst.scenarios.map(s => ({ ...s, ...calcCrypto(monthlyEUR, years, s.cagr, startPrice) }));
    return { totalEUR: scenarioResults[1].totalEUR, scenarioResults };
  }
  return { totalEUR: 0, scenarioResults: null };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtEUR(n) {
  if (!isFinite(n) || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return "€" + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return "€" + Math.round(n).toLocaleString("uk-UA");
  return "€" + n.toFixed(0);
}

// ── UI Primitives ─────────────────────────────────────────────────────────────

function Slider({ label, value, setValue, min, max, step, suffix, note }) {
  return (
    <div className="slider-group">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value.toLocaleString("uk-UA")}{suffix}</span>
      </div>
      {note && <div className="slider-note">{note}</div>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => setValue(Number(e.target.value))}
        aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      />
      <div className="slider-range">
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange, min = 0, max, step = 1, suffix }) {
  return (
    <div className="num-input-group">
      {label && <label className="num-input-label">{label}</label>}
      <div className="num-input-row">
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="num-input" aria-label={label}
        />
        {suffix && <span className="rate-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Allocation Editor ─────────────────────────────────────────────────────────

function AllocationEditor({ instruments, allocation, setAllocation }) {
  const total = Object.values(allocation).reduce((s, v) => s + (v || 0), 0);
  const update = (id, val) => setAllocation(prev => ({ ...prev, [id]: val }));
  return (
    <div className="allocation-editor">
      <div className="allocation-header">
        <span className="allocation-title">Розподіл</span>
        <span className={`allocation-total ${total > 100 ? "over" : total === 100 ? "ok" : ""}`}>
          {total}% / 100%
        </span>
      </div>
      {instruments.map(inst => (
        <div key={inst.id} className="allocation-row">
          <span className="allocation-label" style={{ color: inst.color }}>{inst.emoji} {inst.label}</span>
          <div className="allocation-slider-row">
            <input
              type="range" min={0} max={100} step={5}
              value={allocation[inst.id] || 0}
              onChange={e => update(inst.id, Number(e.target.value))}
              style={{ accentColor: inst.color }}
              aria-label={`${inst.label} частка`}
            />
            <span className="allocation-pct">{allocation[inst.id] || 0}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Children Settings ─────────────────────────────────────────────────────────

function ChildrenSettings({ children, setChildren }) {
  const add = () => setChildren(prev => [...prev, { id: "c" + Date.now(), name: `Дитина ${prev.length + 1}`, age: 5 }]);
  const remove = id => setChildren(prev => prev.filter(c => c.id !== id));
  const upd = (id, field, val) => setChildren(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));
  return (
    <div className="children-settings">
      {children.map(child => (
        <div key={child.id} className="child-settings-row">
          <input
            className="child-name-input" value={child.name}
            onChange={e => upd(child.id, "name", e.target.value)}
            aria-label="Ім'я дитини"
          />
          <div className="child-age-row">
            <span className="rate-suffix">Вік:</span>
            <input
              type="number" min={0} max={17} step={1} value={child.age}
              onChange={e => upd(child.id, "age", Number(e.target.value))}
              className="rate-input" aria-label="Вік"
            />
            <span className="rate-suffix">р.</span>
          </div>
          {children.length > 1 && (
            <button className="remove-btn" onClick={() => remove(child.id)} aria-label="Видалити">✕</button>
          )}
        </div>
      ))}
      <button className="add-btn" onClick={add}>+ Додати дитину</button>
    </div>
  );
}

// ── Instruments Settings Tab ──────────────────────────────────────────────────

function InstrumentsSettings({ instruments, setInstruments, market, setMarket }) {
  const updRate = (id, rate) => setInstruments(prev => prev.map(i => i.id === id ? { ...i, rate } : i));
  const updCAGR = (id, idx, cagr) => setInstruments(prev => prev.map(i => {
    if (i.id !== id) return i;
    return { ...i, scenarios: i.scenarios.map((s, si) => si === idx ? { ...s, cagr } : s) };
  }));

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h2 className="section-title">📊 Ринкові дані</h2>
        <div className="settings-grid">
          {[
            { key: "btcPriceEUR", label: "BTC ціна", suffix: "€", step: 100 },
            { key: "ethPriceEUR", label: "ETH ціна", suffix: "€", step: 10 },
            { key: "solPriceEUR", label: "SOL ціна", suffix: "€", step: 1 },
            { key: "uahPerEUR",   label: "₴/€ курс",  suffix: "₴", step: 0.1 },
            { key: "usdPerEUR",   label: "$/€ курс",  suffix: "$", step: 0.001 },
          ].map(f => (
            <NumInput
              key={f.key} label={f.label} suffix={f.suffix} step={f.step}
              value={market[f.key]}
              onChange={v => setMarket(prev => ({ ...prev, [f.key]: v }))}
            />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">🏦 Облігації — ставки</h2>
        {instruments.filter(i => i.type.startsWith("bond")).map(inst => (
          <div key={inst.id} className="inst-row">
            <span className="inst-label" style={{ color: inst.color }}>{inst.emoji} {inst.label}</span>
            <div className="inst-rate-row">
              <input
                type="number" step={0.1} value={inst.rate}
                onChange={e => updRate(inst.id, Number(e.target.value))}
                className="rate-input" aria-label={`${inst.label} ставка`}
              />
              <span className="rate-suffix">%/рік</span>
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2 className="section-title">🚀 Крипта — CAGR сценарії</h2>
        {instruments.filter(i => i.type === "crypto").map(inst => (
          <div key={inst.id} className="inst-block">
            <div className="inst-block-title" style={{ color: inst.color }}>{inst.emoji} {inst.label}</div>
            <div className="scenarios-grid">
              {inst.scenarios.map((s, idx) => (
                <div key={idx} className="scenario-input-row">
                  <span className="scenario-input-label" style={{ color: s.color }}>{s.label}</span>
                  <div className="inst-rate-row">
                    <input
                      type="number" step={1} value={s.cagr}
                      onChange={e => updCAGR(inst.id, idx, Number(e.target.value))}
                      className="rate-input" disabled={s.cagr === 0 && idx === inst.scenarios.length - 1}
                      aria-label={`${inst.label} ${s.label} CAGR`}
                    />
                    <span className="rate-suffix">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Child Result ──────────────────────────────────────────────────────────────

function CryptoCard({ inst, result, invested, bondTotal }) {
  const [open, setOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  return (
    <div className={`crypto-card ${open ? "open" : ""}`} style={{ "--accent": inst.color }}>
      <button
        className="crypto-card-header" onClick={() => setOpen(p => !p)} aria-expanded={open}
      >
        <span className="crypto-card-title" style={{ color: inst.color }}>{inst.emoji} {inst.label}</span>
        <div className="crypto-card-right">
          {!open && result.scenarioResults?.filter(s => s.cagr > 0).map(s => (
            <span key={s.cagr} className="scenario-pill" style={{ color: s.color }}>
              {s.cagr}%→{fmtEUR(s.totalEUR)}
            </span>
          ))}
          <span className={`chevron ${open ? "up" : ""}`}>▼</span>
        </div>
      </button>

      {open && result.scenarioResults && (
        <div className="crypto-card-body">
          <div className="scenario-cards">
            {result.scenarioResults.map((s, i) => {
              const combined = s.totalEUR + bondTotal;
              return (
                <div key={i} className="scenario-detail-card" style={{ borderColor: s.color + "55" }}>
                  <div className="s-name" style={{ color: s.color }}>{s.label}</div>
                  {s.cagr > 0 && <div className="s-cagr">{s.cagr}% CAGR</div>}
                  <div className="s-crypto">{fmtEUR(s.totalEUR)}</div>
                  <div className="s-combined">+ бонди = {fmtEUR(combined)}</div>
                  <div className="s-mult">×{isFinite(combined / invested) ? (combined / invested).toFixed(1) : "—"}</div>
                </div>
              );
            })}
          </div>

          {(() => {
            const base = result.scenarioResults[1];
            if (!base?.yearly?.length) return null;
            return (
              <>
                <button className="table-toggle-btn" onClick={e => { e.stopPropagation(); setTableOpen(p => !p); }}>
                  📅 По роках (базовий) {tableOpen ? "▲" : "▼"}
                </button>
                {tableOpen && (
                  <div className="yearly-table-wrap">
                    <table className="yearly-table">
                      <thead>
                        <tr><th>Рік</th><th>Монет</th><th>Ціна</th><th>Вартість</th></tr>
                      </thead>
                      <tbody>
                        {base.yearly.map(d => (
                          <tr key={d.year}>
                            <td>{d.year}</td>
                            <td className="mono">{d.coins.toFixed(6)}</td>
                            <td>{fmtEUR(d.price)}</td>
                            <td>{fmtEUR(d.eur)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function ChildResult({ child, monthlyPerChild, devalPct, allocation, instruments, market }) {
  const years = 18 - child.age;
  const invested = monthlyPerChild * Math.max(years, 0) * 12;

  const results = useMemo(() => {
    if (years <= 0) return [];
    return instruments.map(inst => {
      const pct = allocation[inst.id] || 0;
      if (!pct) return null;
      const monthly = monthlyPerChild * pct / 100;
      return { inst, result: calcInstrumentResult(inst, monthly, years, devalPct, market) };
    }).filter(Boolean);
  }, [instruments, monthlyPerChild, devalPct, allocation, years, market]);

  const bondResults = results.filter(r => r.inst.type !== "crypto");
  const cryptoResults = results.filter(r => r.inst.type === "crypto");
  const bondTotal = bondResults.reduce((s, r) => s + r.result.totalEUR, 0);
  const cryptoBaseTotal = cryptoResults.reduce((s, r) => s + (r.result.scenarioResults?.[1]?.totalEUR || 0), 0);
  const grandTotal = bondTotal + cryptoBaseTotal;

  if (years <= 0) return (
    <div className="child-result">
      <div className="child-result-header">
        <span className="child-emoji">👧</span>
        <span className="child-result-name">{child.name}</span>
        <span className="child-result-meta" style={{ color: "#ef4444" }}>Вже 18+</span>
      </div>
    </div>
  );

  return (
    <div className="child-result">
      <div className="child-result-header">
        <span className="child-emoji">👧</span>
        <span className="child-result-name">{child.name}</span>
        <span className="child-result-meta">{child.age}р. → 18р. = <strong>{years}р.</strong></span>
        <span className="child-result-invested">Внесено: {fmtEUR(invested)}</span>
      </div>

      {bondResults.length > 0 && (
        <div className="bonds-panel">
          <div className="panel-title">🏦 Облігації</div>
          {bondResults.map(r => (
            <div key={r.inst.id} className="bond-result-row">
              <span className="bond-result-label" style={{ color: r.inst.color }}>
                {r.inst.emoji} {r.inst.label}
                <span className="bond-rate-badge">{r.inst.rate}%</span>
              </span>
              <span className="bond-result-total">{fmtEUR(r.result.totalEUR)}</span>
              <span className="bond-result-mult">×{(r.result.totalEUR / invested).toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {cryptoResults.length > 0 && (
        <div className="crypto-section">
          <div className="panel-title">🚀 Крипта · натисни → деталі</div>
          {cryptoResults.map(r => (
            <CryptoCard key={r.inst.id} inst={r.inst} result={r.result} invested={invested} bondTotal={bondTotal} />
          ))}
        </div>
      )}

      {grandTotal > 0 && (
        <div className="grand-total-bar">
          <span className="grand-total-label">🏆 Разом (базовий сценарій)</span>
          <span className="grand-total-value">{fmtEUR(grandTotal)}</span>
          <span className="grand-total-mult">×{(grandTotal / invested).toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

// ── Compare Tab ───────────────────────────────────────────────────────────────

function ScenarioCol({ label, scenario, setScenario, instruments }) {
  const upd = (field, val) => setScenario(prev => ({ ...prev, [field]: val }));
  const setAlloc = useCallback(fn => setScenario(prev => ({
    ...prev, allocation: typeof fn === "function" ? fn(prev.allocation) : fn,
  })), [setScenario]);

  return (
    <div className="compare-col">
      <div className="compare-col-title">{label}</div>
      <Slider
        label="€/місяць на дитину" value={scenario.monthlyPerChild}
        setValue={v => upd("monthlyPerChild", v)} min={10} max={1000} step={10} suffix=" €"
      />
      <AllocationEditor instruments={instruments} allocation={scenario.allocation} setAllocation={setAlloc} />
    </div>
  );
}

function CompareTab({ scenarioA, setScenarioA, scenarioB, setScenarioB, instruments, children, market, devalPct }) {
  const results = useMemo(() => children.map(child => {
    const years = Math.max(0, 18 - child.age);
    const calc = (sc) => {
      const invested = sc.monthlyPerChild * years * 12;
      if (years <= 0) return { total: 0, invested: 0 };
      let total = 0;
      instruments.forEach(inst => {
        const pct = sc.allocation[inst.id] || 0;
        if (!pct) return;
        const monthly = sc.monthlyPerChild * pct / 100;
        const res = calcInstrumentResult(inst, monthly, years, devalPct, market);
        total += inst.type === "crypto" ? (res.scenarioResults?.[1]?.totalEUR || 0) : res.totalEUR;
      });
      return { total, invested };
    };
    const a = calc(scenarioA);
    const b = calc(scenarioB);
    return { child, years, a, b, diff: b.total - a.total };
  }), [scenarioA, scenarioB, instruments, children, market, devalPct]);

  return (
    <div className="compare-tab">
      <div className="compare-configs">
        <ScenarioCol label="Сценарій A" scenario={scenarioA} setScenario={setScenarioA} instruments={instruments} />
        <ScenarioCol label="Сценарій B" scenario={scenarioB} setScenario={setScenarioB} instruments={instruments} />
      </div>

      <div className="compare-results">
        <div className="panel-title">📊 Порівняння результатів (базовий CAGR крипти)</div>
        {results.map(({ child, a, b, diff }) => (
          <div key={child.id} className="compare-result-row">
            <div className="compare-result-child">👧 {child.name}</div>
            <div className="compare-cells">
              <div className="compare-cell">
                <div className="cc-label">A</div>
                <div className="cc-total">{fmtEUR(a.total)}</div>
                <div className="cc-mult">{a.invested > 0 ? `×${(a.total / a.invested).toFixed(1)}` : "—"}</div>
              </div>
              <div className="compare-cell compare-cell--b">
                <div className="cc-label">B</div>
                <div className="cc-total">{fmtEUR(b.total)}</div>
                <div className="cc-mult">{b.invested > 0 ? `×${(b.total / b.invested).toFixed(1)}` : "—"}</div>
              </div>
              <div className={`compare-diff ${diff >= 0 ? "pos" : "neg"}`}>
                {diff >= 0 ? "+" : ""}{fmtEUR(diff)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Calculator Tab ────────────────────────────────────────────────────────────

function CalcTab({ children, setChildren, instruments, market, monthlyPerChild, setMonthlyPerChild, devalPct, setDevalPct, allocation, setAllocation }) {
  const setAllocCb = useCallback(fn => setAllocation(prev => typeof fn === "function" ? fn(prev) : fn), [setAllocation]);

  return (
    <div className="calc-layout">
      <div className="params-panel">
        <div className="params-panel-title">Параметри</div>
        <Slider
          label="Внесок/місяць на дитину" value={monthlyPerChild}
          setValue={setMonthlyPerChild} min={10} max={1000} step={10} suffix=" €"
        />
        <Slider
          label="Девальвація гривні" value={devalPct} setValue={setDevalPct}
          min={0} max={30} step={1} suffix="%/рік"
          note={`${market.uahPerEUR} ₴/€ зараз → ~${Math.round(market.uahPerEUR * Math.pow(1 + devalPct / 100, 15))} ₴/€ через 15р.`}
        />
        <div className="separator" />
        <AllocationEditor instruments={instruments} allocation={allocation} setAllocation={setAllocCb} />
        <div className="separator" />
        <div className="children-section-label">Діти</div>
        <ChildrenSettings children={children} setChildren={setChildren} />
      </div>

      <div className="results">
        {children.map(child => (
          <ChildResult
            key={child.id}
            child={child}
            monthlyPerChild={monthlyPerChild}
            devalPct={devalPct}
            allocation={allocation}
            instruments={instruments}
            market={market}
          />
        ))}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("calc");
  const [children, setChildren] = useState(DEFAULT_CHILDREN);
  const [instruments, setInstruments] = useState(DEFAULT_INSTRUMENTS);
  const [market, setMarket] = useState(DEFAULT_MARKET);
  const [monthlyPerChild, setMonthlyPerChild] = useState(100);
  const [devalPct, setDevalPct] = useState(5);
  const [allocation, setAllocation] = useState(DEFAULT_ALLOCATION);
  const [scenarioA, setScenarioA] = useState({ monthlyPerChild: 100, allocation: { ovdp_peak: 50, btc: 50 } });
  const [scenarioB, setScenarioB] = useState({ monthlyPerChild: 110, allocation: { ovdp_peak: 50, btc: 50 } });

  const TABS = [
    { id: "calc",        label: "📊 Калькулятор" },
    { id: "instruments", label: "⚙️ Інструменти" },
    { id: "compare",     label: "⚖️ Порівняння" },
  ];

  return (
    <div className="app">
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <header className="app-header">
        <div className="app-eyebrow">Дитячий капітал · DCA</div>
        <h1 className="app-title">Daughters Fund</h1>
        <p className="app-subtitle">
          BTC ≈ €{market.btcPriceEUR.toLocaleString()} · ETH ≈ €{market.ethPriceEUR.toLocaleString()} · {market.uahPerEUR} ₴/€ · 18.03.2026
        </p>
      </header>

      <nav className="tab-nav" role="tablist" aria-label="Розділи">
        {TABS.map(t => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === "calc" && (
          <CalcTab
            children={children} setChildren={setChildren}
            instruments={instruments} market={market}
            monthlyPerChild={monthlyPerChild} setMonthlyPerChild={setMonthlyPerChild}
            devalPct={devalPct} setDevalPct={setDevalPct}
            allocation={allocation} setAllocation={setAllocation}
          />
        )}
        {tab === "instruments" && (
          <InstrumentsSettings
            instruments={instruments} setInstruments={setInstruments}
            market={market} setMarket={setMarket}
          />
        )}
        {tab === "compare" && (
          <CompareTab
            scenarioA={scenarioA} setScenarioA={setScenarioA}
            scenarioB={scenarioB} setScenarioB={setScenarioB}
            instruments={instruments} children={children}
            market={market} devalPct={devalPct}
          />
        )}
      </main>

      <footer className="app-footer">
        ⚠️ Курси станом на 18.03.2026. ОВДП рахується в гривні, конвертується в євро з урахуванням девальвації.
        Ставки — реальні дані аукціону 06.01.2026. Не є фінансовою порадою.
      </footer>
    </div>
  );
}
