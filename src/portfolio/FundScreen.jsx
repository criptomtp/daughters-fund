import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { useLots } from "./hooks/useLots.js";
import { useBonds } from "./hooks/useBonds.js";
import { useCoupons } from "./hooks/useCoupons.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { usePersons } from "./hooks/usePersons.js";
import { useTransactions } from "./hooks/useTransactions.js";
import {
  accountSummary, portfolioXIRR, groupCouponEvents, nextCouponEvent,
  ageInYears, personShareValue, lotCurrentValue,
  cashByPocketFrom, extraByPocketFrom, pocketShare, pocketCoins, accountCoins,
} from "./calculations.js";
import { coinPriceUAH } from "./useMarket.js";

// Головний екран. Відповідає на «скільки в нас зараз» одним числом і сам
// каже, чи є незроблений запис за цей місяць — власник не має цього пам'ятати.

const money = (n) => (n == null || !isFinite(n) ? "—" : "₴" + Math.round(n).toLocaleString("uk-UA"));
const pct = (n) => (n == null || !isFinite(n) ? "—" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%");
const MONTHS = ["січень","лютий","березень","квітень","травень","червень",
  "липень","серпень","вересень","жовтень","листопад","грудень"];

/** Скільки минуло від оновлення цін — людською мовою. */
function freshness(iso) {
  if (!iso) return "ще не оновлювалось";
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} год тому`;
  return `${Math.floor(h / 24)} дн тому`;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const W = 220, H = 28;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p.v - min) / span) * H;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--brass)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function FundScreen({ market, pricesLoading, pricesError, onRefreshPrices, onRecord, onOpenDetails, pocket }) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const { list: allLots } = useLots({});
  const { list: bonds } = useBonds();
  const { list: coupons } = useCoupons({});
  const { list: accounts } = useAccounts();
  const { list: persons } = usePersons();
  const { list: allTxs } = useTransactions({ limit: 100000 });
  const snaps = useLiveQuery(() => db.snapshots.orderBy("date").toArray(), [], []);

  // Екран показує один простір. Звужуємо дані один раз тут — далі весь
  // розрахунок нижче працює так само, як працював до появи кишень.
  const pocketId = pocket?.id || null;
  const lots = pocketId ? allLots.filter(l => l.pocketId === pocketId) : allLots;
  const txs  = pocketId ? allTxs.filter(t => t.pocketId === pocketId) : allTxs;

  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));
  const summary = accountSummary({ lots, bondsByIsin, coupons, asOfDate: now });

  // Крипта: рахунки з kind "exchange" тримають залишки монет як факт,
  // а не як послідовність угод — переоцінюємо за поточним курсом.
  const cryptoAccounts = accounts.filter(a => a.kind === "exchange");
  const cryptoIds = new Set(cryptoAccounts.map(a => a.id));
  const priceOf = (ticker) => coinPriceUAH(ticker, market) || 0;
  const extraByPocket = extraByPocketFrom({ accounts: cryptoAccounts, priceOf });
  const cryptoValue = pocketId
    ? (extraByPocket.get(pocketId) || 0)
    : [...extraByPocket.values()].reduce((s, v) => s + v, 0);
  const cryptoInvested = txs
    .filter(t => t.kind === "deposit" && cryptoIds.has(t.accountId))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);

  // Розкладки по рахунках — щоб частка доньки рахувалась з усього, що є
  // на її рахунках: облігації + готівка + монети на біржі.
  const cashByPocket = cashByPocketFrom(allTxs);

  // Показуємо учасників активної кишені, а не «всіх дітей»: у просторі «Я»
  // дітей немає взагалі, і секція має показувати тебе.
  const members = pocket
    ? persons.filter(p => pocketShare(pocket, p.id) > 0)
    : persons.filter(p => p.type === "child");

  // Вартість рахунку рахуємо тут, а не всередині рядка: лише тут відомо,
  // який простір відкрито. Рядок, що сам тягнув баланс рахунку й залишок
  // монет, показував у кишені «Я» чужі гроші — на рахунку доньок стояло
  // 9 ₴ готівки, а на біржі всі монети, хоча жодна з них не твоя.
  const accountRows = accounts.map(account => {
    const isCrypto = account.kind === "exchange";
    const coins = pocketId ? pocketCoins(account, pocketId) : accountCoins(account);
    const cashHere = txs
      .filter(t => t.accountId === account.id && (t.currency || "UAH") === "UAH")
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const value = isCrypto
      ? Object.entries(coins).reduce((s, [c, amt]) => s + priceOf(c) * (Number(amt) || 0), 0)
      : lots.filter(l => l.accountId === account.id).reduce((s, l) => {
          const b = bondsByIsin.get(l.isin);
          return s + (b ? lotCurrentValue(b, l, now) : 0);
        }, 0) + cashHere;
    return { account, isCrypto, value };
  }).filter(r => Math.abs(r.value) > 0.005);

  const bondsValue = summary.byCurrency.UAH?.currentValue || 0;
  const cash = txs
    .filter(t => !cryptoIds.has(t.accountId) && (t.currency || "UAH") === "UAH")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const total = bondsValue + cash + cryptoValue;
  const investedOwn = txs
    .filter(t => t.kind === "deposit" && (t.currency || "UAH") === "UAH")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const gain = total - investedOwn;
  const gainPct = investedOwn > 0 ? (gain / investedOwn) * 100 : null;

  // Дохідність облігацій рахуємо ТІЛЬКИ по облігаційних рахунках: якщо додати
  // внески на біржу, а вартість узяти лише облігаційну, XIRR стає безглуздо
  // від'ємним. Крипта має власну цифру поруч — змішувати їх не можна, бо
  // XIRR на волатильному активі стрибає на десятки відсотків за тиждень.
  const bondTxs = txs.filter(t => !cryptoIds.has(t.accountId));
  const xirr = bondsValue + cash > 0
    ? portfolioXIRR({ transactions: bondTxs, currency: "UAH", terminalValue: bondsValue + cash, asOfDate: now })
    : null;

  const next = nextCouponEvent(groupCouponEvents(coupons, lots), now);

  // Стан місяця: чи був внесок і чи не лежить готівка без діла
  const monthKey = today.slice(0, 7);
  const depositThisMonth = txs.some(t => t.kind === "deposit" && String(t.date).slice(0, 7) === monthKey);
  const boughtThisMonth = lots.some(l => String(l.purchaseDate).slice(0, 7) === monthKey);
  const cheapestBond = bonds.reduce((min, b) => Math.min(min, b.faceValue || 1000), Infinity);
  const idleCash = cash >= (isFinite(cheapestBond) ? cheapestBond : 1000);

  const sparkPoints = (snaps || [])
    .slice(-24)
    .map(s => ({ v: Number(s.totals?.UAH ?? 0) }))
    .filter(p => p.v > 0);

  const nextBond = next && bondsByIsin.get(next.isin);
  const nextAccount = next && accounts.find(a => a.id === next.accountId);

  return (
    <div className="screen fund">
      <header className="fund-head">
        <span className="eyebrow">Родинний фонд</span>
      </header>

      <section className="hero">
        <span className="hero-label">Зараз</span>
        <div className="hero-value">{money(total)}</div>
        <div className="hero-sub">
          вкладено {money(investedOwn)}
          {gainPct != null && <> · <span className={gain >= 0 ? "up" : "down"}>{money(gain)} ({pct(gainPct)})</span></>}
        </div>
        {cryptoValue > 0 && (
          <>
            <div className="hero-note">у т.ч. крипта {money(cryptoValue)} ({Math.round((cryptoValue / total) * 100)}%)</div>
            {/* Ціна й час оновлення на видноті: без них не видно, чи запит узагалі
                проходить — а він може мовчки падати, лишаючи стару цифру. */}
            <button className="price-note" onClick={onRefreshPrices} disabled={pricesLoading}
              title="Оновити ціни">
              <span>BTC ${Math.round(market.btcUSD).toLocaleString("uk-UA")} · {market.uahPerUSD} ₴/$</span>
              <span className={pricesError ? "price-stale" : "price-fresh"}>
                {pricesLoading ? "оновлюю…"
                  : pricesError ? `не оновилось · ${freshness(market.updatedAt)}`
                  : freshness(market.updatedAt)}
                {" ⟳"}
              </span>
            </button>
          </>
        )}
        <Sparkline points={sparkPoints} />
      </section>

      <section className={`month-strip ${!depositThisMonth || idleCash ? "todo" : "done"}`}>
        <span className="strip-label">{MONTHS[new Date().getMonth()]}</span>
        {!depositThisMonth ? (
          <>
            <p className="strip-text">Внесок ще не зроблено</p>
            <button className="strip-action" onClick={() => onRecord("buy")}>Записати внесок →</button>
          </>
        ) : idleCash ? (
          <>
            <p className="strip-text">{money(cash)} лежать без діла</p>
            <button className="strip-action" onClick={() => onRecord("buy")}>Купити облігації →</button>
          </>
        ) : (
          <p className="strip-text done">
            Внесок зроблено{boughtThisMonth ? " · облігації куплено" : ""} ✓
          </p>
        )}
      </section>

      {next && (
        <section className={`next-pay ${next.overdue ? "overdue" : ""}`}>
          <span className="strip-label">
            {next.overdue ? "Виплата мала надійти" : "Наступна виплата"}
          </span>
          <div className="next-amount">{money(next.amountNet)}</div>
          <div className="next-meta">
            {next.scheduledDate}
            {!next.overdue && <> · через {daysBetween(today, next.scheduledDate)} дн.</>}
            {" · "}{nextBond?.ticker || next.isin}{nextAccount ? ` · ${nextAccount.name}` : ""}
          </div>
          {next.overdue && (
            <button className="strip-action" onClick={() => onRecord("coupon")}>Підтвердити надходження →</button>
          )}
        </section>
      )}

      <section className="tiles">
        <div className="tile">
          <span className="tile-label">Дохідність облігацій</span>
          <span className="tile-value">{xirr != null ? xirr.toFixed(1) + " %/рік" : "—"}</span>
        </div>
        {cryptoValue > 0 && cryptoInvested > 0 ? (
          <div className="tile">
            <span className="tile-label">Крипта</span>
            <span className="tile-value">{pct(((cryptoValue - cryptoInvested) / cryptoInvested) * 100)}</span>
          </div>
        ) : (
          <div className="tile">
            <span className="tile-label">Купонів за {new Date().getFullYear()} рік</span>
            <span className="tile-value">{money(summary.receivedYTD)}</span>
          </div>
        )}
      </section>

      {members.length > 0 && (
        <section className="kids">
          {members.map(p => {
            const share = personShareValue({
              person: p, pockets: pocket ? [pocket] : [], lots: allLots, bondsByIsin,
              cashByPocket, extraByPocket, asOfDate: now,
            });
            const age = p.birthDate ? ageInYears(p.birthDate) : null;
            const left = age != null ? Math.max(0, 18 - age) : null;
            return (
              <button key={p.id} className="kid-row" onClick={() => onOpenDetails("kids")}>
                <span className="kid-name">{p.name}</span>
                <span className="kid-value">{money(share)}</span>
                <span className="kid-age">
                  {left != null ? `${Math.floor(left)} р. до 18`
                    : p.type === "child" ? "вкажи дату народження" : "твоя частка"}
                </span>
              </button>
            );
          })}
        </section>
      )}

      <section className="accounts-brief">
        <span className="strip-label">Рахунки</span>
        {accountRows.length === 0 && (
          <p className="sheet-empty">У цьому просторі ще нічого немає.</p>
        )}
        {accountRows.map(r => (
          <button key={r.account.id} className="account-row" onClick={() => onOpenDetails("accounts")}>
            <span className="dot" style={{ background: r.account.color || "#c9a96a" }} />
            <span className="account-name">{r.account.name}</span>
            <span className="account-kind">{r.isCrypto ? "крипта" : "облігації"}</span>
            <span className="account-value">{money(r.value)}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
