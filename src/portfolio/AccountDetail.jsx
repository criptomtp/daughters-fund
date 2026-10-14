import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { useBonds } from "./hooks/useBonds.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { usePockets } from "./hooks/usePockets.js";
import { useCoupons } from "./hooks/useCoupons.js";
import {
  lotInvested, lotCurrentValue, lotYTM, groupCouponEvents, accountCoins,
} from "./calculations.js";
import { CASH_KINDS } from "./repository.js";
import { coinPriceUAH } from "./useMarket.js";
import { fetchPriceHistory, estimateCoinBuys, fxOn } from "./history.js";

// Розгорнута картка рахунку: що на ньому лежить, коли й за скільки куплено,
// що надійде далі і всі рухи грошей. У списку рахунків видно лише підсумок —
// «14 лотів» — а питання завжди про те, ЯКІ саме.

const money = (n) => (n == null || !isFinite(n) ? "—" : "₴" + (Math.round(n * 100) / 100).toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const money0 = (n) => (n == null || !isFinite(n) ? "—" : "₴" + Math.round(n).toLocaleString("uk-UA"));
const day = (d) => String(d || "").slice(0, 10);
const ua = (d) => { const s = day(d); return s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—"; };
const signed = (n) => (n >= 0 ? "+" : "−") + money(Math.abs(n));

const lotIds0 = (lots) => new Set(lots.map(l => l.id));

export function AccountDetail({ accountId, market, onBack }) {
  const account = useLiveQuery(() => db.accounts.get(accountId), [accountId]);
  const lots = useLiveQuery(() => db.lots.where("accountId").equals(accountId).toArray(), [accountId], []);
  const txs = useLiveQuery(() => db.cashTransactions.where("accountId").equals(accountId).toArray(), [accountId], []);
  const { list: bonds } = useBonds();
  const { list: brokers } = useBrokers();
  const { list: pockets } = usePockets();
  const { list: coupons } = useCoupons({});

  // Історія ціни біткоїна — лише для біржі: з неї відновлюється ціна входу
  // старих купівель, записаних без кількості монет.
  const [prices, setPrices] = useState(null);
  const isExchangeAcc = account?.kind === "exchange";
  useEffect(() => {
    if (!isExchangeAcc) return undefined;
    let alive = true;
    fetchPriceHistory("2026-01-01").then(p => { if (alive) setPrices(p); }).catch(() => {});
    return () => { alive = false; };
  }, [isExchangeAcc]);

  if (!account) return <p className="sheet-empty">Завантаження…</p>;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const bondsByIsin = new Map(bonds.map(b => [b.isin, b]));
  const pocketById = new Map(pockets.map(p => [p.id, p]));
  const broker = brokers.find(b => b.id === account.brokerId);
  const isCrypto = account.kind === "exchange";

  // Кишеню показуємо лише тоді, коли на рахунку їх більше однієї — інакше це шум.
  const pocketIdsHere = new Set([...lots.map(l => l.pocketId), ...txs.map(t => t.pocketId)].filter(Boolean));
  const showPocket = pocketIdsHere.size > 1;
  const pocketTag = (id) => (showPocket && pocketById.get(id) ? <span className="ad-pocket">{pocketById.get(id).name}</span> : null);

  const cash = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  // ── облігації ────────────────────────────────────────────────────────────
  const open = lots.filter(l => !l.closedAt || day(l.closedAt) > today);
  const closed = lots.filter(l => l.closedAt && day(l.closedAt) <= today);

  // Купони, які вже прийшли по кожному лоту. Без них «зараз мінус вкладено»
  // показує збиток там, де його немає: частину вкладеного (НКД при покупці)
  // емітент уже повернув купоном, а сам купон пішов на нові папери.
  const receivedByLot = new Map();
  for (const c of coupons) {
    if (!lotIds0(lots).has(c.lotId) || c.status !== "received") continue;
    const amt = Number(c.actualAmount ?? c.amountNet) || 0;
    receivedByLot.set(c.lotId, (receivedByLot.get(c.lotId) || 0) + amt);
  }

  const byIsin = new Map();
  for (const l of open) {
    const b = bondsByIsin.get(l.isin);
    const g = byIsin.get(l.isin) || { isin: l.isin, bond: b, lots: [], qty: 0, invested: 0, value: 0, received: 0 };
    g.received += receivedByLot.get(l.id) || 0;
    g.lots.push(l);
    g.qty += l.quantity;
    g.invested += lotInvested(l);
    g.value += b ? lotCurrentValue(b, l, now) : 0;
    byIsin.set(l.isin, g);
  }
  const positions = [...byIsin.values()].sort((a, b) =>
    String(a.bond?.maturityDate).localeCompare(String(b.bond?.maturityDate)));
  const bondsValue = positions.reduce((s, p) => s + p.value, 0);
  const bondsInvested = positions.reduce((s, p) => s + p.invested, 0);

  // Звідки взялися гроші на рахунку. Своїми вважаємо лише ті, що прийшли
  // ззовні: поповнення й перекази з інших рахунків. Купон — це дохід, і
  // папір, куплений за купон, — реінвестиція, а не новий внесок.
  const sumKind = (kinds) => txs.filter(t => kinds.includes(t.kind)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const ownIn = sumKind(["deposit", "withdrawal"]);
  const transfersIn = sumKind(["transfer_in", "transfer_out", "pocket_in", "pocket_out"]);
  const couponsIn = sumKind(["coupon_received", "lot_redemption", "lot_sale"]);
  const otherIn = sumKind(["manual", "fee"]);
  const revaluation = bondsValue - bondsInvested;

  const lotIds = new Set(lots.map(l => l.id));
  const upcoming = groupCouponEvents(coupons.filter(c => lotIds.has(c.lotId)), lots)
    .filter(e => e.status !== "received" && e.scheduledDate >= today)
    .slice(0, 6);

  // ── крипта ───────────────────────────────────────────────────────────────
  const coinsTotal = isCrypto ? accountCoins(account) : {};
  const priceOf = (t) => coinPriceUAH(t, market) || 0;
  const cryptoValue = Object.entries(coinsTotal).reduce((s, [t, a]) => s + priceOf(t) * (Number(a) || 0), 0);
  const cryptoSpent = txs.filter(t => t.kind === "crypto_buy").reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  const cryptoOps = txs
    .filter(t => t.kind === "crypto_buy" || t.kind === "crypto_swap")
    .sort((a, b) => day(b.date).localeCompare(day(a.date)));
  const btcEst = isCrypto && prices
    ? estimateCoinBuys({ txs, coinsTotal: Number(coinsTotal.BTC) || 0, ticker: "BTC", btc: prices.btc, fx: prices.fx })
    : new Map();
  const usdRate = Number(market?.uahPerUSD) || 0;

  const total = (isCrypto ? cryptoValue : bondsValue) + cash;

  const ops = [...txs].sort((a, b) =>
    day(b.date).localeCompare(day(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));

  return (
    <div className="panel account-detail">
      <button className="ghost-action ad-back" onClick={onBack}>‹ Усі рахунки</button>

      <section className="an-card ad-head">
        <span className="strip-label">{broker?.name || "Рахунок"} · {isCrypto ? "біржа" : "облігації"}</span>
        <h2 className="ad-title">{account.name}</h2>
        <div className="ad-total">{money0(total)}</div>
        <div className="an-rows">
          {isCrypto ? (
            <>
              <div><span>Монети за курсом зараз</span><strong>{money0(cryptoValue)}</strong></div>
              <div><span>Витрачено на купівлю</span><strong>{money0(cryptoSpent)}</strong></div>
              <div><span>Приріст</span><strong className={cryptoValue - cryptoSpent >= 0 ? "up" : "down"}>{signed(cryptoValue - cryptoSpent)}</strong></div>
            </>
          ) : (
            <>
              <div><span>Твої гроші, заведені на рахунок</span><strong>{money0(ownIn)}</strong></div>
              {Math.abs(transfersIn) > 0.005 && (
                <div><span>Перекази з інших рахунків</span><strong>{signed(transfersIn)}</strong></div>
              )}
              <div><span>Отримано купонів і погашень</span><strong className="up">{signed(couponsIn)}</strong></div>
              <div><span>Переоцінка паперів</span>
                <strong className={revaluation >= 0 ? "up" : "down"}>{signed(revaluation)}</strong></div>
              <div className="ad-result"><span>Заробив на цьому рахунку</span>
                <strong className={total - ownIn - transfersIn >= 0 ? "up" : "down"}>
                  {signed(total - ownIn - transfersIn)}
                  {ownIn + transfersIn > 0 && ` · ${(((total - ownIn - transfersIn) / (ownIn + transfersIn)) * 100).toFixed(1)}%`}
                </strong></div>
            </>
          )}
          <div><span>Вільні гроші на рахунку</span><strong>{money(Math.round(cash * 100) / 100 || 0)}</strong></div>
        </div>
        {!isCrypto && (
          <p className="an-sub">
            Облігації зараз коштують {money0(bondsValue)}, на них витрачено {money0(bondsInvested)} —
            але частину цих грошей дали купони, а не ти. Тому результат рахується від твоїх
            внесків: купони — це дохід, папір, куплений за купон, — реінвестиція.
            «Переоцінка» — різниця між ціною покупки й нинішньою вартістю; вона мала й тане до
            погашення, бо НКД, доплачений при покупці, повертається купоном.
            {Math.abs(otherIn) > 0.005 && ` Корекції: ${signed(otherIn)}.`}
          </p>
        )}
        {account.legalOwnerNote && <p className="an-sub">Оформлено: {account.legalOwnerNote}</p>}
      </section>

      {!isCrypto && positions.length > 0 && (
        <section className="an-card">
          <span className="strip-label">Облігації на рахунку</span>
          {positions.map(p => (
            <div key={p.isin} className="ad-pos">
              <div className="ad-pos-head">
                <span className="ad-pos-name">{p.bond?.ticker || p.isin}</span>
                <span className="ad-pos-value">{money0(p.value)}</span>
              </div>
              <div className="ad-pos-meta">
                {p.isin} · {p.qty} шт · купон {p.bond?.couponRate ?? "—"}% · погашення {ua(p.bond?.maturityDate)}
                {p.received > 0 && <> · купонів отримано {money0(p.received)}</>}
                {" · результат "}<span className={p.value - p.invested + p.received >= 0 ? "up" : "down"}>
                  {signed(p.value - p.invested + p.received)}</span>
              </div>
              <div className="ad-lots">
                <div className="ad-lot ad-lot-head">
                  <span>дата</span><span>шт</span><span>ціна</span><span>НКД</span><span>сплачено</span><span>дохідн.</span>
                </div>
                {[...p.lots].sort((a, b) => day(a.purchaseDate).localeCompare(day(b.purchaseDate))).map(l => {
                  const y = p.bond ? lotYTM(p.bond, l) : null;
                  return (
                    <div key={l.id} className="ad-lot">
                      <span>{ua(l.purchaseDate)}{pocketTag(l.pocketId)}</span>
                      <span>{l.quantity}</span>
                      <span>{(Number(l.purchasePrice) || 0).toFixed(2)}</span>
                      <span>{(Number(l.accruedInterestPerPiece) || 0).toFixed(2)}</span>
                      <span>{money(lotInvested(l))}</span>
                      <span>{y != null ? y.toFixed(1) + "%" : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="an-sub">
            Ціна — чиста, без накопиченого купона; НКД — скільки купона ти доплатив продавцю
            за штуку, він повернеться з найближчою виплатою. Дохідність — приблизна, на момент покупки.
          </p>
        </section>
      )}

      {!isCrypto && upcoming.length > 0 && (
        <section className="an-card">
          <span className="strip-label">Найближчі виплати</span>
          <div className="an-rows">
            {upcoming.map(e => (
              <div key={e.key}>
                <span>{ua(e.scheduledDate)} · {bondsByIsin.get(e.isin)?.ticker || e.isin}
                  {e.kind !== "coupon" && " · погашення"}</span>
                <strong>{money(e.amountNet)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isCrypto && closed.length > 0 && (
        <section className="an-card">
          <span className="strip-label">Закриті</span>
          <div className="an-rows">
            {closed.map(l => (
              <div key={l.id}>
                <span>{bondsByIsin.get(l.isin)?.ticker || l.isin} · {l.quantity} шт</span>
                <strong>{l.closedReason === "sale" ? "продано" : "погашено"} {ua(l.closedAt)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {isCrypto && (
        <section className="an-card">
          <span className="strip-label">Монети</span>
          <div className="an-rows">
            {Object.entries(account.holdingsByPocket || {}).flatMap(([pid, coins]) =>
              Object.entries(coins || {}).map(([t, a]) => (
                <div key={pid + t}>
                  <span>{a} {t}{showPocket || Object.keys(account.holdingsByPocket || {}).length > 1
                    ? ` · ${pocketById.get(pid)?.name || "—"}` : ""}</span>
                  <strong>{money0(priceOf(t) * (Number(a) || 0))}</strong>
                </div>
              )))}
            {Object.keys(coinsTotal).length === 0 && <p className="sheet-empty">Монет поки немає.</p>}
          </div>
        </section>
      )}

      {isCrypto && cryptoOps.length > 0 && (
        <section className="an-card">
          <span className="strip-label">Купівлі та обміни</span>
          <div className="ad-lots">
            <div className="ad-lot ad-lot-head ad-crypto">
              <span>дата</span><span>отримано</span><span>віддано</span><span>ціна входу</span>
            </div>
            {cryptoOps.map(t => {
              const swap = t.kind === "crypto_swap";
              const est = btcEst.get(t.id);
              const coins = Number(t.coinAmount) || est?.coins || 0;
              const ticker = t.coinTicker || (est ? "BTC" : "");
              const approx = !t.coinAmount && !!est?.estimated;
              const paid = swap ? `${t.fromAmount} ${t.fromTicker}` : money0(Math.abs(t.amount));
              // Ціна входу в доларах — так її показує біржа й так її звично порівнювати.
              const entryUah = !swap && coins ? Math.abs(t.amount) / coins : null;
              // Курс беремо на дату купівлі, а не сьогоднішній: інакше гривня, що
              // подешевшала за пів року, робить старі покупки дешевшими, ніж були.
              const rate = (prices && fxOn(prices.fx, t.date)) || usdRate;
              const entry = !coins ? "—"
                : swap ? `${Math.round(t.fromAmount / coins).toLocaleString("uk-UA")} ${t.fromTicker}`
                : rate > 0 ? `${approx ? "≈ " : ""}$${Math.round(entryUah / rate).toLocaleString("uk-UA")}`
                : money0(entryUah);
              return (
                <div key={t.id} className="ad-lot ad-crypto">
                  <span>{ua(t.date)}{pocketTag(t.pocketId)}</span>
                  <span>{coins ? `${approx ? "≈ " : ""}${coins.toFixed(6)} ${ticker}` : (t.notes || "—")}</span>
                  <span>{paid}</span>
                  <span>{entry}</span>
                </div>
              );
            })}
          </div>
          <p className="an-sub">
            Позначені «≈» — купівлі, імпортовані з виписки без кількості монет. Їх відновлено з ціни
            біткоїна того дня й підігнано так, щоб разом вийшов твій реальний залишок на біржі.
            Ціна входу в доларах — за курсом НБУ на дату купівлі.
          </p>
        </section>
      )}

      <section className="an-card">
        <span className="strip-label">Усі операції · {ops.length}</span>
        <div className="an-rows">
          {ops.map(t => {
            const k = CASH_KINDS[t.kind];
            const label = typeof k === "string" ? k : k?.label || t.kind;
            const amt = Number(t.amount) || 0;
            return (
              <div key={t.id} className="ad-op">
                <span>
                  {ua(t.date)} · {label}{pocketTag(t.pocketId)}
                  {t.notes && <small className="ad-note">{t.notes}</small>}
                </span>
                <strong className={amt > 0 ? "up" : amt < 0 ? "down" : ""}>
                  {amt === 0 ? "—" : signed(amt)}
                </strong>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
