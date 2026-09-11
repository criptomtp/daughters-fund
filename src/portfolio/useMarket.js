import { useCallback, useEffect, useState } from "react";

// Курси й ціни крипти. Раніше це жило всередині вкладки «Калькулятор» і
// публікувало df_fx_rates побічним ефектом екрана прогнозу. Тепер це окремий
// хук: база — гривня, а не євро, бо власник вносить гривні й купує гривневі ОВДП.
//
// CoinGecko і Frankfurter віддають CORS, тож ходимо прямо з браузера
// (обидва вже прописані в connect-src у index.html).

const STORAGE_KEY = "df_market";
const FX_LEGACY_KEY = "df_fx_rates";   // читає GoalsPanel — формат «одиниць за EUR»
const REFRESH_MS = 60 * 60 * 1000;

const FALLBACK = {
  uahPerUSD: 44.73,
  uahPerEUR: 51.94,
  usdPerEUR: 1.16,
  btcUSD: 79000,
  ethUSD: 2440,
  usdtUSD: 1,
  updatedAt: null,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...FALLBACK, ...JSON.parse(raw) } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function useMarket() {
  const [market, setMarket] = useState(load);
  const [status, setStatus] = useState({ loading: false, error: null });

  const refresh = useCallback(async () => {
    setStatus({ loading: true, error: null });

    // Приймаємо тільки скінченні додатні числа: зіпсована відповідь API не
    // повинна тихо перетерти курс, за яким оцінюється весь портфель.
    const pos = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);

    // Кожне джерело тягнемо НЕЗАЛЕЖНО. Раніше вони жили в одному Promise.all,
    // і коли Frankfurter почав віддавати 301 на api.frankfurter.dev (домен не
    // в CSP, тож браузер редирект блокує), разом з ним відкидались успішні
    // відповіді CoinGecko і НБУ — застосунок мовчки сидів на запасних числах.
    //
    // Frankfurter прибрано зовсім: один запит НБУ віддає і долар, і євро.
    const get = async (url) => {
      const r = await fetch(url, { credentials: "omit" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    const [cryptoRes, nbuRes] = await Promise.allSettled([
      get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd"),
      get("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"),
    ]);

    const crypto = cryptoRes.status === "fulfilled" ? cryptoRes.value : null;
    const nbu = nbuRes.status === "fulfilled" ? nbuRes.value : null;

    if (!crypto && !nbu) {
      setStatus({ loading: false, error: "джерела недоступні" });
      return;
    }

    const rateOf = (cc) => Number(Array.isArray(nbu) ? nbu.find(c => c.cc === cc)?.rate : undefined);

    setMarket(prev => {
      const uahPerUSD = +pos(rateOf("USD"), prev.uahPerUSD).toFixed(4);
      const uahPerEUR = +pos(rateOf("EUR"), prev.uahPerEUR).toFixed(2);
      const next = {
        uahPerUSD,
        uahPerEUR,
        usdPerEUR: +(uahPerEUR / uahPerUSD).toFixed(4),
        btcUSD: Math.round(pos(crypto?.bitcoin?.usd, prev.btcUSD)),
        ethUSD: Math.round(pos(crypto?.ethereum?.usd, prev.ethUSD)),
        usdtUSD: +pos(crypto?.tether?.usd, prev.usdtUSD).toFixed(4),
        updatedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        // Сумісність: GoalsPanel досі читає курси у форматі «одиниць за EUR»
        localStorage.setItem(FX_LEGACY_KEY, JSON.stringify({
          UAH: next.uahPerEUR, USD: next.usdPerEUR, EUR: 1,
        }));
      } catch { /* квота — не критично */ }
      return next;
    });

    // Часткова відмова — теж інформація: краще сказати, що саме не приїхало,
    // ніж мовчки лишити стару цифру.
    const failed = [!crypto && "ціни крипти", !nbu && "курс НБУ"].filter(Boolean);
    setStatus({ loading: false, error: failed.length ? `не оновилось: ${failed.join(", ")}` : null });
  }, []);

  useEffect(() => {
    // Перший запит — через мікрозадачу, щоб setState не стріляв синхронно
    // в тілі ефекту (каскадний рендер на монтуванні).
    let alive = true;
    Promise.resolve().then(() => { if (alive) refresh(); });
    const id = setInterval(refresh, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [refresh]);

  return { market, ...status, refresh };
}

/** Ціна однієї монети в гривні. Невідомий тікер → null, а не 0. */
export function coinPriceUAH(ticker, market) {
  const usd = { BTC: market.btcUSD, ETH: market.ethUSD, USDT: market.usdtUSD }[String(ticker).toUpperCase()];
  return usd == null ? null : usd * market.uahPerUSD;
}

export const COINS = ["BTC", "ETH", "USDT"];
