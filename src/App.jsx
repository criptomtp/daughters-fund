import { useState, useMemo } from "react";

const BTC_PRICE_EUR = 68000;
const UAH_EUR_NOW = 51.10;
const UAH_USD_NOW = 44.25;

const OVDP_STRATEGIES = [
  { id: "short",  label: "Короткі (1.1 р.)",  rate: 16.35, desc: "Реінвест кожен рік, гнучкість" },
  { id: "medium", label: "Середні (1.7 р.)",  rate: 17.1,  desc: "Баланс ставки та гнучкості" },
  { id: "peak",   label: "3 роки (пік!)",     rate: 17.8,  desc: "Максимальна ставка зараз" },
  { id: "long",   label: "Довгі (3.7 р.)",    rate: 14.6,  desc: "Нижча ставка, довший lock-in" },
];

const BTC_SCENARIOS = [
  { id: "pessimistic", label: "Песимістичний", cagr: 15, color: "#ef4444", emoji: "🐻" },
  { id: "base",        label: "Базовий",       cagr: 30, color: "#f59e0b", emoji: "📈" },
  { id: "optimistic",  label: "Оптимістичний", cagr: 50, color: "#22c55e", emoji: "🚀" },
  { id: "zero",        label: "BTC = 0",        cagr: 0,  color: "#6b7280", emoji: "🔴" },
];

function calcOVDP(monthlyEUR, years, annualRate, devalPct) {
  const months = years * 12;
  const monthlyUAHrate = annualRate / 100 / 12;
  let totalUAH = 0;
  for (let m = 1; m <= months; m++) {
    const uahPerEur = UAH_EUR_NOW * Math.pow(1 + devalPct / 100, m / 12);
    const depositUAH = monthlyEUR * uahPerEur;
    const monthsLeft = months - m;
    totalUAH += depositUAH * Math.pow(1 + monthlyUAHrate, monthsLeft);
  }
  const finalUAHperEUR = UAH_EUR_NOW * Math.pow(1 + devalPct / 100, years);
  return totalUAH / finalUAHperEUR;
}

function calcBTC(monthlyEUR, years, cagr) {
  if (cagr === 0) return { totalEUR: 0, totalBTC: 0, avgEntry: 0, finalPrice: 0, yearly: [] };
  const months = years * 12;
  const mg = Math.pow(1 + cagr / 100, 1 / 12);
  let totalBTC = 0, totalEURin = 0;
  const yearly = [];
  for (let m = 1; m <= months; m++) {
    const price = BTC_PRICE_EUR * Math.pow(mg, m - 1);
    totalBTC += monthlyEUR / price;
    totalEURin += monthlyEUR;
    if (m % 12 === 0) {
      const priceNow = BTC_PRICE_EUR * Math.pow(mg, m);
      yearly.push({ year: m / 12, btc: totalBTC, price: priceNow, eur: totalBTC * priceNow });
    }
  }
  const finalPrice = BTC_PRICE_EUR * Math.pow(1 + cagr / 100, years);
  return { totalEUR: totalBTC * finalPrice, totalBTC, avgEntry: totalEURin / totalBTC, finalPrice, yearly };
}

function fmtEUR(n) {
  if (Math.abs(n) >= 1_000_000) return "€" + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return "€" + Math.round(n).toLocaleString("uk-UA");
  return "€" + n.toFixed(0);
}

function fmtBTC(b) {
  if (b === 0) return "0.00000000 ₿";
  return b.toFixed(8) + " ₿";
}

