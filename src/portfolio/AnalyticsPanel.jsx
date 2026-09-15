import { useEffect, useState } from "react";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useTransactions } from "./hooks/useTransactions.js";
import { fetchPriceHistory, buildSeries, seriesMetrics, monthlyBreakdown, toUSD, futurePayments } from "./history.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { groupCouponEvents } from "./calculations.js";
import { buildIcs, downloadIcs } from "./icsExport.js";

// Аналітика за періодами. Головне питання, на яке вона відповідає:
// «+11% — це за який час, і чи були просадки по дорозі».

const fmt = (n, cur) => (n == null || !isFinite(n) ? "—" : (cur === "USD" ? "$" : "₴") + Math.round(n).toLocaleString("uk-UA"));
const pct = (n) => (n == null || !isFinite(n) ? "—" : (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%");
const MONTHS = ["січень","лютий","березень","квітень","травень","червень",
  "липень","серпень","вересень","жовтень","листопад","грудень"];

const PERIODS = [
  { id: "1m", label: "1 міс", days: 30 },
  { id: "3m", label: "3 міс", days: 91 },
  { id: "6m", label: "6 міс", days: 182 },
  { id: "1y", label: "рік", days: 365 },
  { id: "all", label: "весь час", days: null },
];

const iso = (t) => new Date(t).toISOString().slice(0, 10);

function Chart({ points }) {
  if (!points || points.length < 2) return null;
  const W = 320, H = 120, PAD = 2;
  const max = Math.max(...points.map(p => Math.max(p.total, p.contributed))) || 1;
  const min = 0;
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);

  const line = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${line("total")} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label="Вартість фонду і сума внесків у часі">
      <path d={area} fill="var(--gain-soft)" />
      <path d={line("contributed")} fill="none" stroke="var(--ink-faint)" strokeWidth="1.2"
        strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={line("total")} fill="none" stroke="var(--brass)" strokeWidth="2"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function drawdownSeries(navSeries) {
  const out = [];
  let peak = navSeries[0].nav;
  for (const n of navSeries) {
    if (n.nav > peak) peak = n.nav;
    out.push(peak > 0 ? (n.nav - peak) / peak : 0);
  }
  return out;
}

function DrawdownChart({ navSeries }) {
  if (!navSeries || navSeries.length < 2) return null;
  const W = 320, H = 44;
  const dd = drawdownSeries(navSeries);
  const worst = Math.min(...dd, -0.0001);
  const x = (i) => (i / (dd.length - 1)) * W;
  const y = (v) => (v / worst) * (H - 2);
  const d = dd.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    + ` L${W},0 L0,0 Z`;
  return (
    <svg className="an-dd" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label="Просадка від піка">
      <path d={d} fill="var(--oxblood-soft)" stroke="var(--oxblood)" strokeWidth="1"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AnalyticsPanel({ pocket }) {
  const { list: lots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: accounts } = useAccounts();
  const { list: txs } = useTransactions({ limit: 100000 });
  const { list: coupons } = useCoupons({});

  const [period, setPeriod] = useState("all");
  const [cur, setCur] = useState("UAH");
  // Дата фіксується один раз при відкритті екрана: Date.now() у тілі рендера —
  // нечиста функція, і React Compiler справедливо на це свариться.
  const [todayIso] = useState(() => iso(Date.now()));
  const [prices, setPrices] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const firstTx = txs.length
    ? txs.map(t => String(t.date).slice(0, 10)).sort()[0]
    : todayIso;

  useEffect(() => {
    let alive = true;
    // Через мікрозадачу, щоб setState не стріляв синхронно в тілі ефекту.
    Promise.resolve().then(() => {
      if (!alive) return;
      setLoading(true);
      fetchPriceHistory(firstTx)
        .then(p => { if (alive) { setPrices(p); setErr(null); } })
        .catch(e => { if (alive) setErr(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    });
    return () => { alive = false; };
  }, [firstTx]);

  if (loading && !prices) return <p className="sheet-empty">Рахую історію…</p>;
  if (err) return <div className="portfolio-error">⚠ {err}</div>;
  if (!prices) return null;
  if (txs.length === 0) return <p className="sheet-empty">Ще немає записів, щоб було що аналізувати.</p>;

  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));
  const chosen = PERIODS.find(p => p.id === period);
  // «Весь час» починається за день до першої операції, коли фонд ще порожній.
  // Якщо стартувати в день першої операції, той внесок опиняється всередині
  // стартової точки й випадає з «внесено за період»: у тебе так губились
  // 10 282 ₴ найпершої покупки.
  const zeroDay = iso(Date.parse(firstTx + "T00:00:00Z") - 86400000);
  const from = chosen.days
    ? iso(Date.parse(todayIso + "T00:00:00Z") - chosen.days * 86400000)
    : zeroDay;
  const effFrom = from < zeroDay ? zeroDay : from;

  const rawPoints = buildSeries({
    lots, bondsByIsin, transactions: txs, accounts, pocketId: pocket?.id || null,
    btc: prices.btc, fx: prices.fx, from: effFrom,
  });
  // Долар — це та сама серія, поділена на курс кожного дня. Так дохідність
  // лишається стійкою, на відміну від XIRR у доларах на короткій історії.
  const points = cur === "USD" ? toUSD(rawPoints, prices.fx) : rawPoints;
  const m = seriesMetrics(points);
  const months = monthlyBreakdown(points);
  const last = points[points.length - 1] || {};

  // Для малювання беремо не більше ~180 точок: на екрані телефона більше
  // все одно не видно, а SVG стає важким. Підсумки рахуються по ПОВНІЙ
  // денній серії — саме залежність цифр від густоти вибірки й була помилкою.
  const thinned = (() => {
    const MAX = 180;
    if (points.length <= MAX) return points;
    const every = Math.ceil(points.length / MAX);
    const out = points.filter((_, i) => i % every === 0);
    const lastPoint = points[points.length - 1];
    if (out[out.length - 1] !== lastPoint) out.push(lastPoint);
    return out;
  })();
  // Дохідність окремо по класах активів: облігації йдуть рівно й передбачувано,
  // крипта — ні, і в загальному числі вони гасять одне одного до безликого
  // середнього, з якого не зрозуміло, що саме працює.
  const sleeves = (() => {
    const out = [];
    const bondsM = seriesMetrics(points, "bonds", "contributedBonds");
    const cryptoM = seriesMetrics(points, "crypto", "contributedCrypto");
    if (bondsM) out.push({ name: "Облігації", m: bondsM });
    if (cryptoM) out.push({ name: "Крипта", m: cryptoM });
    if (out.length > 1 && m) out.push({ name: "Разом", m, total: true });
    return out;
  })();

  const ahead = futurePayments(coupons, lots, bondsByIsin, todayIso);

  // Податок видно лише на різниці брутто й нетто у виплатах — окремої
  // транзакції для нього немає, бо емітент утримує його до зарахування.
  const tax = (() => {
    const lotIds = new Set(lots.map(l => l.id));
    let paid = 0, aheadTax = 0;
    for (const c of coupons) {
      if (!lotIds.has(c.lotId)) continue;
      const t = (Number(c.amountGross) || 0) - (Number(c.amountNet) || 0);
      if (t <= 0) continue;
      if (c.status === "received") paid += t; else aheadTax += t;
    }
    return { paid, ahead: aheadTax };
  })();

  // Нагадування про виплати — через календар телефона, а не через сервер:
  // дані портфеля не мають залишати пристрій заради сповіщень.
  const exportCalendar = () => {
    const events = groupCouponEvents(coupons, lots)
      .filter(e => e.status !== "received" && e.scheduledDate >= todayIso)
      .map(e => {
        const b = bondsByIsin.get(e.isin);
        const sum = fmt(e.amountNet, "UAH");
        const what = e.kind === "coupon" ? "Купон" : e.kind === "redemption" ? "Погашення" : "Купон + погашення";
        return {
          key: e.key.replace(/[^A-Za-z0-9]/g, ""),
          date: e.scheduledDate,
          summary: `${what} ${sum} · ${b?.ticker || e.isin}`,
          description: `${e.quantity} шт ${e.isin}. Підтвердь надходження в застосунку.`,
        };
      });
    if (events.length === 0) return;
    downloadIcs(buildIcs(events), "daughters-fund-виплати.ics");
  };
  const money = (n) => fmt(n, cur);

  return (
    <div className="panel analytics">
      <div className="chips cur-switch">
        {["UAH", "USD"].map(c => (
          <button key={c} className={`chip ${cur === c ? "active" : ""}`} onClick={() => setCur(c)}>
            {c === "UAH" ? "у гривні" : "у доларах"}
          </button>
        ))}
      </div>

      <div className="chips">
        {PERIODS.map(p => (
          <button key={p.id} className={`chip ${period === p.id ? "active" : ""}`} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <section className="an-card">
        <span className="strip-label">Вартість фонду</span>
        <div className="an-value">{money(last.total)}</div>
        <div className="an-sub">
          з {effFrom} · внесено за період {money(m?.contributed)} ·{" "}
          <span className={m && m.gain >= 0 ? "up" : "down"}>{money(m?.gain)}</span>
        </div>
        <Chart points={thinned} />
        <div className="an-legend">
          <span><i className="sw-brass" /> вартість</span>
          <span><i className="sw-dash" /> внесено</span>
        </div>
      </section>

      <section className="tiles">
        <div className="tile">
          <span className="tile-label">Дохідність за період</span>
          <span className="tile-value">{pct(m?.twr)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Це у річному вимірі</span>
          <span className="tile-value">{m?.annualized != null ? pct(m.annualized) : "—"}</span>
        </div>
      </section>

      {sleeves.length > 1 && (
        <section className="an-card">
          <span className="strip-label">Звідки взялась дохідність</span>
          <div className="sleeve-table">
            <div className="sleeve-head">
              <span />
              <span>вкладено</span>
              <span>зараз</span>
              <span>приріст</span>
              <span>дохідність</span>
            </div>
            {sleeves.map(sl => (
              <div key={sl.name} className={`sleeve-row ${sl.total ? "total" : ""}`}>
                <span className="sleeve-name">{sl.name}</span>
                <span className="mono">{money(sl.m.contributed)}</span>
                <span className="mono">{money(sl.m.endValue)}</span>
                <span className={`mono ${sl.m.gain >= 0 ? "up" : "down"}`}>
                  {sl.m.gain >= 0 ? "+" : ""}{money(sl.m.gain)}
                </span>
                <span className={`mono ${sl.m.twr >= 0 ? "up" : "down"}`}>
                  {sl.m.annualized != null ? pct(sl.m.annualized) : pct(sl.m.twr)}
                </span>
              </div>
            ))}
          </div>
          <p className="an-sub">
            Дохідність — це рух ціни за час, поки актив у тебе. Приріст у гривні
            може бути іншим: якщо докуповувати, коли ціна впала, гривень
            заробиш більше, ніж показує відсоток. Саме тому дві колонки
            можуть дивитись у різні боки.
          </p>
        </section>
      )}

      <section className="an-card">
        <span className="strip-label">Просадки</span>
        <div className="an-sub">
          Рахуються по вартості умовного паю — щоб поповнення не виглядали як зростання.
        </div>
        <DrawdownChart navSeries={m?.navSeries} />
        <div className="an-rows">
          <div><span>Найглибша за період</span><strong className="down">{pct(m?.maxDrawdown)}</strong></div>
          {m?.drawdownFrom && (
            <div><span>Коли</span><strong>{m.drawdownFrom} → {m.drawdownTo}</strong></div>
          )}
          <div><span>Зараз від піка</span>
            <strong className={m && m.fromPeak >= -0.0001 ? "up" : "down"}>
              {m && m.fromPeak >= -0.0001 ? "на піку" : pct(m?.fromPeak)}
            </strong>
          </div>
        </div>
      </section>

      {(tax.paid > 0 || tax.ahead > 0) && (
        <section className="an-card">
          <span className="strip-label">Податок на купони</span>
          <div className="an-rows">
            <div><span>Уже утримано</span><strong className="down">−{fmt(tax.paid, "UAH")}</strong></div>
            <div><span>Ще утримають</span><strong className="down">−{fmt(tax.ahead, "UAH")}</strong></div>
          </div>
          <p className="an-sub">
            ОВДП звільнені від податку (ПКУ 165.1.52). Утримання йде лише з
            корпоративних купонів — 18% ПДФО + 5% військового збору. Платить
            власник рахунку, розподілити це на когось іншого не можна, тож
            дохідність без цього рядка була б завищеною.
          </p>
        </section>
      )}

      <section className="an-card">
        <span className="strip-label">Ще надійде по облігаціях</span>
        <div className="an-rows">
          <div><span>Купонами</span><strong className="up">{fmt(ahead.couponsAhead, "UAH")}</strong></div>
          <div><span>Погашенням тіла</span><strong>{fmt(ahead.redemptionsAhead, "UAH")}</strong></div>
          <div><span>Разом</span><strong>{fmt(ahead.couponsAhead + ahead.redemptionsAhead, "UAH")}</strong></div>
        </div>
        <div className="an-sub">Усі майбутні виплати за графіками — до останнього погашення.</div>
        <button className="ghost-action" onClick={exportCalendar}>
          Додати виплати в календар телефона
        </button>
        <div className="an-sub">
          Файл .ics: події з нагадуванням за 3 дні. Нічого не йде на сервер —
          нагадує сам телефон, навіть коли застосунок закритий.
        </div>
      </section>

      <section className="an-card">
        <span className="strip-label">З чого складається</span>
        <div className="an-rows">
          <div><span>Облігації</span><strong>{money(last.bonds)}</strong></div>
          <div><span>Крипта</span><strong>{money(last.crypto)}</strong></div>
          <div><span>Готівка на рахунках</span><strong>{money(last.cash)}</strong></div>
        </div>
        <div className="an-sub">
          Просадки в цьому фонді дає лише крипта: облігації оцінюються за амортизованою
          вартістю і ростуть монотонно до погашення.
        </div>
      </section>

      {months.length > 1 && (
        <section className="an-card">
          <span className="strip-label">По місяцях</span>
          <div className="an-table">
            <div className="an-th"><span>місяць</span><span>внесено</span><span>зароблено</span><span>вартість</span></div>
            {months.slice().reverse().map(r => (
              <div key={r.month} className="an-tr">
                <span>{MONTHS[Number(r.month.slice(5)) - 1]}</span>
                <span>{money(r.contributed)}</span>
                <span className={r.gain >= 0 ? "up" : "down"}>{money(r.gain)}</span>
                <span>{money(r.endValue)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