function OVDPPanel({ monthlyEUR, years, devalPct, label }) {
  return (
    <div style={{ background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#60a5fa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
        🇺🇦 ОВДП — порівняння стратегій · {label}
      </div>
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 10 }}>
        Актуальні ставки аукціон 6 січня 2026 · Девальвація {devalPct}%/рік врахована
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#6b7280", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <td style={{ padding: "4px 6px" }}>Стратегія</td>
            <td style={{ padding: "4px 6px", textAlign: "center" }}>Ставка</td>
            <td style={{ padding: "4px 6px", textAlign: "right" }}>Підсумок</td>
            <td style={{ padding: "4px 6px", textAlign: "right" }}>×</td>
          </tr>
        </thead>
        <tbody>
          {OVDP_STRATEGIES.map(s => {
            const result = calcOVDP(monthlyEUR, years, s.rate, devalPct);
            const invested = monthlyEUR * years * 12;
            const isBest = s.id === "peak";
            return (
              <tr key={s.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: isBest ? "rgba(34,197,94,0.06)" : "transparent" }}>
                <td style={{ padding: "6px 6px" }}>
                  <div style={{ color: isBest ? "#4ade80" : "#d1d5db", fontWeight: isBest ? 700 : 400 }}>{isBest ? "⭐ " : ""}{s.label}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>{s.desc}</div>
                </td>
                <td style={{ padding: "6px 6px", textAlign: "center", color: isBest ? "#4ade80" : "#9ca3af", fontWeight: 700 }}>{s.rate}%</td>
                <td style={{ padding: "6px 6px", textAlign: "right", color: "#f9fafb", fontWeight: 600 }}>{fmtEUR(result)}</td>
                <td style={{ padding: "6px 6px", textAlign: "right", color: "#9ca3af", fontSize: 11 }}>×{(result / invested).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 10, color: "#6b7280", lineHeight: 1.5, padding: "8px 10px", background: "rgba(34,197,94,0.05)", borderRadius: 8 }}>
        💡 <strong style={{ color: "#4ade80" }}>Висновок:</strong> Аналітики вважають поточні ставки піком. Зафіксувати 17.8% на 3 роки зараз — вигідніше. Різниця за {years} р. = {fmtEUR(calcOVDP(monthlyEUR, years, 17.8, devalPct) - calcOVDP(monthlyEUR, years, 16.35, devalPct))}.
      </div>
    </div>
  );
}

function BTCCard({ scenario, btcData, ovdpTotal, invested, years }) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const total = btcData.totalEUR + ovdpTotal;
  const mult = total / invested;

  return (
    <div style={{ border: `1px solid ${summaryOpen ? scenario.color + "88" : scenario.color + "33"}`, borderLeft: `3px solid ${scenario.color}`, borderRadius: 12, marginBottom: 8, overflow: "hidden", transition: "border-color 0.2s", background: summaryOpen ? `${scenario.color}09` : "rgba(255,255,255,0.02)" }}>
      <div style={{ padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => setSummaryOpen(p => !p)}>
        <div>
          <span style={{ color: scenario.color, fontWeight: 700, fontSize: 13 }}>{scenario.emoji} {scenario.label}</span>
          {scenario.cagr > 0 && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>CAGR {scenario.cagr}%</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            {summaryOpen ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#f9fafb" }}>{fmtEUR(total)}</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>BTC + ОВДП · ×{mult.toFixed(1)}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: scenario.color }}>{fmtEUR(btcData.totalEUR)}</div>
                <div style={{ fontSize: 10, color: "#6b7280" }}>тільки BTC</div>
              </>
            )}
          </div>
          <span style={{ fontSize: 13, color: "#4b5563", transition: "transform 0.2s", display: "inline-block", transform: summaryOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
        </div>
      </div>

      {summaryOpen && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "12px 14px", background: "rgba(0,0,0,0.18)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[
              { l: "₿ Bitcoin", v: fmtEUR(btcData.totalEUR), c: "#f59e0b" },
              { l: "🇺🇦 ОВДП (пік 17.8%)", v: fmtEUR(ovdpTotal), c: "#60a5fa" },
              { l: "💰 Разом", v: fmtEUR(total), c: scenario.color },
            ].map(i => (
              <div key={i.l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>{i.l}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: i.c }}>{i.v}</div>
              </div>
            ))}
          </div>

          {scenario.cagr > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
              {[
                { l: "Накопичено BTC", v: fmtBTC(btcData.totalBTC), c: scenario.color },
                { l: "Ціна BTC в фіналі", v: fmtEUR(btcData.finalPrice), c: "#f9fafb" },
                { l: "Сер. ціна входу", v: fmtEUR(btcData.avgEntry), c: "#9ca3af" },
              ].map(i => (
                <div key={i.l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>{i.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: i.c, wordBreak: "break-all" }}>{i.v}</div>
                </div>
              ))}
            </div>
          )}

          {scenario.cagr > 0 && (
            <>
              <button onClick={e => { e.stopPropagation(); setTableOpen(p => !p); }} style={{ width: "100%", padding: "7px 0", marginTop: 2, background: tableOpen ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#9ca3af", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span>📅 По роках</span>
                <span style={{ fontSize: 11, transition: "transform 0.2s", display: "inline-block", transform: tableOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
              </button>
              {tableOpen && (
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr style={{ color: "#6b7280", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <td style={{ padding: "3px 6px" }}>Рік</td>
                      <td style={{ padding: "3px 6px", textAlign: "right" }}>BTC</td>
                      <td style={{ padding: "3px 6px", textAlign: "right" }}>Ціна BTC</td>
                      <td style={{ padding: "3px 6px", textAlign: "right" }}>Вартість</td>
                    </tr>
                  </thead>
                  <tbody>
                    {btcData.yearly.map(d => (
                      <tr key={d.year} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: d.year === years ? `${scenario.color}11` : "transparent", fontWeight: d.year === years ? 700 : 400, color: d.year === years ? "#f9fafb" : "#9ca3af" }}>
                        <td style={{ padding: "4px 6px", color: d.year === years ? scenario.color : "#6b7280" }}>{d.year}{d.year === years ? " ✓" : ""}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontSize: 10 }}>{fmtBTC(d.btc)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtEUR(d.price)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtEUR(d.eur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DaughterBlock({ label, age, monthlyEUR, btcShare, devalPct, ovdpStratId }) {
  const years = 18 - age;
  const btcMonthly = monthlyEUR * btcShare / 100;
  const ovdpMonthly = monthlyEUR * (1 - btcShare / 100);
  const invested = monthlyEUR * years * 12;
  const selStrat = OVDP_STRATEGIES.find(s => s.id === ovdpStratId) || OVDP_STRATEGIES[2];
  const ovdpResult = calcOVDP(ovdpMonthly, years, selStrat.rate, devalPct);
  const btcResults = useMemo(() => BTC_SCENARIOS.map(s => calcBTC(btcMonthly, years, s.cagr)), [btcMonthly, years]);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>👧</span>
        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{age} р. → 18 р. = <strong style={{ color: "#f59e0b" }}>{years} р.</strong></span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>Внесено: {fmtEUR(invested)}</span>
      </div>
      <OVDPPanel monthlyEUR={ovdpMonthly} years={years} devalPct={devalPct} label={label} />
      <div style={{ fontSize: 11, color: "#f59e0b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
        ₿ Bitcoin DCA · натисни сценарій → підсумок BTC + ОВДП
      </div>
      {BTC_SCENARIOS.map((s, i) => (
        <BTCCard key={s.id} scenario={s} btcData={btcResults[i]} ovdpTotal={ovdpResult} invested={invested} years={years} />
      ))}
      <div style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(34,197,94,0.08))", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
        <div style={{ fontSize: 10, color: "#f59e0b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>🏆 Загалом (BTC базовий + ОВДП 3р.)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { l: "BTC (30% CAGR)", v: fmtEUR(btcResults[1].totalEUR), c: "#f59e0b" },
            { l: "ОВДП (17.8%)", v: fmtEUR(ovdpResult), c: "#60a5fa" },
            { l: "Разом", v: fmtEUR(btcResults[1].totalEUR + ovdpResult), c: "#4ade80" },
          ].map(i => (
            <div key={i.l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>{i.l}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: i.c }}>{i.v}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8, textAlign: "center" }}>
          Множник: ×{((btcResults[1].totalEUR + ovdpResult) / invested).toFixed(1)} від вкладених {fmtEUR(invested)}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [monthlyEUR, setMonthlyEUR] = useState(100);
  const [btcShare, setBtcShare] = useState(50);
  const [devalPct, setDevalPct] = useState(5);
  const [age1, setAge1] = useState(3);
  const [age2, setAge2] = useState(5);

  const slider = (label, value, setter, min, max, step, suffix, note) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>{value.toLocaleString("uk-UA")}{suffix}</span>
      </div>
      {note && <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>{note}</div>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => setter(Number(e.target.value))} style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4b5563", marginTop: 1 }}>
        <span>{min}{suffix}</span><span>{max}{suffix}</span>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#f9fafb", fontFamily: "'DM Sans', sans-serif", padding: "24px 16px 48px", maxWidth: 500, margin: "0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#f59e0b", textTransform: "uppercase", marginBottom: 6 }}>Дитячий капітал · DCA в євро</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 900, margin: 0, background: "linear-gradient(135deg, #f9fafb 0%, #f59e0b 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Bitcoin + ОВДП</h1>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>BTC ≈ €{BTC_PRICE_EUR.toLocaleString()} · Банк: {UAH_EUR_NOW} ₴/€ · {UAH_USD_NOW} ₴/$ · 18.03.2026</p>
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "18px 18px 8px", marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#f59e0b", textTransform: "uppercase", marginBottom: 14 }}>Параметри</div>
        {slider("Внесок/місяць на кожну дочку", monthlyEUR, setMonthlyEUR, 50, 500, 10, " €")}
        {slider("Частка Bitcoin", btcShare, setBtcShare, 0, 100, 5, "%")}
        {slider("Девальвація гривні", devalPct, setDevalPct, 0, 20, 1, "%/рік", `Поточний курс ~${UAH_EUR_NOW} ₴/€ → через 15р. буде ~${Math.round(UAH_EUR_NOW * Math.pow(1 + devalPct / 100, 15))} ₴/€`)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>{slider("Вік дочки 1", age1, setAge1, 1, 17, 1, " р.")}</div>
          <div>{slider("Вік дочки 2", age2, setAge2, 1, 17, 1, " р.")}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 10 }}>
          {[`₿ €${Math.round(monthlyEUR * btcShare / 100)}/міс`, `🇺🇦 €${Math.round(monthlyEUR * (1 - btcShare / 100))}/міс`, `💰 €${monthlyEUR * 2}/міс разом`].map(t => (
            <span key={t} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#fbbf24" }}>{t}</span>
          ))}
        </div>
      </div>
      <DaughterBlock label="Донька 1" age={age1} monthlyEUR={monthlyEUR} btcShare={btcShare} devalPct={devalPct} ovdpStratId="peak" />
      <DaughterBlock label="Донька 2" age={age2} monthlyEUR={monthlyEUR} btcShare={btcShare} devalPct={devalPct} ovdpStratId="peak" />
      <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 12, padding: "12px 14px", fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        <strong style={{ color: "#f87171" }}>⚠️</strong> Курси станом на 18.03.2026: НБУ €/₴ = 50,63; банківський продаж €/₴ = 51,10; $/₴ = 44,25. ОВДП рахується в гривні, конвертується в євро по майбутньому курсу з урахуванням девальвації. BTC — напряму в EUR. Ставки ОВДП — реальні дані аукціону 06.01.2026. Не є фінансовою порадою.
      </div>
    </div>
  );
}
